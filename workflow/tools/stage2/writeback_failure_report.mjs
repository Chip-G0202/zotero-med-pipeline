import fs from "node:fs/promises";
import path from "node:path";
import { fmtDateRfc } from "../lib/date_label_support.mjs";
import { buildWritebackSideEffectSummary } from "./side_effect_summary.mjs";

export async function markWritebackFailureReport({
  err,
  runtime,
  mcpCallsByTool = {},
  historyCollectionModificationForbidden = false,
} = {}) {
  const pipelineDir = runtime.pipelineDir;
  const runReportPath = path.join(pipelineDir, "run_report.json");
  const triagedPath = path.join(pipelineDir, "writeback_ready_items.json");
  const summaryPath = path.join(pipelineDir, "zotero_writeback_summary.json");
  const runReport = JSON.parse(await fs.readFile(runReportPath, "utf8"));
  runReport.failures = Array.isArray(runReport.failures) ? runReport.failures : [];
  const reason = String(err?.message || err);
  const details = err?.details || null;
  let plannedCount = "unknown";
  try {
    const triaged = JSON.parse(await fs.readFile(triagedPath, "utf8"));
    if (Array.isArray(triaged)) plannedCount = triaged.filter((x) => x?.grade !== "D").length;
  } catch {}
  const zoteroBackendReady = /mcp_not_ready|zotero_backend_not_ready|not ready|econnrefused|fetch failed|connection refused/i.test(reason) ? false : "unknown";
  const writebackSideEffectSummary = buildWritebackSideEffectSummary({
    itemsPlannedCount: plannedCount,
    counters: { total: plannedCount, created: 0, failed: 0 },
    failures: [],
    dryRun: false,
    zoteroBackendReady,
    mcpCallsByTool,
    failureReason: reason,
    executionStatus: zoteroBackendReady === false ? "not_executed_zotero_backend_unavailable" : "not_executed",
  });
  runReport.failures.push({
    stage: "stage2_med_zotero_bridge",
    reason,
    details,
    at: new Date().toISOString(),
  });
  runReport.steps = runReport.steps || {};
  runReport.signals = runReport.signals || {};
  runReport.signals.pool_collection_missing = details?.signal === "pool_collection_missing";
  runReport.signals.pool_collection_ambiguous = details?.signal === "pool_collection_ambiguous";
  runReport.signals.collection_scope_blocked = details?.signal === "collection_scope_blocked" || /collection_scope_blocked/i.test(reason);
  runReport.signals.history_collection_modification_forbidden = historyCollectionModificationForbidden;
  runReport.collection_scope_guard_enabled = true;
  runReport.collection_scope_blocked_count = Number(details?.collection_scope_blocked_count || 0);
  runReport.collection_scope_blocked_samples = details?.collection_scope_blocked_samples || [];
  runReport.writeback_side_effect_summary = writebackSideEffectSummary;
  runReport.steps.med_zotero_bridge = {
    ok: false,
    zotero_backend_required: true,
    zotero_backend_required: true,
    pending_writeback: true,
    connector_ok: false,
    downgrade_reason: reason,
    downgrade_details: details,
    writeback_side_effect_summary: writebackSideEffectSummary,
  };
  runReport.stage_timings = runReport.stage_timings || {};
  runReport.stage_timings.zotero_writeback = {
    status: "failed",
    reason,
    details,
  };
  await fs.writeFile(summaryPath, JSON.stringify({
    date: fmtDateRfc(runtime.now),
    status: "failed",
    failure: {
      reason,
      details,
    },
    writeback_side_effect_summary: writebackSideEffectSummary,
  }, null, 2), "utf8");
  await fs.writeFile(runReportPath, JSON.stringify(runReport, null, 2), "utf8");
}
