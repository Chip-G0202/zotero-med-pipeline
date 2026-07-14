import fs from "node:fs/promises";
import path from "node:path";
import {
  generateRuleSuggestionsFromFeedback,
  loadRuleSuggestionsLog,
  writeRuleSuggestionsLog,
  ruleSuggestionsLogPath,
  readScreeningStandardsFile,
  syncScreeningStandardsDocx,
} from "./screening_standards_file.mjs";
import { loadScreeningStandards } from "./screening_standards_parser.mjs";

/**
 * Run the rule suggestion generation step.
 * @param {Object} params
 * @param {string} params.reviewRoot - Path to review root (文献评价)
 * @param {string} params.root - Project root path
 * @param {string} params.pipeDir - Path to pipeline directory
 * @param {string} params.startedAt - ISO timestamp of when the run started
 * @param {Object} params.feedbackLearning - Feedback learning diagnostics from report
 * @param {Object} params.manualStandardEvaluation - Manual standard evaluation from report
 * @returns {Promise<Object>} ruleSuggestionsReport
 */
export async function runRuleSuggestionStep({
  reviewRoot,
  root,
  pipeDir,
  startedAt,
  feedbackLearning,
  manualStandardEvaluation,
}) {
  const suggestionsLogPath = ruleSuggestionsLogPath(reviewRoot);
  let ruleSuggestionsReport = {
    standards_rule_suggestions_count: 0,
    standards_rule_suggestions_pending_count: 0,
    standards_rule_suggestions_accepted_count: 0,
    standards_rule_suggestions_revised_count: 0,
    standards_rule_suggestions_rejected_count: 0,
    skipped_duplicate_rule_suggestions_count: 0,
    docx_rule_suggestions_table_updated: false,
    docx_dropdown_supported: false,
    docx_dropdown_fallback_reason: "handcrafted_openxml_no_sdt_support",
    docx_format_sync_applied: false,
    manual_evaluation_cleared: false,
    manual_evaluation_clear_reason: "",
    docx_format_unsupported_features: ["sdt_dropdown", "read_time_format", "highlight"],
  };

  try {
    const feedbackSignals = feedbackLearning?.signals || [];
    const feedbackSource = feedbackLearning?.path || "";
    const existingSuggestionsLog = await loadRuleSuggestionsLog(suggestionsLogPath);
    const screeningStandardsParsed = loadScreeningStandards(reviewRoot);
    const standardsContent = screeningStandardsParsed?.content || (await readScreeningStandardsFile(reviewRoot)).content;

    const { suggestions: newSuggestions } = generateRuleSuggestionsFromFeedback({
      feedbackSignals,
      feedbackSource,
      standardsContent,
      screeningStandards: screeningStandardsParsed,
      existingSuggestionsLog,
      generatedAt: startedAt,
    });

    const dedupedNewSuggestions = newSuggestions.filter((s) => {
      const hash = s.suggestion_hash;
      return !existingSuggestionsLog.suggestions.some((existing) => existing.suggestion_hash === hash);
    });

    for (const s of dedupedNewSuggestions) existingSuggestionsLog.suggestions.push(s);
    await writeRuleSuggestionsLog(suggestionsLogPath, existingSuggestionsLog);

    // Sync docx again to include newly generated suggestions in the Pending Rule Suggestions table
    const pubmedConfigPathForSync = path.join(root, "config", "pubmed_pmc_search.json");
    await syncScreeningStandardsDocx(reviewRoot, {
      pubmedConfigPath: pubmedConfigPathForSync,
      evaluationText: "",
      suggestionsLogPath,
    });

    const allSuggestions = existingSuggestionsLog.suggestions;
    ruleSuggestionsReport.standards_rule_suggestions_count = allSuggestions.length;
    ruleSuggestionsReport.standards_rule_suggestions_pending_count = allSuggestions.filter((s) => s.status === "pending").length;
    ruleSuggestionsReport.standards_rule_suggestions_accepted_count = allSuggestions.filter((s) => s.status === "accepted").length;
    ruleSuggestionsReport.standards_rule_suggestions_revised_count = allSuggestions.filter((s) => s.status === "revised").length;
    ruleSuggestionsReport.standards_rule_suggestions_rejected_count = allSuggestions.filter((s) => s.status === "rejected").length;
    ruleSuggestionsReport.skipped_duplicate_rule_suggestions_count = newSuggestions.length - dedupedNewSuggestions.length;
    ruleSuggestionsReport.docx_rule_suggestions_table_updated = allSuggestions.length > 0;
    ruleSuggestionsReport.docx_format_sync_applied = true;

    const evalAudit = manualStandardEvaluation || {};
    ruleSuggestionsReport.manual_evaluation_cleared = Boolean(evalAudit.evaluation_cleared);
    ruleSuggestionsReport.manual_evaluation_clear_reason = evalAudit.evaluation_cleared
      ? "evaluation_processed_and_cleared"
      : evalAudit.blockers?.length ? `blockers: ${evalAudit.blockers.join(",")}` : "no_evaluation_input";

    await fs.writeFile(path.join(pipeDir, "standards_rule_suggestions.json"), JSON.stringify({
      suggestions: allSuggestions,
      new_suggestions: dedupedNewSuggestions,
      log_path: suggestionsLogPath,
      generated_at: startedAt,
    }, null, 2), "utf8");
  } catch (err) {
    ruleSuggestionsReport.suggestions_error = String(err?.message || err);
  }

  return ruleSuggestionsReport;
}
