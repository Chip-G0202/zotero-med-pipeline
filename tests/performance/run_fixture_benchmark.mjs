import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

import { dedupWithDiagnostics } from "../../workflow/tools/stage1/dedupe_step.mjs";
import { classifyItem } from "../../workflow/tools/stage1/rule_classifier.mjs";
import { ZoteroCliBackend } from "../../workflow/tools/lib/zotero_cli_backend.mjs";
import { ZoteroWebApiBackend } from "../../workflow/tools/lib/zotero_web_api_backend.mjs";
import { LocalRepository } from "../../workflow/tools/local/local_repository.mjs";
import { buildRunSummary } from "../../workflow/tools/lib/run_summary.mjs";
import { createNotificationReceipt } from "../../workflow/tools/stage5/email_receipt.mjs";
import { canonicalHash, compareBusinessEquivalence } from "./canonical_equivalence.mjs";
import { buildMutationPlan, FIXED_NOW, itemKey, makeFixtureCandidates, makeWarmSeed } from "./fixture_workload.mjs";
import { createCliExecutor, createMetrics, createWebFetch } from "./mock_transports.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const defaultOutput = path.join(repoRoot, "tests", "runs", "v2.2-performance");

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function gradeCounts(items) {
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  for (const item of items) counts[item.final_grade || item.grade] += 1;
  return counts;
}

async function timed(stages, name, operation) {
  const started = performance.now();
  const value = await operation();
  stages[name] = performance.now() - started;
  return value;
}

function measured(operations, name, operation) {
  const started = performance.now();
  const value = operation();
  operations[name] = performance.now() - started;
  return value;
}

async function measuredAsync(operations, name, operation) {
  const started = performance.now();
  const value = await operation();
  operations[name] = performance.now() - started;
  return value;
}

function copySeed(seed) {
  return {
    identityKeys: new Set(seed.identityKeys || []),
    translationCache: new Map(seed.translationCache || []),
    items: Object.fromEntries(Object.entries(seed.items || {}).map(([key, value]) => [key, structuredClone(value)])),
    collections: Object.fromEntries(Object.entries(seed.collections || {}).map(([key, value]) => [key, new Set(value)])),
  };
}

async function prepareLocalWarmState(runRoot, triaged, seed) {
  const repository = await new LocalRepository(path.join(runRoot, "local"), { sharedIndexPath: path.join(runRoot, "shared-index.json") }).load();
  repository.upsertPapers(triaged.filter((item) => ["A", "B", "C"].includes(item.grade)).map((item) => ({ ...item, translatedTitle: seed.translationCache.get(item.title) })), { runId: "warm-seed" });
  await repository.save();
}

