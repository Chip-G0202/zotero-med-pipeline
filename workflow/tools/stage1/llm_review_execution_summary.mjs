/**
 * LLM review execution summary builder — pure function.
 *
 * Constructs a focused, auditable summary of the LLM semantic grade
 * review execution: whether it was triggered, how many candidates were
 * reviewed, success/failure/skip outcomes, and degradation status.
 * Does not embed prompts, responses, titles, or API keys.
 *
 * All inputs must be supplied by the caller. This function does NOT:
 *   - read or write files
 *   - access the network
 *   - call LLM or MCP services
 *   - depend on process.env
 */

/**
 * @param {Object} params
 * @param {number} [params.candidateCount=0]
 * @param {boolean} [params.enabled=false]
 * @param {boolean} [params.triggered=false]
 * @param {number} [params.reviewedCount=0]
 * @param {number} [params.succeededCount=0]
 * @param {number} [params.failedCount=0]
 * @param {string|null} [params.skippedReason=null]
 * @param {Object[]} [params.failureReasons=[]]
 * @param {boolean} [params.degraded=false]
 * @param {number} [params.resultItemsCount=0]
 * @param {number} [params.outputAppliedCount=0]
 * @returns {Object} execution summary
 */
export function buildLlmReviewExecutionSummary({
  candidateCount = 0,
  enabled = false,
  triggered = false,
  reviewedCount = 0,
  succeededCount = 0,
  failedCount = 0,
  skippedReason = null,
  failureReasons = [],
  degraded = false,
  resultItemsCount = 0,
  outputAppliedCount = 0,
} = {}) {
  const safeFailureReasons = (Array.isArray(failureReasons) ? failureReasons : []).map((entry) => {
    if (typeof entry === "string") return { reason: entry };
    return {
      reason: String(entry?.reason || entry?.message || "unknown"),
      source: String(entry?.source || ""),
    };
  });

  const derivedSkippedReason = skippedReason || (triggered ? null : candidateCount === 0 ? "no_candidates" : null);

  const notes = [
    "llm_review_execution_summary does not embed prompts, responses, or API keys",
    "existing report.steps.semantic_grading and report.llm_review_candidate_summary fields are preserved unchanged",
    "this summary is a supplementary audit layer and does not alter data flow",
  ];

  return {
    candidate_count: candidateCount,
    enabled,
    triggered,
    reviewed_count: reviewedCount,
    succeeded_count: succeededCount,
    failed_count: failedCount,
    degraded,
    skipped_reason: derivedSkippedReason,
    failure_reasons: safeFailureReasons.slice(0, 20),
    result_items_count: resultItemsCount,
    output_applied_count: outputAppliedCount,
    notes,
  };
}
