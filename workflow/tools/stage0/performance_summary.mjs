import fs from "node:fs/promises";
import path from "node:path";

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function sum(values) {
  return values.reduce((acc, value) => acc + asNumber(value), 0);
}

function pickCounts(source = {}, keys = []) {
  const counts = {};
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) counts[key] = source[key];
  }
  return counts;
}

function addSpan(spans, span) {
  const durationMs = asNumber(span.duration_ms ?? span.ms, 0);
  spans.push({
    name: span.name,
    category: span.category || "module",
    duration_ms: durationMs,
    count: span.count ?? null,
    avg_ms: span.avg_ms ?? (span.count ? durationMs / Math.max(1, asNumber(span.count, 1)) : null),
    max_ms: span.max_ms ?? null,
    source_artifact: span.source_artifact || "",
    details: span.details || {},
  });
}

function addStageSpans(spans, stages = []) {
  for (const stage of stages || []) {
    addSpan(spans, {
      name: `stage.${stage.name}`,
      category: "stage",
      duration_ms: stage.durationMs,
      source_artifact: "orchestrator_report.json",
      details: {
        status: stage.status,
        exitCode: stage.exitCode,
        command: stage.command,
      },
    });
  }
}

function addStage1TimingSpans(spans, timingDiagnostics = null) {
  const timings = timingDiagnostics?.stage_timings || {};
  for (const [name, timing] of Object.entries(timings)) {
    addSpan(spans, {
      name: `stage1.${name}`,
      category: "stage1",
      duration_ms: timing.ms,
      count: timing.items_reviewed
        ?? timing.input_count
        ?? timing.output_count
        ?? timing.deduped_count
        ?? timing.pre_llm_zotero_duplicate_checked_count
        ?? null,
      avg_ms: timing.avg_batch_duration_ms ?? null,
      max_ms: timing.max_batch_duration_ms ?? null,
      source_artifact: "timing_diagnostics.json",
      details: pickCounts(timing, [
        "status",
        "method",
        "batch_size",
        "items_reviewed",
        "total_request_attempts",
        "real_request_sent_count",
        "pre_llm_existing_duplicate_count",
        "pre_llm_zotero_duplicate_checked_count",
        "input_count",
        "output_count",
        "duplicate_removed_count",
      ]),
    });
  }
}

function addStage2Spans(spans, writebackSummary = null) {
  const runStats = writebackSummary?.run_stats || {};
  const counters = writebackSummary?.counters || {};
  const mcpCalls = runStats.mcp_calls_by_tool || {};
  const specs = [
    ["stage2.collection_setup", runStats.collection_setup_ms, null],
    ["stage2.item_writeback", runStats.item_writeback_ms, counters.created || counters.total || null],
    ["stage2.collection_attach", runStats.collection_attach_duration, runStats.collection_attach_calls || null],
    ["stage2.tag_cleanup", runStats.tag_cleanup_ms, writebackSummary?.tag_cleanup_stats?.scanned || null],
    ["stage2.star_migration", runStats.star_migration_ms, writebackSummary?.migration_stats?.eligible_items || null],
  ];
  for (const [name, duration, count] of specs) {
    addSpan(spans, {
      name,
      category: "stage2",
      duration_ms: duration,
      count,
      source_artifact: "zotero_writeback_summary.json",
      details: {
        created: counters.created ?? null,
        failed: counters.failed ?? null,
        added_to_pool: counters.added_to_pool ?? null,
        added_to_daily_collection: counters.added_to_daily_collection ?? null,
        collection_attach_calls: runStats.collection_attach_calls ?? null,
        collection_attach_batch_size: runStats.collection_attach_batch_size ?? null,
        fallback_to_per_item_count: runStats.fallback_to_per_item_count ?? null,
        local_zotero_index_used: Boolean(runStats.local_zotero_index?.local_zotero_index_used),
        mcp_calls_by_tool: mcpCalls,
      },
    });
  }
}

