import fs from "node:fs/promises";
import { summarizeCollectionScopeBlocks } from "../lib/zotero_collection_guard.mjs";
import { buildWritebackSideEffectSummary } from "./side_effect_summary.mjs";
import { buildWritebackCollectionKeys } from "./writeback_summary.mjs";

function duplicateIndexCounts(index) {
  return {
    doi: index.byDoi?.size || 0,
    pmid: index.byPmid?.size || 0,
    pmcid: index.byPmcid?.size || 0,
    arxiv: index.byArxiv?.size || 0,
    title: index.byTitle?.size || 0,
  };
}

export async function writeStage2WritebackReports({
  summaryPath,
  runReportPath,
  stageStarted,
  dateStr,
  root,
  trashKey,
  worthy,
  zoteroMonthName,
  zoteroDayName,
  monthKey,
  dateKey,
  sourceKeys,
  gradeKeys,
  collectionRecords = [],
  reusedCollectionKeys = [],
  counters,
  failures,
  collectionGuard,
  collectionScopeBlocks,
  poolIndex,
  worthyIndex,
  localIndexStats,
  skippedDuplicatesInPool,
  skippedDuplicatesInTrash,
  duplicateRecords,
  stage1RunReport,
  poolAddFailed,
  currentDateAddFailed,
  writebackItems,
  migrationStats,
  starMigrationConfig,
  tagCleanupStats,
  attachStats,
  collectionAttachMs,
  configuredConcurrency,
  writebackConcurrency,
  concurrencyWarning,
  concurrencyClamped,
  concurrencySource,
  autoDowngrade,
  stopForHighRisk,
  stopReason,
  retryCount,
  writebackRetryLimit,
  observationMode,
  duplicatePreventedCount,
  duplicateDetectedCount,
  wrongCollectionDetectedCount,
  uncertainCreateStateCount,
  inFlightDedupeWaitCount,
  batchObservations,
  itemWritebackMs,
  duplicateVerificationStats = {},
  batchCreateStats = {},
  collectionSetupMs,
  tagCleanupMs,
  migrationMs,
  mcpCallsByTool,
  trashItemCount,
  tombstoneIndexCount,
  worthyItemCount,
  historyCollectionModificationForbidden,
}) {
  const collectionScopeSummary = summarizeCollectionScopeBlocks(collectionScopeBlocks);
  const writebackSideEffectSummary = buildWritebackSideEffectSummary({
    itemsPlannedCount: counters.total,
    counters,
    failures,
    dryRun: false,
    mcpReady: true,
    collectionKeys: buildWritebackCollectionKeys({ root, trashKey, worthy, monthKey, dateKey, sourceKeys, gradeKeys }),
    attachStats,
    mcpCallsByTool,
    tagCleanupStats,
    poolAddFailed,
    currentDateAddFailed,
    stopForHighRisk,
    stopReason,
  });
  const summary = {
    date: dateStr,
    root_collection: root,
    month_collection_name: zoteroMonthName,
    month_collection_key: monthKey,
    date_collection_name: zoteroDayName,
    date_collection_key: dateKey,
    source_collections: sourceKeys,
    grade_collections: gradeKeys,
    smoke_cleanup_collection_records: collectionRecords,
    smoke_cleanup_reused_collection_keys: reusedCollectionKeys,
    counters,
    failures,
    pool_collection_name: "文献池",
    pool_collection_key: root.key,
    ...collectionGuard.audit,
    ...collectionScopeSummary,
    pool_items_scanned: Number(poolIndex.meta?.size || 0),
    local_zotero_index: localIndexStats,
    pool_duplicate_index_counts: duplicateIndexCounts(poolIndex),
    worthy_duplicate_index_counts: duplicateIndexCounts(worthyIndex),
    skipped_duplicate_in_pool: skippedDuplicatesInPool,
    skipped_duplicate_in_trash: skippedDuplicatesInTrash,
    skipped_duplicate_in_deleted_trash_index: counters.skipped_duplicate_in_deleted_trash_index,
    trash_index_item_count: trashItemCount,
    deleted_trash_tombstone_index_item_count: tombstoneIndexCount,
    skipped_duplicate_in_worthy: counters.skipped_duplicate_in_worthy,
    worthy_index_item_count: worthyItemCount,
    duplicate_records: duplicateRecords,
    pre_llm_skipped_existing: Number(stage1RunReport?.counts?.skipped_writeback_pre_llm_existing_count || 0),
    pre_llm_zotero_existing_dedupe: stage1RunReport?.steps?.pre_llm_zotero_existing_dedupe || null,
    reused_existing_added_to_pool_and_current_date: counters.reused_existing,
    new_items_added_to_root_pool: false,
    root_pool_attach_disabled: true,
    dedupe_depends_on_root_pool_membership: false,
    added_to_current_date_collection: counters.added_to_daily_collection,
    pool_add_failed: poolAddFailed,
    current_date_add_failed: currentDateAddFailed,
    writeback_side_effect_summary: writebackSideEffectSummary,
    writeback_items: writebackItems,
    med_zotero_bridge: {
      mcp_only: true,
      stage: "abc_writeback",
      tag_cleanup_interface: "write_tag:set",
      historical_dedup_enabled: true,
      star_migration_window_days: migrationStats.window_days || starMigrationConfig.windowDays || 10,
      calibration_isolated_mode: false,
      history_collection_modification_forbidden: historyCollectionModificationForbidden,
      ...collectionGuard.audit,
    },
    tag_cleanup_stats: tagCleanupStats,
    migration_stats: migrationStats,
    star_migration: {
      enabled: Boolean(migrationStats.enabled),
      mode: migrationStats.mode || starMigrationConfig.mode || "unknown",
      eligible_items: Number(migrationStats.eligible_items || 0),
      moved_to_worthy: Number(migrationStats.moved_to_worthy || 0),
      skipped_already_exists: Number(migrationStats.skipped_already_exists || migrationStats.already_in_worthy || 0),
      skipped_invalid: Number(migrationStats.skipped_invalid || 0),
      errors: Array.isArray(migrationStats.errors) ? migrationStats.errors.length : 0,
      error_samples: Array.isArray(migrationStats.errors) ? migrationStats.errors.slice(0, 5) : [],
      window_days: Number(migrationStats.window_days || starMigrationConfig.windowDays || 10),
      star_threshold: Number(migrationStats.star_threshold || starMigrationConfig.starThreshold || 4),
      expand_all_grades: Boolean(migrationStats.expand_all_grades ?? starMigrationConfig.expandAllGrades ?? true),
    },
    collection_attach_mode: attachStats.collection_attach_mode,
    collection_attach_batch_size: attachStats.collection_attach_batch_size,
    collection_attach_calls: attachStats.collection_attach_calls,
    collection_attach_duration: collectionAttachMs,
    collection_attach_failures: attachStats.collection_attach_failures,
    fallback_to_per_item_count: attachStats.fallback_to_per_item_count,
    configured_concurrency: configuredConcurrency,
    effective_concurrency: writebackConcurrency,
    concurrency_warning: concurrencyWarning,
    concurrency_clamped: concurrencyClamped,
    concurrency_default_used: concurrencySource === "default",
    concurrency_source: concurrencySource,
    ...autoDowngrade,
    stopped_for_high_risk: stopForHighRisk,
    stop_reason: stopReason || null,
    run_stats: {
      execution_mode: batchCreateStats.batch_create_used ? "batch_create_with_serial_fallback" : "serial",
      batch_write_supported: Boolean(batchCreateStats.batch_create_supported),
      batch_create_used: Boolean(batchCreateStats.batch_create_used),
      batch_create_request_count: Number(batchCreateStats.batch_create_request_count || 0),
      batch_create_item_count: Number(batchCreateStats.batch_create_item_count || 0),
      batch_create_success_count: Number(batchCreateStats.batch_create_success_count || 0),
      batch_create_failed_count: Number(batchCreateStats.batch_create_failed_count || 0),
      batch_create_fallback_count: Number(batchCreateStats.batch_create_fallback_count || 0),
      batch_create_fallback_errors: Array.isArray(batchCreateStats.batch_create_fallback_errors)
        ? batchCreateStats.batch_create_fallback_errors.slice(0, 5)
        : [],
      writeback_concurrency: writebackConcurrency,
      writeback_concurrency_recommended_max: 10,
      writeback_retry_limit: writebackRetryLimit,
      writeback_retry_count: retryCount,
      duplicate_prevented_count: duplicatePreventedCount,
      duplicate_detected_count: duplicateDetectedCount,
      wrong_collection_detected_count: wrongCollectionDetectedCount,
      collection_scope_blocked_count: collectionScopeSummary.collection_scope_blocked_count,
      collection_scope_blocked_samples: collectionScopeSummary.collection_scope_blocked_samples,
      uncertain_create_state_count: uncertainCreateStateCount,
      in_flight_dedupe_wait_count: inFlightDedupeWaitCount,
      duplicate_verification_batch_enabled: Boolean(duplicateVerificationStats.duplicate_verification_batch_enabled),
      duplicate_verification_batch_request_count: Number(duplicateVerificationStats.duplicate_verification_batch_request_count || 0),
      duplicate_verification_batch_item_count: Number(duplicateVerificationStats.duplicate_verification_batch_item_count || 0),
      duplicate_verification_batch_fallback_count: Number(duplicateVerificationStats.duplicate_verification_batch_fallback_count || 0),
      collection_key_cache_enabled: true,
      collection_setup_ms: collectionSetupMs,
      local_zotero_index: localIndexStats,
      item_writeback_ms: itemWritebackMs,
      collection_attach_mode: attachStats.collection_attach_mode,
      collection_attach_batch_size: attachStats.collection_attach_batch_size,
      collection_attach_calls: attachStats.collection_attach_calls,
      collection_attach_duration: collectionAttachMs,
      collection_attach_failures: attachStats.collection_attach_failures,
      fallback_to_per_item_count: attachStats.fallback_to_per_item_count,
      observation_mode: observationMode,
      per_batch_observation: observationMode ? batchObservations : [],
      tag_cleanup_ms: tagCleanupMs,
      star_migration_ms: migrationMs,
      mcp_calls_by_tool: mcpCallsByTool,
    },
  };

  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  try {
    const runReport = JSON.parse(await fs.readFile(runReportPath, "utf8"));
    runReport.stage_timings = runReport.stage_timings || {};
    runReport.stage_timings.zotero_writeback = {
      status: "completed",
      ms: Date.now() - stageStarted,
      substeps: {
        collection_setup: collectionSetupMs,
        item_writeback: itemWritebackMs,
        collection_attach: collectionAttachMs,
        tag_cleanup: tagCleanupMs,
        star_migration: migrationMs,
      },
    };
    runReport.writeback_pool_dedupe_enabled = true;
    runReport.writeback_pool_collection_name = "文献池";
    runReport.writeback_pool_collection_key = root.key;
    runReport.writeback_pool_items_scanned = Number(poolIndex.meta?.size || 0);
    runReport.writeback_new_items_added_to_root_pool = false;
    runReport.writeback_root_pool_attach_disabled = true;
    runReport.writeback_dedupe_depends_on_root_pool_membership = false;
    runReport.writeback_pool_duplicates_skipped = counters.skipped_duplicate_in_pool;
    runReport.writeback_trash_duplicates_skipped = counters.skipped_duplicate_in_trash;
    runReport.writeback_deleted_trash_index_duplicates_skipped = counters.skipped_duplicate_in_deleted_trash_index;
    runReport.writeback_trash_index_items = trashItemCount;
    runReport.writeback_deleted_trash_tombstone_index_items = tombstoneIndexCount;
    runReport.writeback_local_zotero_index = localIndexStats;
    runReport.writeback_worthy_duplicates_skipped = counters.skipped_duplicate_in_worthy;
    runReport.writeback_worthy_index_items = worthyItemCount;
    runReport.writeback_added_to_pool = counters.added_to_pool;
    runReport.writeback_added_to_current_date_collection = counters.added_to_daily_collection;
    runReport.writeback_pool_add_failed = poolAddFailed;
    runReport.writeback_current_date_add_failed = currentDateAddFailed;
    runReport.writeback_side_effect_summary = writebackSideEffectSummary;
    runReport.collection_scope_guard_enabled = true;
    runReport.collection_scope_guard_ready = collectionGuard.ready;
    runReport.collection_scope_blocked_count = collectionScopeSummary.collection_scope_blocked_count;
    runReport.collection_scope_blocked_samples = collectionScopeSummary.collection_scope_blocked_samples;
    runReport.signals = runReport.signals || {};
    runReport.signals.pool_collection_missing = false;
    runReport.signals.pool_collection_ambiguous = false;
    runReport.signals.duplicate_in_pool = counters.skipped_duplicate_in_pool > 0;
    runReport.signals.duplicate_in_trash = counters.skipped_duplicate_in_trash > 0;
    runReport.signals.trash_index_loaded = trashItemCount > 0;
    runReport.signals.duplicate_in_worthy = counters.skipped_duplicate_in_worthy > 0;
    runReport.signals.worthy_index_loaded = worthyItemCount > 0;
    runReport.signals.pool_add_failed = poolAddFailed > 0;
    runReport.signals.current_date_add_failed = currentDateAddFailed > 0;
    runReport.signals.history_collection_modification_forbidden = historyCollectionModificationForbidden;
    runReport.signals.collection_scope_blocked = collectionScopeSummary.collection_scope_blocked_count > 0;
    await fs.writeFile(runReportPath, JSON.stringify(runReport, null, 2), "utf8");
  } catch {}

  return summary;
}
