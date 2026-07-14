import fs from "node:fs/promises";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { seedIsolatedState } from "../helpers/benchmark_state.mjs";

function arg(name) {
  const prefix = `--${name}=`;
  return String(process.argv.find((value) => String(value).startsWith(prefix)) || "").slice(prefix.length);
}

const backend = arg("backend");
const runId = arg("run-id");
const runDir = path.resolve(arg("run-dir"));
const fixtureRoot = path.resolve(arg("fixture-root"));
if (!backend || !runId || !runDir || !fixtureRoot) throw new Error("backend_run_args_missing");

Object.assign(process.env, {
  ZOTERO_BACKEND: backend === "desktop" ? "cli" : "web_api",
  NOTIFICATION_ENABLED: "false",
  PAPERFLOW_ALLOW_FIXTURE_INPUT: "true",
  PAPERFLOW_BENCHMARK_COLLECTION_PREFIX: `benchmark-${backend}-${runId}`,
  APPLY_FEEDBACK_ITEM_ACTIONS: "true",
  ZOTERO_STAR_MIGRATION_MODE: "expand",
  review_results_FORCE_RUN: "true",
  FORCE_review_results_RUN: "true",
  review_results_OVERRIDE_DATE: "2096-12-27T00:00:00.000Z",
});
if (backend === "desktop") {
  process.env.ZOTERO_API_KEY = "";
  process.env.ZOTERO_CLI_WRITEBACK_BATCH_SIZE = "50";
}
process.argv.push(`--fixture-root=${fixtureRoot}`, `--output-root=${path.join(runDir, "output")}`);

const requests = { total: 0, methods: {}, endpoints: {}, statuses: {}, active: 0, peak: 0, waitMs: 0, retries: 0, status409: 0, status412: 0, status428: 0, status429: 0, retryAfterMs: [], rttMs: [], batchSizes: [] };
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(typeof input === "string" ? input : input?.url || input);
  if (!url.startsWith("https://api.zotero.org")) return nativeFetch(input, init);
  const method = String(init.method || "GET").toUpperCase();
  const pathname = new URL(url).pathname.replace(/\/[A-Z0-9]{8}(?=\/|$)/gi, "/:key");
  const started = performance.now();
  requests.total++;
  requests.methods[method] = (requests.methods[method] || 0) + 1;
  requests.endpoints[`${method} ${pathname}`] = (requests.endpoints[`${method} ${pathname}`] || 0) + 1;
  requests.active++;
  requests.peak = Math.max(requests.peak, requests.active);
  try {
    const response = await nativeFetch(input, init);
    requests.statuses[response.status] = (requests.statuses[response.status] || 0) + 1;
    if (response.status === 409) requests.status409++;
    if (response.status === 412) requests.status412++;
    if (response.status === 428) requests.status428++;
    if (response.status === 429) requests.status429++;
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      if (Number.isFinite(retryAfter)) requests.retryAfterMs.push(retryAfter * 1000);
    }
    return response;
  } finally {
    requests.active--;
    const elapsed = performance.now() - started;
    requests.waitMs += elapsed;
    requests.rttMs.push(elapsed);
    try {
      const parsed = JSON.parse(String(init.body || "null"));
      if (Array.isArray(parsed)) requests.batchSizes.push(parsed.length);
    } catch {}
  }
};

