import assert from "node:assert/strict";
import test from "node:test";
import { buildPreferenceLearningExecutionSummary } from "../tools/stage1/preference_learning_execution_summary.mjs";

test("no feedback rows — skipped", () => {
  const summary = buildPreferenceLearningExecutionSummary({
    inputRowsCount: 0,
    enabled: true,
    triggered: false,
  });
  assert.equal(summary.input_rows_count, 0);
  assert.equal(summary.triggered, false);
  assert.equal(summary.skipped_reason, "no_supported_feedback_rows");
  assert.equal(summary.processed_rows_count, 0);
  assert.equal(summary.degraded, false);
});

test("preference learning success", () => {
  const summary = buildPreferenceLearningExecutionSummary({
    inputRowsCount: 10,
    enabled: true,
    triggered: true,
    processedRowsCount: 10,
    succeededCount: 8,
    resultItemsCount: 8,
  });
  assert.equal(summary.triggered, true);
  assert.equal(summary.processed_rows_count, 10);
  assert.equal(summary.succeeded_count, 8);
  assert.equal(summary.result_items_count, 8);
  assert.equal(summary.degraded, false);
  assert.equal(summary.skipped_reason, null);
});

test("disabled / missing config", () => {
  const summary = buildPreferenceLearningExecutionSummary({
    inputRowsCount: 5,
    enabled: false,
    triggered: false,
    skippedReason: "disabled",
  });
  assert.equal(summary.enabled, false);
  assert.equal(summary.skipped_reason, "disabled");
  assert.equal(summary.processed_rows_count, 0);
});

test("failure degraded", () => {
  const summary = buildPreferenceLearningExecutionSummary({
    inputRowsCount: 8,
    enabled: true,
    triggered: true,
    processedRowsCount: 8,
    succeededCount: 3,
    failedCount: 2,
    degraded: true,
    failureReasons: [
      { reason: "llm_timeout", source: "batch_2" },
    ],
  });
  assert.equal(summary.triggered, true);
  assert.equal(summary.degraded, true);
  assert.equal(summary.failed_count, 2);
  assert.equal(summary.failure_reasons.length, 1);
});

test("audit diagnostics — overwrite risk resolved, both paths present", () => {
  const summary = buildPreferenceLearningExecutionSummary({
    auditWritePlanned: true,
    auditWriteAttempted: true,
    auditWriteSucceeded: true,
    initialAuditPath: "/runs/preference_learning_initial_audit.json",
    auditPath: "/runs/preference_learning_audit.json",
    auditOverwriteRisk: false,
  });
  assert.equal(summary.audit_write_planned, true);
  assert.equal(summary.audit_write_attempted, true);
  assert.equal(summary.audit_write_succeeded, true);
  assert.equal(summary.audit_overwrite_risk, false);
  assert.equal(summary.initial_audit_path, "/runs/preference_learning_initial_audit.json");
  assert.equal(summary.audit_path, "/runs/preference_learning_audit.json");
  assert.equal(summary.audit_paths.length, 2);
  assert.ok(summary.audit_paths.includes("/runs/preference_learning_initial_audit.json"));
  assert.ok(summary.audit_paths.includes("/runs/preference_learning_audit.json"));
});

test("empty inputs", () => {
  const summary = buildPreferenceLearningExecutionSummary({});
  assert.equal(summary.input_rows_count, 0);
  assert.equal(summary.triggered, false);
  assert.equal(summary.degraded, false);
  assert.equal(summary.audit_overwrite_risk, false);
});

test("does not modify its inputs", () => {
  const input = { inputRowsCount: 3, triggered: true };
  const frozen = JSON.parse(JSON.stringify(input));
  buildPreferenceLearningExecutionSummary(input);
  assert.deepEqual(input, frozen);
});
