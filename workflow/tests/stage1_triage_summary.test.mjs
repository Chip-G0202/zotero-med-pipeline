import assert from "node:assert/strict";
import test from "node:test";
import { buildStage1TriageSummary } from "../tools/stage1/triage_summary.mjs";

function abcItems(n) {
  const grades = ["A", "B", "C"];
  const out = [];
  for (let i = 0; i < n; i++) {
    const g = grades[i % 3];
    out.push({ grade: g, rule_grade: g });
  }
  return out;
}

test("buildStage1TriageSummary — normal A/B/C/D/E distribution", () => {
  const items = [
    { grade: "A", rule_grade: "A" },
    { grade: "A", rule_grade: "A" },
    { grade: "B", rule_grade: "B" },
    { grade: "C", rule_grade: "C" },
    { grade: "C", rule_grade: "C" },
    { grade: "C", rule_grade: "C" },
    { grade: "D", rule_grade: "D" },
    { grade: "E", rule_grade: "E" },
  ];
  const summary = buildStage1TriageSummary({ items });

  assert.equal(summary.triaged_items_count, 8);
  assert.equal(summary.grade_counts.A, 2);
  assert.equal(summary.grade_counts.B, 1);
  assert.equal(summary.grade_counts.C, 3);
  assert.equal(summary.grade_counts.D, 1);
  assert.equal(summary.grade_counts.E, 1);
  assert.equal(summary.abc_count, 6);
  assert.equal(summary.non_abc_count, 2);
  assert.equal(summary.missing_grade_count, 0);
  assert.equal(summary.unknown_grade_count, 0);
});

test("buildStage1TriageSummary — missing and unknown grades", () => {
  const items = [
    { grade: "A", rule_grade: "A" },
    { grade: "", rule_grade: "" },
    { grade: "", rule_grade: "" },
    { grade: "X", rule_grade: "" },
    { grade: "", rule_grade: "Y" },
  ];
  const summary = buildStage1TriageSummary({ items });

  assert.equal(summary.grade_counts.A, 1);
  assert.equal(summary.grade_counts.missing, 2); // rows 2, 3 have empty grade
  assert.equal(summary.grade_counts.unknown, 2); // rows 4 (X) and 5 (Y)
  assert.equal(summary.missing_grade_count, 2);
  assert.equal(summary.unknown_grade_count, 2);
  assert.equal(summary.abc_count, 1);
  assert.equal(summary.non_abc_count, 4);
});

test("buildStage1TriageSummary — rule_grade || grade precedence", () => {
  const items = [
    { grade: "C", rule_grade: "A" },
    { grade: "A", rule_grade: "" },
    { grade: "", rule_grade: "B" },
  ];
  const summary = buildStage1TriageSummary({ items });

  // item 0: rule_grade A wins over grade C → A
  // item 1: rule_grade empty → grade A → A
  // item 2: rule_grade B → B
  assert.equal(summary.grade_counts.A, 2);
  assert.equal(summary.grade_counts.B, 1);
  assert.equal(summary.abc_count, 3);
});

test("buildStage1TriageSummary — empty items", () => {
  const summary = buildStage1TriageSummary({});
  assert.equal(summary.triaged_items_count, 0);
  assert.equal(summary.abc_count, 0);
  assert.equal(summary.non_abc_count, 0);
  assert.equal(summary.grade_counts.A, 0);
  assert.equal(summary.grade_counts.missing, 0);
  assert.equal(summary.grade_counts.unknown, 0);
});

test("buildStage1TriageSummary — llm and writeback counts passed through", () => {
  const summary = buildStage1TriageSummary({
    items: abcItems(5),
    llmReviewCandidateCount: 5,
    writebackReadyItemsCount: 4,
  });

  assert.equal(summary.llm_review_candidate_count, 5);
  assert.equal(summary.writeback_ready_items_count, 4);
});

test("buildStage1TriageSummary — excluded counts computed correctly", () => {
  const items = [
    { grade: "A", rule_grade: "A" },
    { grade: "A", rule_grade: "A" },
    { grade: "B", rule_grade: "B" },
    { grade: "D", rule_grade: "D" },
    { grade: "E", rule_grade: "E" },
    { grade: "", rule_grade: "" },
    { grade: "Z", rule_grade: "Z" },
  ];
  const summary = buildStage1TriageSummary({ items });

  assert.equal(summary.triaged_items_count, 7);
  assert.equal(summary.abc_count, 3);
  // excluded from LLM review = non-ABC = 4 (D, E, missing, unknown)
  assert.equal(summary.excluded_from_llm_review_count, 4);
  // excluded from writeback ready = D + E + missing + unknown = 1 + 1 + 1 + 1
  assert.equal(summary.excluded_from_writeback_ready_count, 4);
});

test("buildStage1TriageSummary — does not modify its inputs", () => {
  const inputParams = {
    items: abcItems(3),
    llmReviewCandidateCount: 3,
    writebackReadyItemsCount: 3,
  };
  const frozen = JSON.parse(JSON.stringify(inputParams));
  buildStage1TriageSummary(inputParams);
  assert.deepEqual(inputParams, frozen);
});

test("buildStage1TriageSummary — grade_field_precedence in notes", () => {
  const summary = buildStage1TriageSummary({
    items: abcItems(1),
    gradeFieldPrecedence: "custom_precedence",
  });
  assert.equal(summary.grade_field_precedence, "custom_precedence");
  assert.ok(summary.notes.some((n) => n.includes("custom_precedence")));
});

test("buildStage1TriageSummary — report-compatible: known_non_abc_count matches D+E", () => {
  const items = [
    { grade: "A", rule_grade: "A" },
    { grade: "D", rule_grade: "D" },
    { grade: "D", rule_grade: "D" },
    { grade: "E", rule_grade: "E" },
  ];
  const summary = buildStage1TriageSummary({ items });
  assert.equal(summary.known_non_abc_count, 3);
  assert.equal(summary.grade_counts.D, 2);
  assert.equal(summary.grade_counts.E, 1);
});

test("buildStage1TriageSummary — non-zero real downstream counts (not placeholder 0)", () => {
  const items = [
    { grade: "A", rule_grade: "A" },
    { grade: "A", rule_grade: "A" },
    { grade: "B", rule_grade: "B" },
    { grade: "C", rule_grade: "C" },
    { grade: "D", rule_grade: "D" },
    { grade: "D", rule_grade: "D" },
    { grade: "", rule_grade: "" },
  ];
  // simulate real LLM candidate selection (only A/B/C enter)
  const realLlmCandidateCount = 4; // A:2 + B:1 + C:1
  const realWritebackReadyCount = 4; // same as ABC

  const summary = buildStage1TriageSummary({
    items,
    llmReviewCandidateCount: realLlmCandidateCount,
    writebackReadyItemsCount: realWritebackReadyCount,
  });

  assert.equal(summary.triaged_items_count, 7);
  assert.equal(summary.llm_review_candidate_count, 4);
  assert.equal(summary.writeback_ready_items_count, 4);
  // non-zero: not placeholder 0
  assert.ok(summary.llm_review_candidate_count > 0, "expected non-zero LLM candidate count");
  assert.ok(summary.writeback_ready_items_count > 0, "expected non-zero writeback ready count");
  // D/E/missing/unknown don't enter LLM review = 3 (2 D + 1 missing)
  assert.equal(summary.excluded_from_llm_review_count, 3);
  // D + missing excluded from writeback ready = 2 + 1 = 3
  assert.equal(summary.excluded_from_writeback_ready_count, 3);
});
