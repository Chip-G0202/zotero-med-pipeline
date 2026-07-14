/**
 * Stage 1 dedup summary builder — pure function.
 *
 * Constructs a structured, auditable summary of the deduplication step
 * without embedding full item lists, titles, or identifiers into the report.
 *
 * All inputs must be supplied by the caller. This function does NOT:
 *   - read or write files
 *   - access the network
 *   - call LLM or MCP services
 *   - depend on process.env
 */

export function buildStage1DedupSummary({
  inputItems = [],
  dedupedItems = [],
  dedupDiagnostics = {},
  dedupKeyStrategy = "existing",
} = {}) {
  const inputItemsCount = Array.isArray(inputItems) ? inputItems.length : 0;
  const dedupedItemsCount = Array.isArray(dedupedItems) ? dedupedItems.length : 0;

  const diagnosticsHasFetched = typeof dedupDiagnostics.fetched_count === "number";
  const diagnosticsHasDeduped = typeof dedupDiagnostics.deduped_count === "number";
  const diagnosticsHasDuplicates = typeof dedupDiagnostics.duplicate_removed_count === "number";

  const fetchedCount = diagnosticsHasFetched
    ? dedupDiagnostics.fetched_count
    : inputItemsCount;
  const dedupedCount = diagnosticsHasDeduped
    ? dedupDiagnostics.deduped_count
    : dedupedItemsCount;
  const duplicatesRemovedCount = diagnosticsHasDuplicates
    ? dedupDiagnostics.duplicate_removed_count
    : Math.max(0, fetchedCount - dedupedCount);

  const skippedByKeyTypeSummary = (() => {
    const raw = dedupDiagnostics.skipped_by_key_type;
    if (!raw || typeof raw !== "object") return {};
    const cleaned = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "number") cleaned[key] = value;
    }
    return cleaned;
  })();

  return {
    input_items_count: inputItemsCount,
    deduped_items_count: dedupedItemsCount,
    duplicates_removed_count: duplicatesRemovedCount,
    dedup_applied: true,
    dedup_key_strategy: dedupKeyStrategy,
    deduced_from_input_arrays: !diagnosticsHasFetched || !diagnosticsHasDeduped || !diagnosticsHasDuplicates,
    skipped_by_key_type: skippedByKeyTypeSummary,
    downstream_collection: "merged (deduped set) → triagedAll → LLM review candidates + writeback ready artifact",
    used_for_llm_review: true,
    used_for_writeback_ready: true,
    notes: [
      "dedup_summary does not embed full item lists, duplicate titles, or identifiers",
      "existing report.steps.dedupe.* fields are preserved unchanged",
      "this summary is a supplementary audit layer and does not alter data flow",
    ],
  };
}
