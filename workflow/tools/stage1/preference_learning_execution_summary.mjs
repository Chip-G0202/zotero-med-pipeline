/**
 * Preference learning execution summary builder — pure function.
 *
 * Constructs a focused, auditable summary of the LLM preference learning
 * execution: whether it was triggered, how many feedback rows were processed,
 * success/failure/skip outcomes, degradation status, and audit write diagnostics.
 * Does not embed feedback row texts, prompts, responses, or API keys.
 *
 * All inputs must be supplied by the caller. This function does NOT:
 *   - read or write files
 *   - access the network
 *   - call LLM or MCP services
 *   - depend on process.env
 */

/**
 * @param {Object} params
 * @param {number} [params.inputRowsCount=0]
 * @param {boolean} [params.enabled=false]
 * @param {boolean} [params.triggered=false]
 * @param {number} [params.processedRowsCount=0]
 * @param {number} [params.succeededCount=0]
 * @param {number} [params.failedCount=0]
 * @param {string|null} [params.skippedReason=null]
 * @param {Object[]} [params.failureReasons=[]]
 * @param {boolean} [params.degraded=false]
 * @param {number} [params.resultItemsCount=0]
 * @param {boolean} [params.auditWritePlanned=false]
 * @param {boolean} [params.auditWriteAttempted=false]
 * @param {boolean} [params.auditWriteSucceeded=false]
 * @param {string} [params.initialAuditPath=""]
 * @param {string} [params.auditPath=""]
 * @param {boolean} [params.auditOverwriteRisk=false]
 * @returns {Object} execution summary
 */
export function buildPreferenceLearningExecutionSummary({
  inputRowsCount = 0,
  enabled = false,
  triggered = false,
  processedRowsCount = 0,
  succeededCount = 0,
  failedCount = 0,
  skippedReason = null,
  failureReasons = [],
  degraded = false,
  resultItemsCount = 0,
  auditWritePlanned = false,
  auditWriteAttempted = false,
  auditWriteSucceeded = false,
  initialAuditPath = "",
  auditPath = "",
  auditOverwriteRisk = false,
} = {}) {
  const safeFailureReasons = (Array.isArray(failureReasons) ? failureReasons : []).map((entry) => {
    if (typeof entry === "string") return { reason: entry };
    return {
      reason: String(entry?.reason || entry?.message || "unknown"),
      source: String(entry?.source || ""),
    };
  });

  const derivedSkippedReason = skippedReason
    || (triggered ? null : inputRowsCount === 0 ? "no_supported_feedback_rows" : "disabled");

  const notes = [
    "preference_learning_execution_summary does not embed feedback rows, prompts, responses, or API keys",
    "existing report.steps.med_query_learning and report.steps.llm_preference_learning fields are preserved unchanged",
    "this summary is a supplementary audit layer and does not alter data flow",

    ].filter(Boolean);

  return {
    input_rows_count: inputRowsCount,
    enabled,
    triggered,
    processed_rows_count: processedRowsCount,
    succeeded_count: succeededCount,
    failed_count: failedCount,
    degraded,
    skipped_reason: derivedSkippedReason,
    failure_reasons: safeFailureReasons.slice(0, 20),
    result_items_count: resultItemsCount,
    audit_write_planned: auditWritePlanned,
    audit_write_attempted: auditWriteAttempted,
    audit_write_succeeded: auditWriteSucceeded,
    audit_paths: [initialAuditPath, auditPath  ].filter(Boolean),
    initial_audit_path: initialAuditPath,
    audit_path: auditPath,
    audit_overwrite_risk: auditOverwriteRisk,
    notes,
  };
}
