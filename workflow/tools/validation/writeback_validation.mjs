function toCount(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function normalizeShortTitle(shortTitle = {}) {
  return {
    expected: toCount(shortTitle.expected),
    updated: toCount(shortTitle.updated),
    skipped: toCount(shortTitle.skipped),
    verified: toCount(shortTitle.verified),
  };
}

function normalizeRequestStats(requestStats = {}) {
  return {
    logical_item_count: toCount(requestStats.logicalItemCount ?? requestStats.logical_item_count),
    request_count: toCount(requestStats.requestCount ?? requestStats.request_count),
  };
}

export function buildCleanupValidationSummary({
  itemResidual = 0,
  collectionResidual = 0,
  localIndexResidual = 0,
  backendResidual = 0,
} = {}) {
  const residualCount = toCount(itemResidual)
    + toCount(collectionResidual)
    + toCount(localIndexResidual)
    + toCount(backendResidual);
  const violations = residualCount > 0 ? ["cleanup_residual_nonzero"] : [];
  return {
    ok: violations.length === 0,
    item_residual: toCount(itemResidual),
    collection_residual: toCount(collectionResidual),
    local_index_residual: toCount(localIndexResidual),
    backend_residual: toCount(backendResidual),
    residual_count: residualCount,
    violations,
  };
}

export function buildWritebackValidationSummary({
  backendSelected = "unknown",
  desktopLaunched = "unknown",
  counters = {},
  attachStats = {},
  rootPoolNewItemCount = 0,
  shortTitle = {},
  runMarker = {},
  localIndexResidual = 0,
  backendResidual = 0,
  cleanupResidual = 0,
  requestStats = {},
  backendDetails = {},
} = {}) {
  const createdCount = toCount(counters.created);
  const failedCount = toCount(counters.failed);
  const sourceAdded = toCount(attachStats.source_added_count ?? attachStats.sourceAddedCount ?? counters.added_to_daily_collection);
  const gradeAdded = toCount(attachStats.grade_added_count ?? attachStats.gradeAddedCount ?? counters.added_to_daily_collection);
  const rootPoolCount = toCount(rootPoolNewItemCount);
  const shortTitleSummary = normalizeShortTitle(shortTitle);
  const runMarkerExpected = toCount(runMarker.expected, createdCount);
  const runMarkerVerified = toCount(runMarker.verified, runMarkerExpected);
  const cleanup = buildCleanupValidationSummary({
    itemResidual: cleanupResidual,
    localIndexResidual,
    backendResidual,
  });
  const violations = [];

  if (failedCount > 0) violations.push("created_failed_count_nonzero");
  if (sourceAdded < createdCount) violations.push("source_collection_below_created_count");
  if (gradeAdded < createdCount) violations.push("grade_collection_below_created_count");
  if (rootPoolCount !== 0) violations.push("root_pool_new_item_count_nonzero");
  if (shortTitleSummary.expected > 0 && shortTitleSummary.verified < shortTitleSummary.expected) {
    violations.push("shortTitle_verified_below_expected");
  }
  if (runMarkerVerified < runMarkerExpected) violations.push("run_marker_verified_below_expected");
  violations.push(...cleanup.violations);

  return {
    ok: violations.length === 0,
    backend_selected: backendSelected,
    desktop_launched: desktopLaunched,
    created_count: createdCount,
    failed_count: failedCount,
    source_collection_correct: sourceAdded >= createdCount,
    grade_collection_correct: gradeAdded >= createdCount,
    root_pool_count: rootPoolCount,
    shortTitle: shortTitleSummary,
    run_marker: {
      expected: runMarkerExpected,
      verified: runMarkerVerified,
    },
    local_index_residual: toCount(localIndexResidual),
    cloud_desktop_residual: toCount(backendResidual),
    cleanup_residual: toCount(cleanupResidual),
    request_stats: normalizeRequestStats(requestStats),
    backendDetails,
    violations,
  };
}