async function executePath({ pathName, condition, runRoot, candidates, triagedBaseline }) {
  await fs.rm(runRoot, { recursive: true, force: true });
  await fs.mkdir(runRoot, { recursive: true });
  const warmSeed = makeWarmSeed(triagedBaseline);
  const seed = condition === "warm" ? copySeed(warmSeed) : { identityKeys: new Set(), translationCache: new Map(), items: {}, collections: {} };
  if (pathName === "local" && condition === "warm") await prepareLocalWarmState(runRoot, triagedBaseline, seed);

  const metrics = createMetrics();
  const wallStarted = performance.now();
  metrics.cache = { hits: 0, misses: 0 };
  metrics.llm = { callCount: 0, inputChars: 0, outputTokens: null, waitMs: 0 };
  metrics.fs = { reads: 0, writes: 0 };
  const stages = {};
  const operations = {};
  let peakRssBytes = process.memoryUsage().rss;
  const sampleMemory = () => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); };

  const triaged = await timed(stages, "stage1", async () => {
    const deduped = measured(operations, "stage1.dedupe", () => dedupWithDiagnostics(candidates));
    return measured(operations, "stage1.triage", () => deduped.items.map((item) => {
      const result = classifyItem(item, { hardPositiveTerms: [], hardNegativeTerms: [] }, null);
      return { ...item, grade: result.grade, final_grade: result.grade, grade_reason: result.grade_reason, needs_human_review: Boolean(result.flags?.needs_review) };
    }));
  });
  sampleMemory();
  const plan = buildMutationPlan(triaged);
  const createByKey = new Map(plan.create.map((entry) => [entry.key, entry]));
  const pending = plan.admitted.filter((item) => !seed.identityKeys.has(item.doi.toLowerCase()));
  metrics.cache.hits += plan.admitted.length - pending.length;
  metrics.cache.misses += pending.length;
  let backend = null;
  let restoreFetch = null;
  if (pathName === "desktop") {
    const transport = createCliExecutor(seed, metrics);
    backend = new ZoteroCliBackend({ executeCli: transport.executeCli, checkCliAvailable: async () => true, launchDesktop: false, retries: 1 });
  } else if (pathName === "web") {
    const transport = createWebFetch(seed, metrics);
    restoreFetch = globalThis.fetch;
    globalThis.fetch = transport.fetchImpl;
    backend = new ZoteroWebApiBackend({ userId: "1", apiKey: "fixture", retries: 1, intervalMs: 0, requestConcurrency: 4 });
  }

  let createdItems = [];
  try {
    await timed(stages, "stage2", async () => {
      if (pathName === "local") {
        const repository = await measuredAsync(operations, "stage2.local_load", () => new LocalRepository(path.join(runRoot, "local"), { sharedIndexPath: path.join(runRoot, "shared-index.json") }).load());
        metrics.fs.reads += 2;
        measured(operations, "stage2.local_upsert", () => repository.upsertPapers(plan.admitted, { runId: "fixture-run" }));
        await measuredAsync(operations, "stage2.local_save", () => repository.save());
        metrics.fs.writes += 3;
        createdItems = repository.papers;
        return;
      }
      if (!pending.length) { createdItems = plan.admitted.map((item) => ({ ...item, itemKey: itemKey(item) })); return; }
      const input = pending.map((item) => createByKey.get(itemKey(item)));
      const created = await measuredAsync(operations, "stage2.create_items", () => backend.createItems(input));
      const normalizedCreated = Array.isArray(created) ? created : created.created || [];
      const keys = normalizedCreated.map((item) => item.key || item.itemKey).filter(Boolean);
      const keySet = new Set(keys);
      const collectionOperations = plan.collectionChanges.map((operation) => ({ ...operation, itemKeys: operation.itemKeys.filter((key) => keySet.has(key)) })).filter((operation) => operation.itemKeys.length);
      await measuredAsync(operations, "stage2.collection_attach", () => backend.addItemsToCollections(collectionOperations, { verify: pathName === "web" }));
      createdItems = plan.admitted.map((item) => ({ ...item, itemKey: itemKey(item) }));
    });
    sampleMemory();

    const translations = await timed(stages, "stage3", async () => {
      const output = measured(operations, "stage3.translation_cache", () => {
        const values = new Map();
        for (const item of plan.admitted) {
          if (seed.translationCache.has(item.title)) {
            metrics.cache.hits += 1;
            values.set(item.title, seed.translationCache.get(item.title));
          } else {
            metrics.cache.misses += 1;
            metrics.llm.callCount += 1;
            metrics.llm.inputChars += item.title.length;
            values.set(item.title, `译文：${item.title}`);
          }
        }
        return values;
      });
      if (backend && metrics.llm.callCount) {
        await measuredAsync(operations, "stage3.metadata_write", () => backend.writeMetadataBatch(plan.admitted.map((item) => ({ itemKey: itemKey(item), version: 1, fields: { shortTitle: output.get(item.title) } }))));
      }
      return output;
    });
    sampleMemory();

    const exportRows = await timed(stages, "stage4", async () => {
      const rows = plan.admitted.map((item) => ({ identity: item.doi.toLowerCase(), title: item.title, translatedTitle: translations.get(item.title), ruleGrade: item.grade, semanticGrade: item.grade, finalGrade: item.final_grade, source: item.source_channel, journal: item.journal, needsHumanReview: item.needs_human_review })).sort((a, b) => a.identity.localeCompare(b.identity));
      await fs.writeFile(path.join(runRoot, "export.json"), `${JSON.stringify({ rows }, null, 2)}\n`, "utf8");
      metrics.fs.writes += 1;
      return rows;
    });
    sampleMemory();

    const notification = await timed(stages, "stage5", async () => {
      const runSummary = buildRunSummary({ runId: "fixture-run", pipelineMode: pathName, status: "completed", startedAt: FIXED_NOW, finishedAt: FIXED_NOW, durationMs: 0, runReport: { counts: { fetched_count: candidates.length, duplicate_removed_count: candidates.length - triaged.length, grade_counts: gradeCounts(triaged) }, failures: [] }, createdItems: plan.admitted, translationSummary: { success_count: plan.admitted.length }, artifacts: [], outputRoot: path.join(repoRoot, "tests", "runs", "canonical-output") });
      const receipt = createNotificationReceipt({ notificationType: "run_summary", runId: "fixture-run", businessSubject: "fixture", eventEpoch: "fixture", payload: runSummary, recipient: "benchmark@example.test", clock: () => new Date(FIXED_NOW) });
      return { decision: "skipped_fixture_transport", dedupeKey: receipt.dedupeKey, messageId: receipt.messageId };
    });
    const wallFinished = performance.now();
    sampleMemory();

    const mutationPlan = {
      items: plan.admitted.map((item) => ({ identity: item.doi.toLowerCase(), key: itemKey(item), metadata: createByKey.get(itemKey(item)) })),
      collections: plan.collectionChanges,
      metadataUpdates: plan.admitted.map((item) => ({ key: itemKey(item), shortTitle: translations.get(item.title) })),
    };
    const businessOutput = {
      identities: triaged.map((item) => item.doi.toLowerCase()).sort(),
      grades: triaged.map((item) => ({ identity: item.doi.toLowerCase(), grade: item.final_grade })).sort((a, b) => a.identity.localeCompare(b.identity)),
      metadata: plan.create,
      mutationPlan,
      collectionChanges: plan.collectionChanges,
      notification: { decision: notification.decision },
      exportRows,
    };
    const sideEffects = { zoteroMutationPlan: mutationPlan, exportRows, notificationDecision: notification.decision, ledgerOperations: ["create_or_reuse", "route_collections", "write_metadata", "export", "notification"] };
    const totalMs = wallFinished - wallStarted;
    const hotspot = Object.entries(stages).sort((a, b) => b[1] - a[1])[0];
    return { path: pathName, condition, totalMs, stages, operations, hotspot: { name: hotspot[0], ms: hotspot[1] }, metrics: { ...metrics, peakRssBytes }, businessOutput, businessHash: canonicalHash(businessOutput), sideEffectHash: canonicalHash(sideEffects) };
  } finally {
    if (restoreFetch) globalThis.fetch = restoreFetch;
  }
}

