import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

await import("../../workflow/tools/lib/env_file_bootstrap.mjs");

import { captureState, verifyState } from "../helpers/benchmark_state.mjs";
import { createZoteroBackendClient } from "../../workflow/tools/lib/zotero_backend_client.mjs";
import { Stage2RecoveryManifestStore } from "../../workflow/tools/maintenance/stage2_recovery_manifest.mjs";
import { buildStage2SmokeCleanupManifest, runStage2SmokeCleanup } from "../../workflow/tools/maintenance/stage2_smoke_cleanup.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const sourceRun = path.join(repoRoot, "tests/runs/dual-1783774142820");
const runId = `stage3-metadata-${Date.now()}`;
const runDir = path.join(repoRoot, "tests/runs", runId);
const snapshotDir = path.join(runDir, "input_snapshot");
const prestateDir = path.join(runDir, "prestate");
await fs.mkdir(snapshotDir, { recursive: true });

const source = JSON.parse(await fs.readFile(path.join(sourceRun, "web_api/output/review_results/pipeline/96.12.27/abc_translation_backfill.json"), "utf8"));
const candidates = (source.updated_items || []).map((item) => ({ title: item.title, shortTitle: item.shortTitle }));
if (candidates.length !== 241) throw new Error(`expected_241_candidates_got_${candidates.length}`);
const snapshotBody = `${JSON.stringify(candidates, null, 2)}\n`;
await fs.writeFile(path.join(snapshotDir, "metadata-writeback-candidates.json"), snapshotBody);
const snapshotHash = crypto.createHash("sha256").update(snapshotBody).digest("hex");
const prestate = await captureState(repoRoot, prestateDir);

process.env.ZOTERO_BACKEND = "web_api";
const stats = { phase: "idle", phases: {} };
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(typeof input === "string" ? input : input?.url || input);
  if (!url.startsWith("https://api.zotero.org")) return nativeFetch(input, init);
  const phase = stats.phases[stats.phase] ||= { total: 0, methods: {}, active: 0, peak: 0, rttMs: [], statuses: {}, batchSizes: [] };
  const method = String(init.method || "GET").toUpperCase();
  phase.total++;
  phase.methods[method] = (phase.methods[method] || 0) + 1;
  phase.active++;
  phase.peak = Math.max(phase.peak, phase.active);
  try {
    const body = JSON.parse(String(init.body || "null"));
    if (Array.isArray(body)) phase.batchSizes.push(body.length);
  } catch {}
  const started = performance.now();
  try {
    const response = await nativeFetch(input, init);
    phase.statuses[response.status] = (phase.statuses[response.status] || 0) + 1;
    return response;
  } finally {
    phase.active--;
    phase.rttMs.push(performance.now() - started);
  }
};

function summarizePhase(phase = {}) {
  const samples = [...(phase.rttMs || [])].sort((a, b) => a - b);
  const percentile = (p) => samples.length ? samples[Math.ceil(samples.length * p) - 1] : 0;
  return {
    total: phase.total || 0,
    methods: phase.methods || {},
    batchSizes: phase.batchSizes || [],
    peak: phase.peak || 0,
    rttAverageMs: samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0,
    rttP50Ms: percentile(0.5),
    rttP95Ms: percentile(0.95),
    rttMaxMs: samples.at(-1) || 0,
    statuses: phase.statuses || {},
  };
}

const { callTool } = await createZoteroBackendClient({ preferredBackend: "web_api" });
const backend = callTool.adapter;
const report = { runId, snapshotHash, candidateCount: candidates.length, tiers: [], prestateFiles: prestate.files.length };

