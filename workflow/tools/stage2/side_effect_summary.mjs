import { buildWritebackValidationSummary } from "../validation/writeback_validation.mjs";

function toCount(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function toCountOrUnknown(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : "unknown";
}

function classifyWritebackFailure(error) {
  const message = String(error?.error || error?.message || error || "").toLowerCase();
  if (/mcp_not_ready|zotero_backend_not_ready|not ready|econnrefused|fetch failed|connection refused/.test(message)) return "zotero_backend_unavailable";
  if (/collection_scope_blocked|validation|invalid|no_key/.test(message)) return "validation_error";
  if (/mcp|zotero_backend|json-rpc|-32700|parse error|timeout|database busy|transaction failed|lock conflict|writeback_failed|rate limit|429/.test(message)) return "zotero_backend_error";
  if (/collection|add_items_to_collection|create_collection/.test(message)) return "collection_error";
  return "unknown";
}

function addFailureReason(counts, reason, amount = 1) {
  const key = String(reason || "unknown").trim() || "unknown";
  counts[key] = toCount(counts[key]) + toCount(amount, 1);
}

function buildFailureReasonCounts({ failures = [], attachStats = {}, failureReason = "" } = {}) {
  const counts = {};
  for (const failure of failures || []) addFailureReason(counts, classifyWritebackFailure(failure));
  for (const failure of attachStats?.collection_attach_failures || []) {
    addFailureReason(counts, classifyWritebackFailure(failure));
  }
  if (failureReason) addFailureReason(counts, classifyWritebackFailure(failureReason));
  return counts;
}

function countUniqueKeys(values = []) {
  return new Set((values || []).filter((x) => x !== undefined && x !== null && String(x).trim())).size;
}

export function buildWritebackSideEffectSummary({
  itemsPlannedCount = 0,
  counters = {},
  failures = [],
  dryRun = false,
  zoteroBackendReady = "unknown",
  mcpReady = zoteroBackendReady,
  collectionKeys = [],
  attachStats = {},
  mcpCallsByTool = {},
  tagCleanupStats = {},
  poolAddFailed = 0,
  currentDateAddFailed = 0,
  stopForHighRisk = false,
  stopReason = null,
  failureReason = "",
  executionStatus = "",
  backendSelected = "unknown",
  desktopLaunched = "unknown",
  rootPoolNewItemCount = 0,
  shortTitle = {},
  runMarker = {},
  localIndexResidual = 0,
  backendResidual = 0,
  cleanupResidual = 0,
  requestStats = {},
  backendDetails = {},
} = {}) {
  const planned = toCountOrUnknown(itemsPlannedCount);
  const created = dryRun ? 0 : toCount(counters.created, 0);
  const failed = dryRun ? 0 : toCount(counters.failed, 0);
  const attempted = dryRun ? 0 : created + failed;
  const collectionFailureCount = toCount(poolAddFailed, 0) + toCount(currentDateAddFailed, 0)
    + toCount(attachStats?.collection_attach_failures?.length, 0);
  const partialSuccess = created > 0 && (failed > 0 || collectionFailureCount > 0 || Boolean(stopForHighRisk));
  let status = executionStatus;
  if (!status) {
    if (dryRun) status = "dry_run";
    else if (planned === 0) status = "no_items";
    else if (attempted === 0) status = mcpReady === false ? "not_executed_zotero_backend_unavailable" : "not_executed";
    else if (partialSuccess) status = "partial_success";
    else if (created > 0 && failed === 0 && collectionFailureCount === 0) status = "complete_success";
    else if (created === 0 && failed > 0) status = "complete_failure";
    else status = "completed_with_warnings";
  }

  const collectionsCreated = Object.prototype.hasOwnProperty.call(mcpCallsByTool || {}, "create_collection")
    ? toCount(mcpCallsByTool.create_collection, 0)
    : "unknown";
  const wouldCreateCollections = typeof collectionsCreated === "number" ? collectionsCreated : "unknown";
  const actualCreatedCollections = dryRun ? 0 : collectionsCreated;
  const collectionsUsed = collectionKeys?.length ? countUniqueKeys(collectionKeys) : (mcpReady === false ? 0 : "unknown");
  const itemsAddedToCollections = dryRun
    ? 0
    : Math.max(toCount(counters.added_to_pool, 0), toCount(counters.added_to_daily_collection, 0));
  const tagCleanupUpdates = toCount(tagCleanupStats?.cleaned_items, 0);
  const tagUpdates = dryRun ? 0 : created + tagCleanupUpdates;
  const fieldUpdates = dryRun ? 0 : created;
  const wouldWriteItemsCount = typeof planned === "number" ? planned : "unknown";
  const actualWriteItemsCount = created;
  const wouldItemFieldUpdates = typeof planned === "number" ? planned : "unknown";
  const wouldTagUpdates = typeof planned === "number" ? planned : "unknown";
  const externalWritePerformed = !dryRun && mcpReady === true && (
    created > 0
    || itemsAddedToCollections > 0
    || tagUpdates > 0
    || (typeof collectionsCreated === "number" && collectionsCreated > 0)
  );

  const correctness = buildWritebackValidationSummary({
    backendSelected,
    desktopLaunched,
    counters,
    attachStats,
    rootPoolNewItemCount,
    shortTitle,
    runMarker,
    localIndexResidual,
    backendResidual,
    cleanupResidual,
    requestStats,
    backendDetails,
  });

  return {
    execution_status: status,
    items_planned_count: planned,
    items_attempted_count: attempted,
    items_succeeded_count: created,
    items_failed_count: failed,
    partial_success: partialSuccess,
    dry_run: Boolean(dryRun),
    zotero_backend_ready: mcpReady,
    mcp_ready: mcpReady,
    external_write_performed: externalWritePerformed,
    would_write_items_count: wouldWriteItemsCount,
    actual_write_items_count: actualWriteItemsCount,
    would_create_collections_count: wouldCreateCollections,
    actual_created_collections_count: actualCreatedCollections,
    would_update_fields: {
      item_fields: wouldItemFieldUpdates,
      short_title: 0,
      tags: wouldTagUpdates,
      notes: 0,
    },
    actual_updated_fields: {
      item_fields: fieldUpdates,
      short_title: 0,
      tags: tagUpdates,
      notes: 0,
    },
    collections_created_count: collectionsCreated,
    collections_used_count: collectionsUsed,
    items_added_to_collections_count: itemsAddedToCollections,
    short_title_updates_count: 0,
    tag_updates_count: tagUpdates,
    note_updates_count: 0,
    field_updates_count: fieldUpdates,
    collection_add_failures_count: collectionFailureCount,
    failure_reasons: buildFailureReasonCounts({ failures, attachStats, failureReason }),
    correctness,
    stopped_for_high_risk: Boolean(stopForHighRisk),
    stop_reason: stopReason || null,
  };
}
