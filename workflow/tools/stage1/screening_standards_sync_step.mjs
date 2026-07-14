import { buildScreeningStandardsSyncPlan } from "./screening_standards_file.mjs";

/**
 * Run the screening standards sync step.
 * @param {Object} params
 * @param {Object} params.ruleSuggestionsReport - Rule suggestions report from previous step
 * @param {Object} params.manualStandardEvaluation - Manual standard evaluation from report
 * @param {Object} params.medQueryLearning - Med query learning from report.steps
 * @param {Object} params.preferenceLearningInputs - Preference learning inputs (optional)
 * @returns {Object} screeningStandardsSyncSummary
 */
export function runScreeningStandardsSyncStep({
  ruleSuggestionsReport,
  manualStandardEvaluation,
  medQueryLearning,
  preferenceLearningInputs,
}) {
  const manualEvaluationAudit = manualStandardEvaluation || {};
  const manualEvaluationConsumed = Boolean(
    manualEvaluationAudit.evaluation_processed
      || manualEvaluationAudit.evaluation_cleared
      || String(manualEvaluationAudit.evaluation_text_excerpt || "").trim(),
  );

  const screeningStandardsSyncSummary = buildScreeningStandardsSyncPlan({
    syncSteps: [
      {
        name: "manual_standard_evaluation",
        purpose: "read_docx_evaluation_area_for_manual_feedback",
        attempted: false,
        docxBackupExpected: false,
      },
      {
        name: "feedback_learning_docx_sync",
        purpose: "sync_screening_standards_md_to_docx",
        attempted: Boolean(medQueryLearning?.screening_standards_docx_synced),
        docxBackupExpected: Boolean(medQueryLearning?.screening_standards_docx_synced),
      },
      {
        name: "rule_suggestions_docx_sync",
        purpose: "refresh_pending_suggestions_and_clear_evaluation_area",
        attempted: Boolean(ruleSuggestionsReport.docx_format_sync_applied),
        docxBackupExpected: Boolean(ruleSuggestionsReport.docx_format_sync_applied),
      },
    ],
    evaluationTextConsumed: manualEvaluationConsumed,
    evaluationTextCleared: Boolean(ruleSuggestionsReport.manual_evaluation_cleared),
    clearedReason: ruleSuggestionsReport.manual_evaluation_clear_reason,
    preferenceLearningInputsBuilt: Boolean(preferenceLearningInputs?.summary),
    notes: [
      manualEvaluationConsumed ? "manual_evaluation_area_consumed_before_clear_sync" : "no_manual_evaluation_input_consumed",
      "feedback_learning_sync_preserves_existing_evaluation_text",
      ruleSuggestionsReport.docx_format_sync_applied ? "rule_suggestions_sync_passes_empty_evaluation_text_to_clear_consumed_area" : "",
      "docx_backup_is_owned_by_syncScreeningStandardsDocx_when_existing_docx_is_overwritten",
    ],
  });

  return screeningStandardsSyncSummary;
}
