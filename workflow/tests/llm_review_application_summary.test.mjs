import assert from "node:assert/strict";
import test from "node:test";
import { buildLlmReviewApplicationSummary } from "../tools/stage1/llm_review_application_summary.mjs";

test("LLM results applied normally", () => {
  const items = [
    { id: "a1", rule_grade: "A", semantic_grade: "A", semantic_source: "llm_title_review", final_grade: "A", llm_review_grade: "A" },
    { id: "b1", rule_grade: "B", semantic_grade: "B", semantic_source: "llm_title_review", final_grade: "B", llm_review_grade: "B" },
    { id: "c1", rule_grade: "C", semantic_grade: "", semantic_source: "", final_grade: "C" },
  ];
  const llmReport = {
    ok: true,
    items_reviewed: 3,
    llm_review_grades: [
      { id: "a1", llm_review_grade: "A" },
      { id: "b1", llm_review_grade: "B" },
    ],
  };

  const summary = buildLlmReviewApplicationSummary({ triagedItems: items, llmReport });
  assert.equal(summary.applied_count, 2);
  assert.equal(summary.llm_review_grades_count, 2);
  assert.equal(summary.items_reviewed, 3);
  assert.equal(summary.candidate_without_result_count, 1);
  assert.equal(summary.unmatched_result_count, 0);
  assert.equal(summary.skipped_reason, null);
});

test("candidate without LLM result", () => {
  const items = [
    { id: "a1", rule_grade: "A", semantic_grade: "", semantic_source: "", final_grade: "A" },
  ];
  const llmReport = { ok: true, items_reviewed: 1, llm_review_grades: [] };

  const summary = buildLlmReviewApplicationSummary({ triagedItems: items, llmReport });
  assert.equal(summary.applied_count, 0);
  assert.equal(summary.candidate_without_result_count, 1);
});

test("LLM result with no matching item", () => {
  const items = [
    { id: "a1", rule_grade: "A", semantic_grade: "A", semantic_source: "llm_title_review", final_grade: "A" },
  ];
  const llmReport = {
    ok: true,
    llm_review_grades: [
      { id: "a1", llm_review_grade: "A" },
      { id: "ghost", llm_review_grade: "B" },
    ],
  };

  const summary = buildLlmReviewApplicationSummary({ triagedItems: items, llmReport });
  assert.equal(summary.unmatched_result_count, 1);
  assert.equal(summary.applied_count, 1);
});

test("grade change diagnostics", () => {
  const items = [
    { id: "a1", rule_grade: "B", semantic_grade: "A", semantic_source: "llm_title_review", final_grade: "A", llm_review_grade: "A" },
    { id: "b1", rule_grade: "A", semantic_grade: "B", semantic_source: "llm_title_review", final_grade: "B", llm_review_grade: "B" },
    { id: "c1", rule_grade: "A", semantic_grade: "A", semantic_source: "llm_title_review", final_grade: "A", llm_review_grade: "A" },
  ];
  const llmReport = {
    ok: true,
    llm_review_grades: [
      { id: "a1", llm_review_grade: "A" },
      { id: "b1", llm_review_grade: "B" },
      { id: "c1", llm_review_grade: "A" },
    ],
  };

  const summary = buildLlmReviewApplicationSummary({ triagedItems: items, llmReport });
  assert.equal(summary.grade_changes.upgraded, 1);
  assert.equal(summary.grade_changes.downgraded, 1);
  assert.equal(summary.grade_changes.unchanged, 1);
});

test("skipped LLM review", () => {
  const summary = buildLlmReviewApplicationSummary({
    triagedItems: [],
    llmReport: { skipped: true, skipped_reason: "no_eligible_items" },
  });
  assert.equal(summary.applied_count, 0);
  assert.equal(summary.skipped_reason, "no_eligible_items");
  assert.ok(summary.notes.some((n) => n.includes("no_eligible_items")));
});

test("empty inputs", () => {
  const summary = buildLlmReviewApplicationSummary({});
  assert.equal(summary.applied_count, 0);
  assert.equal(summary.unmatched_result_count, 0);
  assert.equal(summary.candidate_without_result_count, 0);
  assert.equal(summary.grade_changes.upgraded, 0);
  assert.equal(summary.skipped_reason, null);
});

test("does not modify its inputs", () => {
  const input = {
    triagedItems: [{ id: "a1", rule_grade: "A" }],
    llmReport: { ok: true, llm_review_grades: [] },
  };
  const frozen = JSON.parse(JSON.stringify(input));
  buildLlmReviewApplicationSummary(input);
  assert.deepEqual(input, frozen);
});
