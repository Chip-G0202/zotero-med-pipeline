/**
 * Stage 1 triage / initial grade summary builder — pure function.
 *
 * Constructs a structured, auditable summary of the rule-based grading
 * step: grade distribution, ABC vs non-ABC split, and alignment with
 * downstream LLM review candidate counts and writeback ready counts.
 * Does not embed full item lists, titles, or abstracts.
 *
 * All inputs must be supplied by the caller. This function does NOT:
 *   - read or write files
 *   - access the network
 *   - call LLM or MCP services
 *   - depend on process.env
 */

/** Known grade letters used by the triage system. */
const KNOWN_GRADES = ["A", "B", "C", "D", "E"];

/**
 * @param {Object} params
 * @param {Object[]} [params.items=[]] - triaged items, each expected to have .grade and .rule_grade
 * @param {number} [params.llmReviewCandidateCount=0] - output of buildLlmReviewCandidates
 * @param {number} [params.writebackReadyItemsCount=0] - output count from buildWritebackReadyArtifact
 * @param {string} [params.gradeFieldPrecedence="rule_grade || grade"]
 * @returns {Object} triage summary
 */
export function buildStage1TriageSummary({
  items = [],
  llmReviewCandidateCount = 0,
  writebackReadyItemsCount = 0,
  gradeFieldPrecedence = "rule_grade || grade",
} = {}) {
  const src = Array.isArray(items) ? items : [];
  const triagedItemsCount = src.length;

  // Resolve effective grade per item: rule_grade || grade
  const grades = src.map((item) => {
    const rg = String(item?.rule_grade || "").trim().toUpperCase();
    const g = String(item?.grade || "").trim().toUpperCase();
    return rg || g || "";
  });

  const gradeCounts = {};
  for (const letter of KNOWN_GRADES) {
    gradeCounts[letter] = grades.filter((g) => g === letter).length;
  }

  const missingGradeCount = grades.filter((g) => g === "").length;
  const unknownGradeCount = grades.filter((g) => g !== "" && !KNOWN_GRADES.includes(g)).length;

  gradeCounts.missing = missingGradeCount;
  gradeCounts.unknown = unknownGradeCount;

  const abcCount = gradeCounts.A + gradeCounts.B + gradeCounts.C;
  const nonAbcCount = triagedItemsCount - abcCount;

  const knownNonAbcCount = KNOWN_GRADES.filter((g) => g !== "A" && g !== "B" && g !== "C")
    .reduce((sum, g) => sum + (gradeCounts[g] || 0), 0);

  const excludedFromLlmReviewCount = nonAbcCount;
  const excludedFromWritebackReadyCount = gradeCounts.D + gradeCounts.E + missingGradeCount + unknownGradeCount;

  const notes = [
    "triage_summary does not embed full item lists, titles, or abstracts",
    "existing report.steps.med_daily_triage and report.counts.* fields are preserved unchanged",
    "this summary is a supplementary audit layer and does not alter data flow",
    `grade_field_precedence: ${gradeFieldPrecedence}`,
  ];

  return {
    triaged_items_count: triagedItemsCount,
    grade_counts: gradeCounts,
    abc_count: abcCount,
    non_abc_count: nonAbcCount,
    known_non_abc_count: knownNonAbcCount,
    missing_grade_count: missingGradeCount,
    unknown_grade_count: unknownGradeCount,
    llm_review_candidate_count: llmReviewCandidateCount,
    writeback_ready_items_count: writebackReadyItemsCount,
    excluded_from_llm_review_count: excludedFromLlmReviewCount,
    excluded_from_writeback_ready_count: excludedFromWritebackReadyCount,
    grade_field_precedence: gradeFieldPrecedence,
    notes,
  };
}
