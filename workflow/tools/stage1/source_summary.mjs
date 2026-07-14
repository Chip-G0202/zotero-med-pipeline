/**
 * Stage 1 source collection summary builder — pure function.
 *
 * Constructs a structured, auditable summary of which literature sources
 * were enabled, triggered, collected items, and contributed to the
 * pre-dedup collection. Does not embed full item lists, queries, or API responses.
 *
 * All inputs must be supplied by the caller. This function does NOT:
 *   - read or write files
 *   - access the network
 *   - call LLM or MCP services
 *   - depend on process.env
 */

/**
 * @typedef {Object} SourceDescriptor
 * @property {string} name - e.g. "rss", "pubmed_pmc"
 * @property {boolean|"unknown"} enabled
 * @property {boolean|"unknown"} triggered
 * @property {number} itemsCollectedCount
 * @property {boolean|"unknown"} enteredPreDedupCollection
 * @property {string|null} skippedReason
 * @property {string|null} failureReason
 * @property {boolean} degraded
 * @property {number} warningsCount
 */

/**
 * @param {Object} params
 * @param {SourceDescriptor[]} [params.sources=[]]
 * @param {number} [params.preDedupItemsCount=0]
 * @returns {Object} source collection summary
 */
export function buildStage1SourceSummary({
  sources = [],
  preDedupItemsCount = 0,
} = {}) {
  const srcs = Array.isArray(sources) ? sources : [];

  const sourcesCount = srcs.length;

  const enabledSourcesCount = srcs.filter(
    (s) => s.enabled === true,
  ).length;

  const triggeredSourcesCount = srcs.filter(
    (s) => s.triggered === true,
  ).length;

  const succeededSourcesCount = srcs.filter(
    (s) => s.failureReason == null && s.triggered === true && s.degraded !== true,
  ).length;

  const failedSourcesCount = srcs.filter(
    (s) => s.failureReason != null || s.degraded === true,
  ).length;

  const degraded = srcs.some((s) => s.degraded === true);

  const totalCollectedItemsCount = srcs.reduce(
    (sum, s) => sum + (typeof s.itemsCollectedCount === "number" ? s.itemsCollectedCount : 0),
    0,
  );

  const sanitisedSources = srcs.map((s) => ({
    name: String(s.name || "unknown"),
    enabled: s.enabled,
    triggered: s.triggered,
    items_collected_count: typeof s.itemsCollectedCount === "number" ? s.itemsCollectedCount : 0,
    entered_pre_dedup_collection: s.enteredPreDedupCollection,
    skipped_reason: s.skippedReason || null,
    failure_reason: s.failureReason || null,
    degraded: Boolean(s.degraded),
    warnings_count: typeof s.warningsCount === "number" ? s.warningsCount : 0,
  }));

  const failureReasons = srcs
    .filter((s) => s.failureReason != null)
    .map((s) => ({
      source: String(s.name || "unknown"),
      reason: String(s.failureReason),
    }));

  const degradedReasons = srcs
    .filter((s) => s.degraded === true)
    .map((s) => ({
      source: String(s.name || "unknown"),
      reason: s.failureReason || s.skippedReason || "degraded",
    }));

  const notes = [
    "source_collection_summary does not embed full item lists, queries, or API responses",
    "existing report.steps.med_entry_parallel and report.counts.* fields are preserved unchanged",
    "this summary is a supplementary audit layer and does not alter data flow",
  ];

  return {
    sources_count: sourcesCount,
    enabled_sources_count: enabledSourcesCount,
    triggered_sources_count: triggeredSourcesCount,
    succeeded_sources_count: succeededSourcesCount,
    failed_sources_count: failedSourcesCount,
    degraded,
    total_collected_items_count: totalCollectedItemsCount,
    pre_dedup_items_count: preDedupItemsCount,
    sources: sanitisedSources,
    failure_reasons: failureReasons,
    degraded_reasons: degradedReasons,
    notes,
  };
}