export async function runFixtureBenchmark({ outputRoot = defaultOutput, count = 300, formalRuns = 3 } = {}) {
  const candidates = makeFixtureCandidates(count);
  const triagedBaseline = dedupWithDiagnostics(candidates).items.map((item) => { const result = classifyItem(item, {}, null); return { ...item, grade: result.grade, final_grade: result.grade }; });
  const inputHash = canonicalHash(candidates);
  const report = { schemaVersion: 1, input: { hash: inputHash, candidateCount: candidates.length, dedupedCount: triagedBaseline.length }, warmupRuns: 1, formalRuns, conditions: {} };
  for (const pathName of ["desktop", "web", "local"]) {
    report.conditions[pathName] = {};
    for (const condition of ["cold", "warm"]) {
      await executePath({ pathName, condition, runRoot: path.join(outputRoot, "warmup", pathName, condition), candidates, triagedBaseline });
      const samples = [];
      for (let index = 0; index < formalRuns; index += 1) samples.push(await executePath({ pathName, condition, runRoot: path.join(outputRoot, "formal", pathName, condition, String(index)), candidates, triagedBaseline }));
      const businessEquivalent = samples.every((sample) => compareBusinessEquivalence(samples[0].businessOutput, sample.businessOutput).equivalent);
      const sideEffectsEquivalent = samples.every((sample) => sample.sideEffectHash === samples[0].sideEffectHash);
      report.conditions[pathName][condition] = {
        medianTotalMs: median(samples.map((sample) => sample.totalMs)),
        medianStages: Object.fromEntries(Object.keys(samples[0].stages).map((name) => [name, median(samples.map((sample) => sample.stages[name]))])),
        medianOperations: Object.fromEntries(Object.keys(samples[0].operations).map((name) => [name, median(samples.map((sample) => sample.operations[name]))])),
        medianMetrics: {
          httpRequests: median(samples.map((sample) => sample.metrics.http.total)),
          zoteroRequests: median(samples.map((sample) => sample.metrics.zotero.total)),
          zoteroReads: median(samples.map((sample) => sample.metrics.zotero.read)),
          zoteroWrites: median(samples.map((sample) => sample.metrics.zotero.write)),
          llmCalls: median(samples.map((sample) => sample.metrics.llm.callCount)),
          llmInputChars: median(samples.map((sample) => sample.metrics.llm.inputChars)),
          cacheHits: median(samples.map((sample) => sample.metrics.cache.hits)),
          cacheMisses: median(samples.map((sample) => sample.metrics.cache.misses)),
          retryCount: median(samples.map((sample) => sample.metrics.retryCount)),
          status429: median(samples.map((sample) => sample.metrics.status429)),
          retryAfterCount: median(samples.map((sample) => sample.metrics.retryAfterCount)),
          backoffCount: median(samples.map((sample) => sample.metrics.backoffCount)),
          peakConcurrency: median(samples.map((sample) => sample.metrics.peakConcurrency)),
          peakRssBytes: median(samples.map((sample) => sample.metrics.peakRssBytes)),
          filesystemReads: median(samples.map((sample) => sample.metrics.fs.reads)),
          filesystemWrites: median(samples.map((sample) => sample.metrics.fs.writes)),
        },
        hotspot: Object.entries(Object.fromEntries(Object.keys(samples[0].stages).map((name) => [name, median(samples.map((sample) => sample.stages[name]))]))).sort((a, b) => b[1] - a[1]).map(([name, ms]) => ({ name, ms }))[0],
        businessHash: samples[0].businessHash,
        sideEffectHash: samples[0].sideEffectHash,
        businessEquivalent,
        sideEffectsEquivalent,
        samples: samples.map(({ totalMs, stages, operations, metrics, businessHash, sideEffectHash }) => ({ totalMs, stages, operations, metrics, businessHash, sideEffectHash })),
      };
    }
  }
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.writeFile(path.join(outputRoot, "summary.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const countArg = process.argv.find((value) => String(value).startsWith("--count="));
  const count = countArg ? Number(countArg.split("=")[1]) : 300;
  const report = await runFixtureBenchmark({ count });
  console.log(JSON.stringify({ input: report.input, conditions: Object.fromEntries(Object.entries(report.conditions).map(([pathName, value]) => [pathName, Object.fromEntries(Object.entries(value).map(([condition, result]) => [condition, { medianTotalMs: result.medianTotalMs, hotspot: result.hotspot, metrics: result.medianMetrics, businessEquivalent: result.businessEquivalent, sideEffectsEquivalent: result.sideEffectsEquivalent }]))])) }, null, 2));
}
