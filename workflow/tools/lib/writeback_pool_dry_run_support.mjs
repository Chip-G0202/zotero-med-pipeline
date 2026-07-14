import { buildPoolDuplicateIndex, matchPoolDuplicate } from "./writeback_support.mjs";
import { isoWeek, yyMd } from "./date_label_support.mjs";

export { isoWeek, yyMd };

export function weekLabel(d) {
  return isoWeek(d);
}

export function buildDryRunReport({
  now = new Date(),
  runtimeStatePath = "",
  lastSuccessfulRunAt = null,
  runIntervalDays = 2,
  forceRun = false,
  exportRoot = "",
  feedbackReviewRoot = "",
  feedbackLearning = {},
  pool = { found: false, ambiguous: false, collection_key: null, items: [] },
  candidates = [],
  candidateLookupCalls = 0,
  dryRunReuseResolver = null,
} = {}) {
  const sourceCandidates = Array.isArray(candidates) ? candidates : [];
  const poolItems = Array.isArray(pool?.items) ? pool.items : [];
  const duplicateIndex = buildPoolDuplicateIndex(poolItems);
  const duplicateSamples = [];
  const duplicateByType = {};
  let duplicateCount = 0;
  let reusableBySearchCount = 0;

  for (const item of sourceCandidates) {
    const match = matchPoolDuplicate(item, duplicateIndex);
    const reusableBySearch = !match.matched && typeof dryRunReuseResolver === "function"
      ? Boolean(dryRunReuseResolver(item))
      : false;
    if (match.matched || reusableBySearch) {
      duplicateCount += 1;
      const type = match.matched ? match.type : "search_library";
      duplicateByType[type] = (duplicateByType[type] || 0) + 1;
      if (reusableBySearch) reusableBySearchCount += 1;
      if (duplicateSamples.length < 20) {
        duplicateSamples.push({
          title: item?.title || "",
          doi: item?.doi || item?.DOI || "",
          pmid: item?.pmid || "",
          pmcid: item?.pmcid || "",
          duplicate_type: type,
          matched_item_key: match.itemKey || "",
        });
      }
    }
  }

  return {
    ok: true,
    dry_run: true,
    generated_at: now.toISOString(),
    runtime_state_path: runtimeStatePath,
    last_successful_run_at: lastSuccessfulRunAt,
    run_interval_days: runIntervalDays,
    force_run: Boolean(forceRun),
    export_root: exportRoot,
    feedback_review_root: feedbackReviewRoot,
    feedback_learning: feedbackLearning,
    pool: {
      found: Boolean(pool?.found),
      ambiguous: Boolean(pool?.ambiguous),
      collection_key: pool?.collection_key || null,
      item_count: poolItems.length,
    },
    candidates: {
      input_count: sourceCandidates.length,
      duplicate_or_reusable_count: duplicateCount,
      would_create_count: Math.max(0, sourceCandidates.length - duplicateCount),
      duplicate_by_type: duplicateByType,
      reusable_by_search_count: reusableBySearchCount,
      duplicate_samples: duplicateSamples,
    },
    candidateLookupCalls,
  };
}
