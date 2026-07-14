import { createZoteroBackendToolCall } from "../lib/zotero_backend_client.mjs";
import { buildLlmReviewCandidates, resolveEligibleRuleGrades } from "./llm_grade_reviewer.mjs";
import { classifyPreLlmZoteroExistingDuplicates } from "./zotero_existing_dedupe.mjs";

function buildUnavailablePreLlmDedupe(candidates, llmReviewCandidateCount) {
  return {
    newCandidatesForLlmReview: candidates,
    skippedExistingBeforeLlmReview: [],
    duplicateCheckFailedCandidates: [],
    diagnostics: {
      ok: false,
      skipped_reason: "connector_unavailable",
      pre_llm_zotero_existing_dedupe_enabled: true,
      pre_llm_zotero_duplicate_checked_count: 0,
      pre_llm_existing_duplicate_count: 0,
      pre_llm_existing_duplicate_by_reason: { doi: 0, pmid: 0, pmcid: 0, url: 0, title: 0, itemKey: 0, other: 0 },
      pre_llm_duplicate_check_failed_count: llmReviewCandidateCount,
      llm_review_candidate_count_before_zotero_dedupe: llmReviewCandidateCount,
      llm_review_candidate_count_after_zotero_dedupe: llmReviewCandidateCount,
      skipped_llm_review_existing_count: 0,
      duplicate_check_failed_reviewed_count: llmReviewCandidateCount,
      skipped_writeback_pre_llm_existing_count: 0,
      search_library_parse_error_count: 0,
      search_query_fallback_success_count: 0,
    },
  };
}

export function selectPreLlmDedupeCandidates({
  triagedItems = [],
  llmReviewConfig = {},
  duplicateRemovedCount = 0,
} = {}) {
  const llmReviewCandidateSelection = buildLlmReviewCandidates(triagedItems, {
    eligibleRuleGrades: resolveEligibleRuleGrades(llmReviewConfig),
    duplicateRemovedCount,
  });
  return {
    llmReviewCandidateSelection,
    preLlmCheckCandidates: llmReviewCandidateSelection.candidates,
  };
}

export async function runPreLlmDedupeStep({
  triagedItems = [],
  llmReviewConfig = {},
  duplicateRemovedCount = 0,
  llmReviewCandidateCount = 0,
  connectorOk = false,
  localIndexPath = "",
  existingItemLookup = null,
  zoteroBackendFactory = createZoteroBackendToolCall,
} = {}) {
  const {
    llmReviewCandidateSelection,
    preLlmCheckCandidates,
  } = selectPreLlmDedupeCandidates({
    triagedItems,
    llmReviewConfig,
    duplicateRemovedCount,
  });
  const effectiveCandidateCount = llmReviewCandidateSelection.summary.llm_review_candidate_count ?? llmReviewCandidateCount;

  if (typeof existingItemLookup === "function") {
    const newCandidatesForLlmReview = [];
    const skippedExistingBeforeLlmReview = [];
    for (const candidate of preLlmCheckCandidates) {
      const match = await existingItemLookup(candidate);
      if (match?.exists) skippedExistingBeforeLlmReview.push({ candidate, match });
      else newCandidatesForLlmReview.push(candidate);
    }
    const skippedCount = skippedExistingBeforeLlmReview.length;
    const diagnostics = {
      ok: true,
      method: "injected_existing_item_lookup",
      pre_llm_zotero_existing_dedupe_enabled: false,
      pre_llm_zotero_duplicate_checked_count: 0,
      pre_llm_existing_duplicate_count: skippedCount,
      pre_llm_existing_duplicate_by_reason: {},
      pre_llm_duplicate_check_failed_count: 0,
      llm_review_candidate_count_before_zotero_dedupe: effectiveCandidateCount,
      llm_review_candidate_count_after_zotero_dedupe: newCandidatesForLlmReview.length,
      skipped_llm_review_existing_count: skippedCount,
      duplicate_check_failed_reviewed_count: 0,
      skipped_writeback_pre_llm_existing_count: 0,
      search_library_parse_error_count: 0,
      search_query_fallback_success_count: 0,
    };
    return {
      preLlmExistingDedupe: { newCandidatesForLlmReview, skippedExistingBeforeLlmReview, duplicateCheckFailedCandidates: [], diagnostics },
      llmReviewCandidateSelection,
      llmReviewItems: newCandidatesForLlmReview,
    };
  }

  let readOnlyZoteroBackendCall = null;
  if (connectorOk) {
    readOnlyZoteroBackendCall = await zoteroBackendFactory();
  }
  let preLlmExistingDedupe = await classifyPreLlmZoteroExistingDuplicates(preLlmCheckCandidates, {
    mcpToolCall: readOnlyZoteroBackendCall,
    localIndexPath,
    verifyLocalIndexMatches: connectorOk,
  });
  if (!preLlmExistingDedupe.diagnostics?.local_zotero_index_used && !connectorOk) {
    preLlmExistingDedupe = buildUnavailablePreLlmDedupe(preLlmCheckCandidates, effectiveCandidateCount);
  }

  return {
    preLlmExistingDedupe,
    llmReviewCandidateSelection,
    llmReviewItems: llmReviewCandidateSelection.candidates,
  };
}