function addStage3Spans(spans, translationBackfill = null) {
  const timings = translationBackfill?.timings || {};
  const summary = translationBackfill?.translation_summary || {};
  const wallTotalMs = asNumber(timings.total_ms, 0);
  const wallDuration = (value) => {
    const duration = asNumber(value, 0);
    return wallTotalMs > 0 && duration > wallTotalMs ? wallTotalMs : duration;
  };
  const specs = [
    ["stage3.total", timings.total_ms, translationBackfill?.total || null, null],
    ["stage3.translation_request", wallDuration(timings.translation_request_ms), summary.api_translation_attempted_count ?? null, timings.translation_request_ms],
    ["stage3.metadata_write", wallDuration(timings.metadata_write_ms), summary.zotero_updates_attempted_count ?? null, timings.metadata_write_ms],
    ["stage3.local_index_update", wallDuration(timings.local_index_update_ms), translationBackfill?.local_zotero_index_update?.updated_count ?? null, timings.local_index_update_ms],
  ];
  for (const [name, duration, count, cumulativeDurationMs] of specs) {
    addSpan(spans, {
      name,
      category: "stage3",
      duration_ms: duration,
      count,
      source_artifact: "abc_translation_backfill.json",
      details: {
        ...pickCounts(summary, [
          "cache_hits_count",
          "cache_misses_count",
          "api_translation_attempted_count",
          "api_translation_succeeded_count",
          "zotero_updates_attempted_count",
          "zotero_updates_succeeded_count",
          "pool_scan_items_count",
          "pool_scan_candidates_count",
        ]),
        cumulative_duration_ms: cumulativeDurationMs ?? null,
        duration_capped_to_stage_wall_time: Boolean(
          wallTotalMs > 0
          && Number.isFinite(Number(cumulativeDurationMs))
          && Number(cumulativeDurationMs) > wallTotalMs
        ),
      },
    });
  }
}

function addStage4Spans(spans, stage4RunReport = null) {
  const exportTiming = stage4RunReport?.stage_timings?.excel_export;
  if (!exportTiming) return;
  addSpan(spans, {
    name: "stage4.excel_export",
    category: "stage4",
    duration_ms: exportTiming.ms,
    source_artifact: "run_report.json",
    details: {
      status: exportTiming.status,
      export_method: stage4RunReport?.export_method || stage4RunReport?.steps?.stage4_export_audit?.export_method || null,
      output_path: stage4RunReport?.steps?.stage4_export_audit?.actual_output_path || null,
    },
  });
}

function topSummaryRows(spans, totalDurationMs) {
  return spans
    .filter((span) => asNumber(span.duration_ms, 0) > 0)
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, 10)
    .map((span) => ({
      name: span.name,
      duration_ms: Math.round(span.duration_ms),
      percent_of_total: totalDurationMs ? Number(((span.duration_ms / totalDurationMs) * 100).toFixed(1)) : null,
      count: span.count,
      avg_ms: span.avg_ms === null || span.avg_ms === undefined ? null : Math.round(span.avg_ms),
      max_ms: span.max_ms === null || span.max_ms === undefined ? null : Math.round(span.max_ms),
      source_artifact: span.source_artifact,
    }));
}