for (const count of [20, 50, 241]) {
  const tierRunId = `${runId}-${count}`;
  const tierDir = path.join(runDir, String(count));
  await fs.mkdir(tierDir, { recursive: true });
  const recovery = await Stage2RecoveryManifestStore.initialize({
    filePath: path.join(tierDir, "recovery-manifest.json"),
    runId: tierRunId,
    backend: "web_api",
  });
  const tier = { count, created: 0, metadata: null, cleanup: null, error: "" };
  let collection = null;
  try {
    stats.phase = `create_${count}`;
    collection = await backend.createCollection(`paperflow-stage3-benchmark-${tierRunId}`, null);
    await recovery.recordCollections([{ key: collection.key, name: `paperflow-stage3-benchmark-${tierRunId}`, role: "benchmark_root", createdByRun: true }]);
    const selected = candidates.slice(0, count);
    const created = [];
    for (let offset = 0; offset < selected.length; offset += 50) {
      const batch = selected.slice(offset, offset + 50).map((item, index) => ({
        inputIndex: offset + index,
        itemType: "journalArticle",
        title: item.title,
        shortTitle: "",
        collections: [collection.key],
      }));
      const results = await backend.createItems(batch);
      const failures = results.filter((item) => !item.key);
      if (failures.length) throw new Error(`create_failed_count_${failures.length}`);
      created.push(...results);
      await recovery.recordItems(results.map((item) => item.key));
    }
    tier.created = created.length;
    const updates = created.map((item, index) => ({ itemKey: item.key, fields: { shortTitle: selected[index].shortTitle } }));
    stats.phase = `metadata_${count}`;
    const started = performance.now();
    const result = await backend.writeMetadataBatch(updates);
    const durationMs = performance.now() - started;
    tier.metadata = {
      durationMs,
      updated: result.updated.length,
      unchanged: result.unchanged.length,
      failed: result.failed.length,
      versionLookupCount: stats.phases[`metadata_${count}`]?.methods?.GET || 0,
      requests: summarizePhase(stats.phases[`metadata_${count}`]),
      conflicts: result.failed.filter((entry) => /HTTP (412|428)/.test(entry.error)).length,
    };
    if (result.failed.length || result.updated.length + result.unchanged.length !== count) throw new Error("metadata_result_incomplete");
    await recovery.complete();
  } catch (error) {
    tier.error = String(error?.message || error).slice(0, 500);
    await recovery.markFailed({ stage: "metadata_writeback_benchmark", code: "tier_failed" }).catch(() => {});
  } finally {
    stats.phase = `cleanup_${count}`;
    const cleanupStarted = performance.now();
    const cleanupManifest = buildStage2SmokeCleanupManifest({
      runId: tierRunId,
      backend: "web_api",
      createdItemKeys: recovery.manifest.createdItemKeys,
      createdCollections: recovery.manifest.createdCollections,
      realRun: true,
    });
    await fs.writeFile(path.join(tierDir, "cleanup-manifest.json"), JSON.stringify(cleanupManifest, null, 2));
    tier.cleanup = await runStage2SmokeCleanup({ manifest: cleanupManifest, backend, apply: true, expectedRunId: tierRunId });
    tier.cleanup.durationMs = performance.now() - cleanupStarted;
    tier.cleanup.requests = summarizePhase(stats.phases[`cleanup_${count}`]);
    tier.localState = await verifyState(repoRoot, prestate);
    report.tiers.push(tier);
  }
  if (tier.error || !tier.cleanup.ok || !tier.localState.ok) break;
}

report.status = report.tiers.length === 3 && report.tiers.every((tier) => !tier.error && tier.cleanup.ok && tier.localState.ok) ? "completed" : "failed";
report.oldBaseline = { count: 241, metadataWriteMs: 243979, requestModel: "5 batch GET + 5 invalid PATCH /items + 241 GET version + 241 single PATCH fallback" };
const fullTier = report.tiers.find((tier) => tier.count === 241);
report.analysis = {
  rootCause: "PATCH /items is not the Zotero multi-object update method; each failed batch amplified into per-item version GET + PATCH fallback",
  newRequestModel: "5 batch GET + 5 POST /items, serial batches of at most 50",
  improvementMs: fullTier ? report.oldBaseline.metadataWriteMs - fullTier.metadata.durationMs : null,
  improvementPercent: fullTier ? Number(((1 - fullTier.metadata.durationMs / report.oldBaseline.metadataWriteMs) * 100).toFixed(1)) : null,
  concurrencyRecommendation: "keep global limit 4 and metadata batch concurrency 1",
};
await fs.writeFile(path.join(runDir, "metadata-writeback-report.json"), `${JSON.stringify(report, null, 2)}\n`);
const lines = [
  `# Web metadata writeback benchmark ${runId}`,
  "",
  `Status: ${report.status}; snapshot ${snapshotHash}; candidates 241.`,
  "",
  `Root cause: ${report.analysis.rootCause}.`,
  `New model: ${report.analysis.newRequestModel}.`,
  "",
  "| Items | Metadata ms | GET | POST | Batches | Updated | Unchanged | Failed | Cleanup residual |",
  "|---:|---:|---:|---:|---|---:|---:|---:|---:|",
  ...report.tiers.map((tier) => `| ${tier.count} | ${Math.round(tier.metadata?.durationMs || 0)} | ${tier.metadata?.requests?.methods?.GET || 0} | ${tier.metadata?.requests?.methods?.POST || 0} | ${(tier.metadata?.requests?.batchSizes || []).join("+")} | ${tier.metadata?.updated || 0} | ${tier.metadata?.unchanged || 0} | ${tier.metadata?.failed || 0} | ${(tier.cleanup?.residual?.items || 0) + (tier.cleanup?.residual?.collections || 0)} |`),
  "",
  "Old 241-item baseline: 243979 ms. This isolated run does not call translation, RSS, PubMed, LLM, or Desktop.",
  `Improvement: ${Math.round(report.analysis.improvementMs || 0)} ms (${report.analysis.improvementPercent ?? 0}%). ${report.analysis.concurrencyRecommendation}.`,
];
await fs.writeFile(path.join(runDir, "metadata-writeback-report.md"), `${lines.join("\n")}\n`);
console.log(JSON.stringify({ runId, runDir, status: report.status, tiers: report.tiers.map((tier) => ({ count: tier.count, metadataMs: tier.metadata?.durationMs, cleanupOk: tier.cleanup?.ok, error: Boolean(tier.error) })) }));
if (report.status !== "completed") process.exitCode = 1;
