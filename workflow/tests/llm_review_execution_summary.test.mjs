import assert from "node:assert/strict";
import test from "node:test";
import { buildLlmReviewExecutionSummary } from "../tools/stage1/llm_review_execution_summary.mjs";

test("buildLlmReviewExecutionSummary — no candidates, skipped", () => {
  const summary = buildLlmReviewExecutionSummary({
    candidateCount: 0,
    enabled: true,
    triggered: false,
    reviewedCount: 0,
  });

  assert.equal(summary.candidate_count, 0);
  assert.equal(summary.triggered, false);
  assert.equal(summary.skipped_reason, "no_candidates");
  assert.equal(summary.reviewed_count, 0);
  assert.equal(summary.failed_count, 0);
  assert.equal(summary.degraded, false);
});

test("buildLlmReviewExecutionSummary — LLM success with candidates", () => {
  const summary = buildLlmReviewExecutionSummary({
    candidateCount: 5,
    enabled: true,
    triggered: true,
    reviewedCount: 5,
    succeededCount: 5,
    resultItemsCount: 5,
    outputAppliedCount: 5,
  });

  assert.equal(summary.candidate_count, 5);
  assert.equal(summary.triggered, true);
  assert.equal(summary.reviewed_count, 5);
  assert.equal(summary.succeeded_count, 5);
  assert.equal(summary.degraded, false);
  assert.equal(summary.result_items_count, 5);
  assert.equal(summary.output_applied_count, 5);
  assert.equal(summary.skipped_reason, null);
});

test("buildLlmReviewExecutionSummary — disabled LLM", () => {
  const summary = buildLlmReviewExecutionSummary({
    candidateCount: 3,
    enabled: false,
    triggered: false,
    skippedReason: "disabled",
  });

  assert.equal(summary.enabled, false);
  assert.equal(summary.triggered, false);
  assert.equal(summary.skipped_reason, "disabled");
  assert.equal(summary.reviewed_count, 0);
});

test("buildLlmReviewExecutionSummary — LLM failure degraded", () => {
  const summary = buildLlmReviewExecutionSummary({
    candidateCount: 10,
    enabled: true,
    triggered: true,
    reviewedCount: 10,
    succeededCount: 3,
    failedCount: 2,
    degraded: true,
    failureReasons: [
      { reason: "batch_parse_error", source: "batch_3" },
      { reason: "rate_limit", source: "batch_4" },
    ],
    resultItemsCount: 3,
    outputAppliedCount: 3,
  });

  assert.equal(summary.triggered, true);
  assert.equal(summary.degraded, true);
  assert.equal(summary.failed_count, 2);
  assert.equal(summary.succeeded_count, 3);
  assert.equal(summary.failure_reasons.length, 2);
  assert.equal(summary.failure_reasons[0].reason, "batch_parse_error");
});

test("buildLlmReviewExecutionSummary — empty inputs", () => {
  const summary = buildLlmReviewExecutionSummary({});
  assert.equal(summary.candidate_count, 0);
  assert.equal(summary.triggered, false);
  assert.equal(summary.reviewed_count, 0);
  assert.equal(summary.failed_count, 0);
  assert.equal(summary.degraded, false);
  assert.deepEqual(summary.failure_reasons, []);
});

test("buildLlmReviewExecutionSummary — string failure reasons normalised", () => {
  const summary = buildLlmReviewExecutionSummary({
    failureReasons: ["error1", "error2"],
    degraded: true,
  });
  assert.equal(summary.failure_reasons.length, 2);
  assert.equal(summary.failure_reasons[0].reason, "error1");
  assert.equal(summary.failure_reasons[1].reason, "error2");
});

test("buildLlmReviewExecutionSummary — truncated failure reasons at 20", () => {
  const reasons = Array.from({ length: 25 }, (_, i) => ({ reason: `error_${i}` }));
  const summary = buildLlmReviewExecutionSummary({ failureReasons: reasons });
  assert.equal(summary.failure_reasons.length, 20);
});

test("buildLlmReviewExecutionSummary — does not modify its inputs", () => {
  const input = { candidateCount: 3, triggered: true, reviewedCount: 3 };
  const frozen = JSON.parse(JSON.stringify(input));
  buildLlmReviewExecutionSummary(input);
  assert.deepEqual(input, frozen);
});

test("buildLlmReviewExecutionSummary — report-compatible", () => {
  const summary = buildLlmReviewExecutionSummary({
    candidateCount: 0,
    reviewedCount: 0,
  });
  assert.ok(Array.isArray(summary.notes) && summary.notes.length > 0);
  assert.ok(summary.notes.some((n) => n.includes("supplementary")));
});