function diagnoseSpan(span, totalDurationMs) {
  const name = span.name || "";
  const details = span.details || {};
  let primaryCostSource = "measured_stage_or_module_wall_time";
  let suspectedCause = "needs_follow_up_trace";
  let proposedOptimization = "keep_observing_before_changing_behavior";
  let riskLevel = "medium";
  let implementedThisRound = false;

  if (name === "stage2.collection_setup") {
    primaryCostSource = "Zotero collection tree and managed collection preparation";
    suspectedCause = "collection tree read/guard preparation/create-or-find operations remain serial and backend-bound";
    proposedOptimization = "cache/reuse collection tree and guard state within the run; avoid repeated create/find reads";
    riskLevel = "medium";
  } else if (name === "stage2.item_writeback") {
    primaryCostSource = "Zotero item import/write_item calls";
    suspectedCause = "one Zotero import/write operation per admitted item";
    proposedOptimization = "investigate safe bulk import/key resolution while preserving run markers and rollback cleanup";
    riskLevel = "high";
  } else if (name === "stage2.collection_attach") {
    primaryCostSource = "Zotero collection attach calls";
    suspectedCause = `batched attach calls=${details.collection_attach_calls ?? "unknown"}, fallback_to_per_item=${details.fallback_to_per_item_count ?? "unknown"}`;
    proposedOptimization = "root pool attach removed; keep JS bridge batch attach and avoid per-item fallback";
    riskLevel = "low";
    implementedThisRound = true;
  } else if (name === "stage2.star_migration") {
    primaryCostSource = "rated-item migration scan and collection moves";
    suspectedCause = details.local_zotero_index_used ? "local index path available; current run had limited eligible migration work" : "would require collection scan when local index is unavailable";
    proposedOptimization = "continue using local index for candidate discovery; only optimize further if eligible_items grows";
    riskLevel = "low";
  } else if (name === "stage1.llm_grade_review" || name === "stage1.semantic_grading") {
    primaryCostSource = "LLM request wall time";
    suspectedCause = `request_attempts=${details.total_request_attempts ?? "unknown"}, batch_size=${details.batch_size ?? "unknown"}`;
    proposedOptimization = "tune batch/concurrency only with provider limits and parse-failure safeguards";
    riskLevel = "medium";
  } else if (name === "stage1.pre_llm_zotero_existing_dedupe") {
    primaryCostSource = "local/live Zotero duplicate verification";
    suspectedCause = `checked=${details.pre_llm_zotero_duplicate_checked_count ?? "unknown"}, existing=${details.pre_llm_existing_duplicate_count ?? "unknown"}`;
    proposedOptimization = "prefer trusted local index and verify only stale/uncertain matches";
    riskLevel = "medium";
    implementedThisRound = true;
  } else if (name.startsWith("stage3.")) {
    primaryCostSource = "shortTitle metadata writeback and cache handling";
    suspectedCause = details.duration_capped_to_stage_wall_time
      ? "parallel cumulative operation time was capped to stage wall time for ranking"
      : "stage3 wall time from translation/cache/metadata write path";
    proposedOptimization = "keep metadata writes batched/concurrent; avoid API calls when cache hit";
    riskLevel = "low";
  } else if (name.startsWith("stage4.")) {
    primaryCostSource = "final workbook export";
    suspectedCause = "node fallback workbook generation";
    proposedOptimization = "no optimization needed unless export becomes a top cost";
    riskLevel = "low";
  } else if (name.startsWith("stage.stage")) {
    primaryCostSource = "orchestrator stage wall time";
    suspectedCause = "aggregate stage timing; inspect child spans for root cause";
    proposedOptimization = "optimize the largest child spans rather than the aggregate stage wrapper";
    riskLevel = "low";
  }

  return {
    module_substep_function: name,
    duration_ms: Math.round(asNumber(span.duration_ms, 0)),
    percent_of_total: totalDurationMs ? Number(((asNumber(span.duration_ms, 0) / totalDurationMs) * 100).toFixed(1)) : null,
    count: span.count,
    average_duration_ms: span.avg_ms === null || span.avg_ms === undefined ? null : Math.round(span.avg_ms),
    p95_or_max_ms: span.max_ms === null || span.max_ms === undefined ? null : Math.round(span.max_ms),
    primary_cost_source: primaryCostSource,
    suspected_cause: suspectedCause,
    proposed_optimization: proposedOptimization,
    risk_level: riskLevel,
    implemented_this_round: implementedThisRound,
    source_artifact: span.source_artifact,
  };
}

function diagnosisRows(spans, totalDurationMs) {
  return spans
    .filter((span) => asNumber(span.duration_ms, 0) > 0)
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, 15)
    .map((span) => diagnoseSpan(span, totalDurationMs));
}

