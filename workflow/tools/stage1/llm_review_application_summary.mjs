/**
 * LLM review application summary builder — pure function.
 *
 * Builds a structured diagnostic summary of how LLM review results were
 * applied to triaged items, including match counts, grade changes, and
 * unmatched/missing diagnostics. Does not embed full item lists, prompts,
 * or LLM responses.
 *
 * All inputs must be supplied by the caller. This function does NOT:
 *   - read or write files
 *   - access the network
 *   - call LLM or MCP services
 *   - depend on process.env
 *   - mutate input items
 */

/**
 * @param {Object} params
 * @param {Object[]} [params.triagedItems=[]] - triaged items after LLM review application
 * @param {Object} [params.llmReport={}] - output of reviewGradesWithLlm
 * @returns {Object} application summary
 */
export function buildLlmReviewApplicationSummary({
  triagedItems = [],
  llmReport = {},
} = {}) {
  const items = Array.isArray(triagedItems) ? triagedItems : [];

  const resultGrades = Array.isArray(llmReport?.llm_review_grades)
    ? llmReport.llm_review_grades
    : [];

  const resultIds = new Set(resultGrades.map((entry) => entry?.id).filter(Boolean));

  // Items that received an LLM semantic grade (matched + applied)
  const itemsWithSemanticGrade = items.filter(
    (item) => item && item.semantic_grade && item.semantic_source === "llm_title_review",
  );

  // Items that were candidates but got no LLM result
  const candidatesWithoutResult = items.filter(
    (item) => item && item.rule_grade && ["A", "B", "C"].includes(item.rule_grade)
      && !resultIds.has(item.id) && !item.llm_review_grade,
  );

  // LLM results with no matching item in triaged collection
  const unmatchedResults = resultGrades.filter((entry) => {
    if (!entry?.id) return true;
    return !items.some((item) => item?.id === entry.id);
  });

  const appliedCount = itemsWithSemanticGrade.length;
  const candidateWithoutResultCount = candidatesWithoutResult.length;
  const unmatchedResultCount = unmatchedResults.length;

  // Grade change diagnostics
  const gradeUpgradedCount = items.filter(
    (item) => item && item.semantic_grade && item.rule_grade
      && item.final_grade !== item.rule_grade
      && { A: 1, B: 2, C: 3, D: 4 }[item.final_grade || ""] < { A: 1, B: 2, C: 3, D: 4 }[item.rule_grade || ""],
  ).length;

  const gradeDowngradedCount = items.filter(
    (item) => item && item.semantic_grade && item.rule_grade
      && item.final_grade !== item.rule_grade
      && { A: 1, B: 2, C: 3, D: 4 }[item.final_grade || ""] > { A: 1, B: 2, C: 3, D: 4 }[item.rule_grade || ""],
  ).length;

  const gradeUnchangedCount = appliedCount - gradeUpgradedCount - gradeDowngradedCount;

  const matchKey = "id (item.id || item.itemKey || item.doi || item.pmid || index-fallback)";

  const skippedReason = llmReport?.skipped ? (llmReport?.skipped_reason || "unknown") : null;

  const notes = [
    "llm_review_application_summary does not embed full item lists, prompts, or LLM responses",
    "application occurs inside reviewGradesWithLlm via applyReviewToItems — this summary is a post-hoc diagnostic",
    skippedReason ? `LLM review skipped: ${skippedReason}` : "",
    "existing report.steps.semantic_grading and item fields are preserved unchanged",
  ].filter(Boolean);

  return {
    applied_count: appliedCount,
    unmatched_result_count: unmatchedResultCount,
    candidate_without_result_count: candidateWithoutResultCount,
    match_key: matchKey,
    grade_changes: {
      upgraded: gradeUpgradedCount,
      downgraded: gradeDowngradedCount,
      unchanged: gradeUnchangedCount,
    },
    skipped_reason: skippedReason,
    items_reviewed: Number(llmReport?.items_reviewed || 0),
    llm_review_grades_count: resultGrades.length,
    notes,
  };
}