const { Stage2RecoveryManifestStore } = await import("../../workflow/tools/maintenance/stage2_recovery_manifest.mjs");
const { buildStage2SmokeCleanupManifest, runStage2SmokeCleanup } = await import("../../workflow/tools/maintenance/stage2_smoke_cleanup.mjs");
const { createZoteroBackendClient } = await import("../../workflow/tools/lib/zotero_backend_client.mjs");
const recoveryPath = path.join(runDir, "recovery-manifest.json");
const indexPath = path.join(runDir, "output", "review_results", "zotero_index", "current_library_index.json");
await fs.mkdir(runDir, { recursive: true });
const seededState = await seedIsolatedState(process.cwd(), path.join(runDir, "output"));
const fixture = JSON.parse(await fs.readFile(path.join(fixtureRoot, "candidates.json"), "utf8"));
const fixtureMetadata = JSON.parse(await fs.readFile(path.join(fixtureRoot, "metadata.json"), "utf8"));
if (!Array.isArray(fixture) || fixture.length !== fixtureMetadata.replayCandidates || fixtureMetadata.truncated !== false) {
  throw new Error("full_fixture_count_mismatch");
}
const recovery = await Stage2RecoveryManifestStore.initialize({ filePath: recoveryPath, runId, backend: process.env.ZOTERO_BACKEND, localIndexPath: indexPath });
const wallStarted = performance.now();
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();
let peakRssBytes = process.memoryUsage().rss;
const memoryTimer = setInterval(() => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); }, 100);
let report = null;
let cleanup = null;
let error = "";
let details = {};
let cleanupMs = 0;
try {
  const { runZoteroLiteratureFilter } = await import(`../../workflow/tools/stage0/main.mjs?benchmark=${Date.now()}`);
  report = await runZoteroLiteratureFilter({ stage2Recovery: recovery });
  await recovery.complete();
  const pipelineDir = path.join(runDir, "output", "review_results", "pipeline", "96.12.27");
  const readJson = async (name) => JSON.parse(await fs.readFile(path.join(pipelineDir, name), "utf8"));
  const writeback = await readJson("zotero_writeback_summary.json");
  const translation = await readJson("abc_translation_backfill.json");
  const stage1Report = await readJson("run_report.json");
  const triaged = await readJson("triaged_items.json");
  const writebackReady = await readJson("writeback_ready_items.json");
  const performanceSummary = await readJson("workflow_performance_summary.json").catch(() => null);
  const reportFiles = [];
  const reviewRoot = path.join(runDir, "output", "review_results", "文献评价");
  async function collectReports(directory) {
    let entries = [];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (cause) { if (cause?.code !== "ENOENT") throw cause; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await collectReports(file);
      else if (/\.(?:xlsx|docx)$/i.test(entry.name)) {
        const stat = await fs.stat(file);
        reportFiles.push({ relative: path.relative(path.join(runDir, "output"), file).replaceAll("\\", "/"), size: stat.size });
      }
    }
  }
  await collectReports(reviewRoot);
  details = {
    counters: writeback.counters,
    stage2: writeback.run_stats,
    stage1: {
      counts: stage1Report.counts,
      failures: Array.isArray(stage1Report.failures) ? stage1Report.failures.length : 0,
      llm: stage1Report.llm_review_execution_summary || null,
    },
    accounting: {
      candidates: fixture.length,
      triaged: Array.isArray(triaged) ? triaged.length : 0,
      writebackReady: Array.isArray(writebackReady) ? writebackReady.length : 0,
    },
    translation: {
      configured: translation.api_key_configured,
      total: translation.total,
      success: translation.success_count,
      failure: translation.failure_count,
      cacheHits: translation.cache_hits,
      timings: translation.timings,
    },
    reports: reportFiles,
    performanceSummary,
  };
} catch (cause) {
  error = String(cause?.stack || cause?.message || cause).slice(0, 2000);
  await recovery.markFailed({ stage: "dual_backend_benchmark", code: "workflow_failed" }).catch(() => {});
} finally {
  const createdKeys = new Set((recovery.manifest.createdCollections || []).filter((entry) => entry.createdByRun).map((entry) => entry.key));
  const cleanupManifest = buildStage2SmokeCleanupManifest({
    runId,
    backend: process.env.ZOTERO_BACKEND,
    createdItemKeys: recovery.manifest.createdItemKeys || [],
    createdCollections: recovery.manifest.createdCollections || [],
    reusedCollectionKeys: (recovery.manifest.reusedCollectionKeys || []).filter((key) => !createdKeys.has(key)),
    localIndexPath: indexPath,
    reportPath: path.join(runDir, "result.json"),
    realRun: true,
  });
  await fs.writeFile(path.join(runDir, "cleanup-manifest.json"), JSON.stringify(cleanupManifest, null, 2));
  const cleanupStarted = performance.now();
  if (cleanupManifest.cleanupEligible) {
    const client = await createZoteroBackendClient({ preferredBackend: process.env.ZOTERO_BACKEND });
    const first = await runStage2SmokeCleanup({ manifest: cleanupManifest, backend: client.callTool.adapter, apply: true, expectedRunId: runId });
    const second = await runStage2SmokeCleanup({ manifest: cleanupManifest, backend: client.callTool.adapter, apply: true, expectedRunId: runId });
    cleanup = { ok: first.ok === true && second.ok === true && second.deleted_items === 0 && second.deleted_collections === 0, first, second };
  } else {
    const empty = { ok: true, deleted_items: 0, deleted_collections: 0, already_absent_items: 0, already_absent_collections: 0, residual: { items: 0, collections: 0, local: 0, cloud: 0 } };
    cleanup = { ok: true, first: empty, second: empty };
  }
  cleanupMs = performance.now() - cleanupStarted;
}

clearInterval(memoryTimer);
eventLoop.disable();
requests.rttP95Ms = requests.rttMs.length ? [...requests.rttMs].sort((a, b) => a - b)[Math.ceil(requests.rttMs.length * 0.95) - 1] : 0;
requests.rttAverageMs = requests.rttMs.length ? requests.waitMs / requests.rttMs.length : 0;

const result = {
  backend,
  runId,
  status: report?.status || "failed",
  stages: Object.fromEntries((report?.stages || []).map((stage) => [stage.name, stage.durationMs])),
  workflowMs: report?.startedAt && report?.finishedAt ? Date.parse(report.finishedAt) - Date.parse(report.startedAt) : null,
  wallMs: performance.now() - wallStarted,
  cleanupMs,
  requests,
  resourceUsage: { peakRssBytes, eventLoopDelayMeanMs: eventLoop.mean / 1e6, eventLoopDelayMaxMs: eventLoop.max / 1e6 },
  details,
  seededState,
  cleanup,
  recovery: {
    state: recovery.manifest.state,
    finalized: recovery.manifest.finalized,
    createdItems: recovery.manifest.createdItemKeys.length,
    createdCollections: recovery.manifest.createdCollections.filter((entry) => entry.createdByRun).length,
  },
  error,
};
await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ status: result.status, workflowMs: result.workflowMs, cleanupOk: cleanup?.ok, error: Boolean(error) }));
if (error || cleanup?.ok !== true) process.exitCode = 1;