export function buildWorkflowPerformanceSummary({
  runContext = {},
  stages = [],
  timingDiagnostics = null,
  writebackSummary = null,
  translationBackfill = null,
  stage4RunReport = null,
} = {}) {
  const spans = [];
  addStageSpans(spans, stages);
  addStage1TimingSpans(spans, timingDiagnostics);
  addStage2Spans(spans, writebackSummary);
  addStage3Spans(spans, translationBackfill);
  addStage4Spans(spans, stage4RunReport);
  const totalDurationMs = sum((stages || []).map((stage) => stage.durationMs));
  const mcpCalls = writebackSummary?.run_stats?.mcp_calls_by_tool || {};
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    run_id: runContext.runId || "",
    pipeline_dir: runContext.pipelineDir || "",
    total_duration_ms: totalDurationMs,
    totals: {
      stage_count: stages.length,
      span_count: spans.length,
      zotero_backend_call_count: sum(Object.values(mcpCalls)),
      collection_attach_calls: asNumber(writebackSummary?.run_stats?.collection_attach_calls, 0),
      collection_attach_batch_size: writebackSummary?.run_stats?.collection_attach_batch_size ?? null,
      fallback_to_per_item_count: asNumber(writebackSummary?.run_stats?.fallback_to_per_item_count, 0),
      llm_request_attempts: asNumber(timingDiagnostics?.stage_timings?.llm_grade_review?.total_request_attempts, 0),
      translation_api_attempts: asNumber(translationBackfill?.translation_summary?.api_translation_attempted_count, 0),
      writeback_created_items: asNumber(writebackSummary?.counters?.created, 0),
      writeback_failed_items: asNumber(writebackSummary?.counters?.failed, 0),
      added_to_root_pool: asNumber(writebackSummary?.counters?.added_to_pool, 0),
      added_to_daily_collections: asNumber(writebackSummary?.counters?.added_to_daily_collection, 0),
    },
    assertions: {
      root_pool_attach_disabled: writebackSummary?.root_pool_attach_disabled === true,
      new_items_added_to_root_pool: writebackSummary?.new_items_added_to_root_pool === true,
      dedupe_depends_on_root_pool_membership: writebackSummary?.dedupe_depends_on_root_pool_membership === true,
      local_zotero_index_used: Boolean(writebackSummary?.local_zotero_index?.local_zotero_index_used),
    },
    top_summary: topSummaryRows(spans, totalDurationMs),
    performance_diagnosis: diagnosisRows(spans, totalDurationMs),
    spans,
  };
}

export function formatWorkflowPerformanceTopSummary(summary = {}) {
  const lines = [
    `run_id: ${summary.run_id || ""}`,
    `total_duration_ms: ${Math.round(asNumber(summary.total_duration_ms, 0))}`,
    `zotero_backend_call_count: ${summary.totals?.zotero_backend_call_count ?? 0}`,
    `collection_attach_calls: ${summary.totals?.collection_attach_calls ?? 0}`,
    `fallback_to_per_item_count: ${summary.totals?.fallback_to_per_item_count ?? 0}`,
    "top_10:",
  ];
  for (const row of summary.top_summary || []) {
    lines.push(`- ${row.name}: ${row.duration_ms}ms (${row.percent_of_total ?? "n/a"}%, count=${row.count ?? "n/a"}, avg=${row.avg_ms ?? "n/a"}ms)`);
  }
  lines.push("diagnosis_top:");
  for (const row of (summary.performance_diagnosis || []).slice(0, 10)) {
    lines.push(`- ${row.module_substep_function}: cost=${row.primary_cost_source}; cause=${row.suspected_cause}; next=${row.proposed_optimization}; risk=${row.risk_level}; implemented=${row.implemented_this_round}`);
  }
  return `${lines.join("\n")}\n`;
}

async function readJsonIfExists(p, readJson) {
  try {
    return await readJson(p);
  } catch {
    return null;
  }
}

export async function writeWorkflowPerformanceSummary({
  pipelineDir,
  runContext = {},
  stages = [],
  artifacts = {},
  readJson,
} = {}) {
  const timingDiagnostics = await readJsonIfExists(path.join(pipelineDir, "timing_diagnostics.json"), readJson);
  const writebackSummary = artifacts.writeback_summary?.data
    || await readJsonIfExists(path.join(pipelineDir, "zotero_writeback_summary.json"), readJson);
  const translationBackfill = artifacts.translation_backfill?.data
    || await readJsonIfExists(path.join(pipelineDir, "abc_translation_backfill.json"), readJson);
  const stage4RunReport = artifacts.stage4_run_report?.data
    || await readJsonIfExists(path.join(pipelineDir, "run_report.json"), readJson);
  const summary = buildWorkflowPerformanceSummary({
    runContext,
    stages,
    timingDiagnostics,
    writebackSummary,
    translationBackfill,
    stage4RunReport,
  });
  const jsonPath = path.join(pipelineDir, "workflow_performance_summary.json");
  const textPath = path.join(pipelineDir, "workflow_performance_top_summary.txt");
  await fs.writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf8");
  await fs.writeFile(textPath, formatWorkflowPerformanceTopSummary(summary), "utf8");
  return { summary, jsonPath, textPath };
}
