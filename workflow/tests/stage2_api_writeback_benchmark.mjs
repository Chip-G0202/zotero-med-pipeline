import "../tools/lib/env_file_bootstrap.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildStage2SmokeCleanupManifest } from "../tools/maintenance/stage2_smoke_cleanup.mjs";
import { Stage2RecoveryManifestStore } from "../tools/maintenance/stage2_recovery_manifest.mjs";
import { yyMd } from "../tools/lib/date_label_support.mjs";

function argValue(argv, name, fallback = "") {
  const prefix = `--${name}=`;
  const inline = argv.find((entry) => String(entry || "").startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.findIndex((entry) => String(entry || "") === `--${name}`);
  return index >= 0 && index + 1 < argv.length ? String(argv[index + 1] || "") : fallback;
}

function hasArg(argv, name) {
  return argv.some((entry) => String(entry || "") === `--${name}` || String(entry || "").startsWith(`--${name}=`));
}

function repoRootFromHere() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function safeRunId(runId) {
  return String(runId || "").replace(/[^a-zA-Z0-9._-]/g, "_") || "stage2-benchmark";
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function sampleItems(items, limit, offset = 0) {
  const source = Array.isArray(items) ? items : [];
  const start = Math.max(0, Number(offset || 0));
  const n = Number(limit || 0);
  return n > 0 ? source.slice(start, start + n) : source.slice(start);
}

function makeRunReport(runId) {
  return {
    run_id: runId,
    status: "stage2_benchmark_input",
    counts: {},
    steps: {},
    generated_at: new Date().toISOString(),
  };
}

function summarizeStage2(summary, elapsedMs, cleanup, shortTitleUpdate, shortTitleVerification) {
  const runStats = summary?.run_stats || {};
  const counters = summary?.counters || {};
  return {
    status: "completed",
    elapsed_ms: elapsedMs,
    created: Number(counters.created || 0),
    failed: Number(counters.failed || 0),
    skipped_duplicate_in_pool: Number(counters.skipped_duplicate_in_pool || 0),
    source_collection_count: Object.keys(summary?.source_collections || {}).length,
    grade_collection_count: Object.keys(summary?.grade_collections || {}).length,
    collection_setup_ms: Number(runStats.collection_setup_ms || 0),
    item_writeback_ms: Number(runStats.item_writeback_ms || 0),
    collection_attach_ms: Number(runStats.collection_attach_duration || 0),
    tag_cleanup_ms: Number(runStats.tag_cleanup_ms || 0),
    star_migration_ms: Number(runStats.star_migration_ms || 0),
    batch_create_request_count: Number(runStats.batch_create_request_count || 0),
    batch_create_item_count: Number(runStats.batch_create_item_count || 0),
    batch_create_success_count: Number(runStats.batch_create_success_count || 0),
    batch_create_failed_count: Number(runStats.batch_create_failed_count || 0),
    batch_create_fallback_count: Number(runStats.batch_create_fallback_count || 0),
    batch_create_fallback_errors: Array.isArray(runStats.batch_create_fallback_errors) ? runStats.batch_create_fallback_errors : [],
    collection_attach_calls: Number(runStats.collection_attach_calls || 0),
    mcp_calls_by_tool: runStats.mcp_calls_by_tool || {},
    shorttitle_update: shortTitleUpdate || null,
    shorttitle_verification: shortTitleVerification || null,
    cleanup,
  };
}


async function updateShortTitles({ items, callTool }) {
  const started = Date.now();
  const updates = items.map(it => ({
    itemKey: it.itemKey,
    shortTitle: it.shortTitle || it.title_translation || ""
  })).filter(u => u.shortTitle && u.itemKey);

  const results = [];
  for (const update of updates) {
    try {
      await callTool("write_metadata", { itemKey: update.itemKey, fields: { shortTitle: update.shortTitle } }, 990300);
      results.push({ key: update.itemKey, ok: true });
    } catch (e) {
      results.push({ key: update.itemKey, ok: false, error: e.message });
    }
  }

  return {
    updates_attempted: updates.length,
    updates_succeeded: results.filter(r => r.ok).length,
    updates_failed: results.filter(r => !r.ok).length,
    errors: results.filter(r => !r.ok).map(r => r.error),
    elapsed_ms: Date.now() - started
  };
}

async function verifyShortTitles({ items, callTool }) {
  const started = Date.now();
  const itemKeys = items.map(it => it.itemKey).filter(Boolean);

  if (!itemKeys.length) {
    return { verified_count: 0, shorttitle_correct: 0, shorttitle_missing: 0, errors: [] };
  }

  const result = await callTool("get_items_details", { itemKeys, mode: "full" }, 990400);
  const data = JSON.parse(result?.content?.[0]?.text || "[]");
  const details = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];

  let correct = 0;
  let missing = 0;
  const errors = [];

  for (const detail of details) {
    const item = items.find(it => it.itemKey === detail.key);
    if (!item) continue;

    const expected = item.shortTitle || item.title_translation || "";
    const actual = detail.data?.shortTitle || "";

    if (expected && actual && expected === actual) {
      correct++;
    } else if (!expected && !actual) {
      correct++;
    } else {
      missing++;
      if (expected && !actual) {
        errors.push(detail.key + ": shortTitle expected but missing");
      }
    }
  }

  return {
    verified_count: details.length,
    shorttitle_correct: correct,
    shorttitle_missing: missing,
    errors,
    elapsed_ms: Date.now() - started
  };
}

export async function runStage2WritebackBenchmark(argv = process.argv, {
  runStage2,
  recoveryStoreFactory = Stage2RecoveryManifestStore.initialize,
  writeCleanupManifest = writeJson,
} = {}) {
  const repoRoot = repoRootFromHere();
  const runId = argValue(argv, "run-id", `stage2-bench-${Date.now()}`);
  const inputFile = argValue(argv, "input-file", path.join(repoRoot, "review_results", "pipeline", "26.7.8", "writeback_ready_items.json"));
  const limit = argValue(argv, "limit", "");
  const offset = argValue(argv, "offset", "0");
  const outputRoot = argValue(argv, "output-root", path.join(repoRoot, "review_results", "stage2_benchmark"));
  const overrideDate = argValue(argv, "date", "2099-01-02T00:00:00.000Z");
  const effectiveDate = new Date(overrideDate);
  if (Number.isNaN(effectiveDate.getTime())) throw new Error("benchmark_date_invalid");
  const pipelineDate = yyMd(effectiveDate);
  const realRun = hasArg(argv, "real-run");
  const cleanupEnabled = false;

  const items = sampleItems(await readJson(inputFile, []), limit, offset);
  const researchRoot = path.join(outputRoot, "review_results");
  const pipelineDir = path.join(researchRoot, "pipeline", pipelineDate);
  await fs.mkdir(pipelineDir, { recursive: true });
  const replayInputPath = path.join(pipelineDir, "writeback_ready_items.json");
  await fs.writeFile(replayInputPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(pipelineDir, "run_report.json"), `${JSON.stringify(makeRunReport(runId), null, 2)}\n`, "utf8");

  const previousEnv = { ...process.env };
  Object.assign(process.env, {
    ZOTERO_BACKEND: process.env.ZOTERO_BACKEND || "auto",
    ZOTERO_API_KEY: process.env.ZOTERO_API_KEY || "",
    ZOTERO_PROJECT_ROOT: outputRoot,
    review_results_ROOT: "review_results",
    review_results_OVERRIDE_DATE: overrideDate,
    review_results_RUN_ID: runId,
    ZOTERO_CLI_CREATE_ITEM_DISABLE_IMPORT_FALLBACK: "1",
    ZOTERO_WRITEBACK_BATCH_CREATE_DISABLED: process.env.ZOTERO_WRITEBACK_BATCH_CREATE_DISABLED || "0",
    ZOTERO_STAR_MIGRATION_MODE: process.env.ZOTERO_STAR_MIGRATION_MODE || "disabled",
    ZOTERO_WRITEBACK_OBSERVATION_MODE: process.env.ZOTERO_WRITEBACK_OBSERVATION_MODE || "1",
  });
  const selectedBackend = process.env.ZOTERO_BACKEND || "auto";

  if (!realRun) process.env.review_results_DRY_RUN = "1";

  let summary = null;
  let cleanup = null;
  let shortTitleUpdate = null;
  let shortTitleVerification = null;
  const cleanupManifestPath = path.join(pipelineDir, "stage2_smoke_cleanup_manifest.json");
  const recoveryManifestPath = path.join(pipelineDir, `stage2_recovery_${safeRunId(runId)}.json`);
  let recovery = null;
  const buildCleanupManifest = () => buildStage2SmokeCleanupManifest({
    runId,
    backend: selectedBackend,
    createdItemKeys: realRun ? recovery?.manifest?.createdItemKeys || [] : [],
    createdCollections: realRun ? recovery?.manifest?.createdCollections || [] : [],
    reusedCollectionKeys: realRun ? recovery?.manifest?.reusedCollectionKeys || [] : [],
    localIndexPath: path.join(researchRoot, "zotero_index", "current_library_index.json"),
    reportPath: path.join(pipelineDir, "stage2_writeback_benchmark_report.json"),
    realRun: Boolean(realRun && recovery),
  });
  const started = Date.now();
  let cleanupManifestWriteAttempted = false;
  try {
    if (realRun) {
      recovery = await recoveryStoreFactory({
        filePath: recoveryManifestPath,
        runId,
        backend: selectedBackend,
        localIndexPath: path.join(researchRoot, "zotero_index", "current_library_index.json"),
      });
    }
    const stage2Url = pathToFileURL(path.join(repoRoot, "workflow", "tools", "stage2", "main.mjs")).href;
    const stageRunner = runStage2 || (await import(`${stage2Url}?bench=${Date.now()}`)).runZoteroWriteback;
    summary = await stageRunner({
      argv: ["node", "stage2/main.mjs", `--input-file=${replayInputPath}`],
      recovery,
    });
    if (realRun && !summary?.writeback_items) {
      summary = await readJson(path.join(pipelineDir, "zotero_writeback_summary.json"), summary);
    }
    if (realRun && summary?.writeback_items?.length) {
      const { createZoteroBackendToolCall } = await import(`${pathToFileURL(path.join(repoRoot, "workflow", "tools", "lib", "zotero_backend_client.mjs")).href}?bench=${Date.now()}`);
      const callTool = await createZoteroBackendToolCall();

      // Update shortTitles for items that have title_translation
      const itemsWithTranslation = (summary?.writeback_items || []).filter(it => it.shortTitle || it.title_translation);
      if (itemsWithTranslation.length) {
        shortTitleUpdate = await updateShortTitles({ items: itemsWithTranslation, callTool });
      }

      // Verify shortTitles via readback
      shortTitleVerification = await verifyShortTitles({ items: summary?.writeback_items || [], callTool });

    }
    if (recovery) await recovery.complete();
    cleanupManifestWriteAttempted = true;
    await writeCleanupManifest(cleanupManifestPath, buildCleanupManifest());
  } catch (error) {
    if (recovery) await recovery.markFailed({ stage: "stage2_benchmark", code: "benchmark_failed" }).catch(() => {});
    if (!cleanupManifestWriteAttempted) {
      await writeCleanupManifest(cleanupManifestPath, buildCleanupManifest()).catch(() => {});
    }
    throw error;
  } finally {
    process.env = previousEnv;
  }

  const elapsedMs = Date.now() - started;
  const report = {
    run_id: runId,
    real_run: realRun,
    cleanup_enabled: cleanupEnabled,
    input_file: inputFile,
    offset: Number(offset || 0),
    replay_input_path: replayInputPath,
    output_root: outputRoot,
    pipeline_dir: pipelineDir,
    cleanup_manifest_path: cleanupManifestPath,
    recovery_manifest_path: recovery ? recoveryManifestPath : "",
    item_count: items.length,
    summary_path: path.join(pipelineDir, realRun ? "zotero_writeback_summary.json" : "zotero_writeback_dry_run_summary.json"),
    result: summarizeStage2(summary, elapsedMs, cleanup, shortTitleUpdate, shortTitleVerification),
  };
  const reportPath = path.join(pipelineDir, "stage2_writeback_benchmark_report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  report.report_path = reportPath;
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runStage2WritebackBenchmark(process.argv).then((report) => {
    console.log(JSON.stringify(report, null, 2));
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
