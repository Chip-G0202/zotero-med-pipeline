import fs from "node:fs/promises";

import { summarizeCollectionScopeBlocks } from "../lib/zotero_collection_guard.mjs";
import { mergeRuntimeState } from "./runtime_state.mjs";

export async function writeStage3TranslationReports({
  dateStr,
  stageStarted,
  paths,
  runtime,
  summary,
  poolScan,
  poolScanEnabled,
  poolScanIntervalDays,
  poolScanWindowDays,
  lastPoolScanAt,
  daysSincePoolScan,
  poolScanSkipReason,
  metadataScopeBlocks,
  report,
  translationConfig,
  translationSummary,
  concurrency,
  downgradeAudit,
  localIndexUpdate = null,
} = {}) {
  const output = {
    date: dateStr,
    stage: "abc_shorttitle_backfill",
    provider: translationConfig.model,
    api_key_configured: translationConfig.apiKeyConfigured,
    cache_path: runtime.translationCachePath,
    translation_summary: translationSummary,
    configured_concurrency: concurrency.configuredConcurrency,
    effective_concurrency: concurrency.currentConcurrency,
    concurrency_warning: concurrency.concurrencyWarning,
    concurrency_clamped: concurrency.concurrencyClamped,
    concurrency_default_used: concurrency.source === "default",
    concurrency_source: concurrency.source,
    collection_scope_guard_enabled: true,
    local_zotero_index_update: localIndexUpdate,
    ...summarizeCollectionScopeBlocks(metadataScopeBlocks),
    ...(downgradeAudit || { backfill_auto_downgrade_triggered: false, backfill_downgrade_recommended: false }),
    ...report,
  };
  Object.assign(output, summarizeCollectionScopeBlocks(metadataScopeBlocks));

  const writebackItemCount = (summary?.writeback_items || []).length;
  const poolDuplicates = Number(summary?.counters?.skipped_duplicate_in_pool || 0);
  const writebackFailures = Array.isArray(summary?.failures) ? summary.failures.length : 0;
  output.diagnostic_signals = {
    translation_skipped_no_candidates: report.total === 0,
    translation_disabled_missing_api_key: !translationConfig.apiKeyConfigured,
    writeback_items_in: writebackItemCount,
    writeback_pool_duplicates: poolDuplicates,
    writeback_failures: writebackFailures,
    pool_scan_date_collections: poolScan.scanStats.date_collections_scanned,
    pool_scan_items_scanned: poolScan.scanStats.items_scanned,
    pool_scan_items_missing_shorttitle: poolScan.scanStats.items_missing_shorttitle,
    pool_scan_errors: poolScan.scanStats.errors,
    pool_scan_limited: poolScan.scanStats.scan_limited,
    pool_scan_enabled: poolScanEnabled,
    pool_scan_interval_days: poolScanIntervalDays,
    pool_scan_window_days: poolScanWindowDays,
    pool_scan_last_run_at: lastPoolScanAt,
    pool_scan_days_since_last_run: Number.isFinite(daysSincePoolScan) ? daysSincePoolScan : null,
    pool_scan_skip_reason: poolScanSkipReason,
    pool_scan_max_items: Math.max(10, Number(process.env.ZOTERO_TRANSLATION_POOL_SCAN_MAX_ITEMS || 100)),
    candidates_from_writeback: writebackItemCount,
    candidates_from_pool_scan: poolScan.candidates.length,
    pool_scan_limit: Math.max(1, Number(process.env.ZOTERO_TRANSLATION_POOL_SCAN_LIMIT || 50)),
  };
  if (report.total === 0 && !translationConfig.apiKeyConfigured) {
    console.error("[translation_backfill] skipped: no candidate items AND missing TITLE_TRANSLATION_API_KEY");
  } else if (report.total === 0) {
    console.error(`[translation_backfill] skipped: no candidate items (writeback=${writebackItemCount}, pool_scan_missing=${poolScan.scanStats.items_missing_shorttitle}, duplicates=${poolDuplicates}, failures=${writebackFailures})`);
  } else if (!translationConfig.apiKeyConfigured) {
    console.error("[translation_backfill] disabled: missing TITLE_TRANSLATION_API_KEY (items available but API key not set)");
  } else {
    console.error(`[translation_backfill] processing ${report.total} items (writeback=${writebackItemCount}, pool_scan=${poolScan.candidates.length})`);
  }

  const usage = report.usage || {};
  const usageReport = {
    date: dateStr,
    stage: "abc_shorttitle_backfill",
    total_items: report.total,
    cache_hits: usage.cache_hits ?? null,
    cache_misses: usage.cache_misses ?? null,
    cache_hit_rate: usage.cache_hit_rate ?? null,
    api_items: usage.api_items ?? null,
    api_calls: usage.api_calls ?? null,
    api_rpm_limit: usage.api_rpm_limit ?? null,
    api_tpm_limit: usage.api_tpm_limit ?? null,
    rpm_window_seconds: usage.rpm_window_seconds ?? 60,
    tpm_window_seconds: usage.tpm_window_seconds ?? 60,
    batch_size: usage.batch_size ?? null,
    retries: usage.retries ?? null,
    rate_limit_wait_count: usage.rate_limit_wait_count ?? 0,
    rate_limit_wait_ms: usage.rate_limit_wait_ms ?? 0,
    rate_limit_error_count: usage.rate_limit_error_count ?? 0,
    requested_concurrency_limit: usage.requested_concurrency_limit ?? null,
    provider_concurrency_limit: usage.provider_concurrency_limit ?? null,
    effective_concurrency_limit: usage.effective_concurrency_limit ?? usage.concurrency_limit ?? null,
    request_timing: usage.request_timing || null,
    timing_breakdown: report.timings || null,
    estimated_tokens: usage.estimated_tokens ?? null,
    token_estimation_method: usage.token_estimation_method ?? null,
    input_tokens: usage.usage_available === false ? "unavailable" : (usage.input_tokens ?? null),
    output_tokens: usage.usage_available === false ? "unavailable" : (usage.output_tokens ?? null),
    total_tokens: usage.usage_available === false ? "unavailable" : (usage.total_tokens ?? null),
    avg_input_tokens_per_item: usage.usage_available === false ? "unavailable" : (usage.avg_input_tokens_per_item ?? null),
    avg_output_tokens_per_item: usage.usage_available === false ? "unavailable" : (usage.avg_output_tokens_per_item ?? null),
    avg_total_tokens_per_item: usage.usage_available === false ? "unavailable" : (usage.avg_total_tokens_per_item ?? null),
    max_output_tokens_per_call: usage.max_output_tokens_per_call ?? null,
    model: translationConfig.model,
    temperature: usage.temperature ?? 0,
    max_output_tokens: usage.max_output_tokens ?? null,
    warnings: usage.warnings || [],
    abnormal_batches: usage.abnormal_batches || [],
  };

  await fs.writeFile(paths.backfillPath, JSON.stringify(output, null, 2), "utf8");
  await fs.writeFile(paths.failuresPath, JSON.stringify({
    date: dateStr,
    failure_count: report.failure_count,
    failures: report.failures,
  }, null, 2), "utf8");
  await fs.writeFile(paths.usagePath, JSON.stringify(usageReport, null, 2), "utf8");
  if (poolScanEnabled) {
    await mergeRuntimeState(paths.runtimeStatePath, {
      last_translation_pool_scan_at: new Date().toISOString(),
    });
  }

  try {
    const runReport = JSON.parse(await fs.readFile(paths.runReportPath, "utf8"));
    runReport.stage_timings = runReport.stage_timings || {};
    runReport.stage_timings.translation = {
      status: "completed",
      ms: Date.now() - stageStarted,
      usage_report: paths.usagePath,
      timing_breakdown: report.timings || null,
    };
    runReport.steps = runReport.steps || {};
    runReport.steps.translation = {
      ...(runReport.steps.translation || {}),
      stage: "completed",
      provider: translationConfig.model,
      failed_count: report.failure_count,
      failed_samples: report.failures.slice(0, 5),
      api_key_configured: translationConfig.apiKeyConfigured,
      usage_report_path: paths.usagePath,
      usage_diagnostics: {
        requested_concurrency_limit: usage.requested_concurrency_limit ?? null,
        provider_concurrency_limit: usage.provider_concurrency_limit ?? null,
        effective_concurrency_limit: usage.effective_concurrency_limit ?? usage.concurrency_limit ?? null,
        request_timing: usage.request_timing || null,
        timing_breakdown: report.timings || null,
      },
      translation_summary: translationSummary,
      diagnostic_signals: output.diagnostic_signals,
      local_zotero_index_update: localIndexUpdate,
      collection_scope_guard_enabled: true,
      collection_scope_blocked_count: output.collection_scope_blocked_count,
      collection_scope_blocked_samples: output.collection_scope_blocked_samples,
    };
    await fs.writeFile(paths.runReportPath, JSON.stringify(runReport, null, 2), "utf8");
  } catch {}

  return output;
}
