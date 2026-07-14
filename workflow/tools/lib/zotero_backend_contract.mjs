export const ZOTERO_BACKEND_CONTRACT_METHODS = [
  "ready",
  "getCollections",
  "getCollectionItems",
  "ensureWritebackCollections",
  "createItems",
  "addItemsToCollections",
  "writeMetadataBatch",
  "getItems",
  "deleteItems",
  "deleteCollections",
  "cleanupRun",
  "getStats",
];

export const STAGE2_MEMBERSHIP_MUTATION_CONTRACT_METHODS = [
  "writeTagsBatch",
  "removeItemsFromCollections",
];

export const STAGE2_MEMBERSHIP_MUTATION_COMPAT_FALLBACKS = {
  writeTagsBatch: "write_tag",
  removeItemsFromCollections: "remove_items_from_collection",
};

export const STAGE2_TREE_LISTING_CONTRACT_METHODS = [
  "getSubcollections",
];

export const STAGE2_TREE_LISTING_COMPAT_FALLBACKS = {
  getSubcollections: "get_subcollections",
};

/**
 * Shared Zotero backend contract for Stage2/Stage3 orchestration.
 *
 * This is intentionally a lightweight runtime helper, not a forced base class.
 * Existing Desktop and Web implementations may keep their transport-specific
 * classes as long as any strategy handed to shared stages exposes these methods:
 *
 * - ready(options) -> { ok, backend, diagnostics }
 * - getCollections(options) -> collection[]
 * - getCollectionItems(collectionKey, options) -> item[]
 * - getSubcollections(collectionKey, recursive, options) -> collection tree/list
 *   (Stage2 tree-scan boundary; legacy fallback is get_subcollections)
 * - ensureWritebackCollections(plan) -> { root, date, sources, grades, created, existing }
 * - createItems(items, options) -> { created, failed } or created[]
 * - addItemsToCollections(assignments, options) -> { added, already, failed }
 * - writeMetadataBatch(updates, options) -> { updated, failed }
 * - getItems(keys, options) -> item[]
 * - deleteItems(keys, options) -> { deleted, failed }
 * - deleteCollections(keys, options) -> { deleted, failed }
 * - cleanupRun(runId, manifest) -> cleanup counts and residuals
 * - getStats() -> transport stats
 *
 * Partial failure is explicit via failed/write_failures arrays and must not be
 * swallowed. Logical counts describe workflow items; request counts describe
 * HTTP calls, CLI invocations, or JS bridge calls. Shared stages may record
 * backendDetails for audit, but must not branch on backend-private fields.
 *
 * Collection semantics are shared: newly admitted items attach to exactly one
 * source collection and one grade collection, and are not auto-attached to root
 * "文献池". Stage3 shortTitle verification remains shared-stage responsibility.
 *
 * Stage2 mutation-guard membership writes use these contract-facing methods
 * before falling back to legacy compat tool names:
 *
 * - writeTagsBatch(operations, options) -> { applied, missing, guarded, failed }
 * - removeItemsFromCollections(operations, options) -> { applied, missing, guarded, failed }
 *
 * Input operations must carry itemKey/itemKeys plus tags or collectionKey. The
 * shared caller owns dry-run and mutation-guard decisions; backend methods only
 * execute allowed mutations and report per-item outcomes. Existing compat tool
 * fallbacks remain write_tag and remove_items_from_collection for older backend
 * adapters and tests.
 */

function countList(value) {
  return Array.isArray(value) ? value.length : 0;
}

function asCount(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function validateZoteroBackendContract(backend) {
  const missing = ZOTERO_BACKEND_CONTRACT_METHODS.filter((method) => typeof backend?.[method] !== "function");
  return {
    ok: missing.length === 0,
    missing,
  };
}

export function normalizeBackendContractResult({
  backend = "unknown",
  method = "unknown",
  inputCount = null,
  created = [],
  updated = [],
  added = [],
  deleted = [],
  failed = [],
  writeFailures = null,
  fallback = null,
  cleanup = null,
  stats = null,
} = {}) {
  const failureList = Array.isArray(writeFailures) ? writeFailures : failed;
  const successCount = countList(created) + countList(updated) + countList(added) + countList(deleted);
  const failureCount = countList(failureList);
  const cleanupResidual = asCount(cleanup?.residualItems, 0) + asCount(cleanup?.residualCollections, 0);
  const normalizedStats = {
    logical_item_count: asCount(stats?.logicalItemCount, inputCount === null ? successCount + failureCount : inputCount),
    request_count: asCount(stats?.requestCount, 0),
  };
  if (stats?.backendDetails !== undefined) normalizedStats.backendDetails = stats.backendDetails;

  return {
    ok: failureCount === 0 && cleanupResidual === 0,
    backend,
    method,
    input_count: inputCount === null ? successCount + failureCount : inputCount,
    success_count: successCount,
    failure_count: failureCount,
    partial_failure: successCount > 0 && failureCount > 0,
    failures: Array.isArray(failureList) ? failureList : [],
    fallback: fallback || { used: false, reason: "" },
    cleanup: cleanup
      ? {
          ...cleanup,
          residual_count: cleanupResidual,
        }
      : null,
    stats: normalizedStats,
  };
}

export function normalizeStage2MembershipMutationResult({
  method = "unknown",
  operations = [],
  applied = [],
  missing = [],
  guarded = [],
  failed = [],
  backendError = "",
  dryRun = false,
  guard = { ok: true },
  fallback = { used: false, tool: "" },
  stats = null,
} = {}) {
  const operationList = Array.isArray(operations) ? operations : [];
  const appliedList = Array.isArray(applied) ? applied : [];
  const missingList = Array.isArray(missing) ? missing : [];
  const guardedList = Array.isArray(guarded) ? guarded : [];
  const failedList = Array.isArray(failed) ? failed : [];
  const failures = [
    ...missingList.map((failure) => ({ ...failure, missing: true })),
    ...guardedList.map((failure) => ({ ...failure, blocked: true })),
    ...failedList,
  ];
  if (backendError) {
    failures.push({ error: backendError, backend_error: true });
  }

  return {
    ok: failures.length === 0,
    method,
    dry_run: Boolean(dryRun),
    input_count: operationList.length,
    success_count: appliedList.length,
    failure_count: failures.length,
    partial_failure: appliedList.length > 0 && failures.length > 0,
    missing_count: missingList.length,
    guard_blocked_count: guardedList.length,
    writer_allowed: Boolean(guard?.ok !== false && !dryRun),
    applied: appliedList,
    failures,
    backend_error: backendError || "",
    fallback,
    stats: stats || null,
  };
}
