import fs from "node:fs";
import path from "node:path";
import { buildDocxBuffer } from "../lib/screening_standards_docx_support.mjs";
import { SCREENING_STANDARDS_BEFORE_LLM_REFINE_BACKUP_FILE_NAME } from "../lib/screening_standards_paths.mjs";
import { buildDocxParts, parseScreeningStandardsDocx } from "./screening_standards_docx.mjs";
import {
  shouldTriggerScreeningStandardsRewrite,
  suggestionObjectsFromTable,
} from "../lib/screening_standards_rewrite_plan.mjs";
import {
  buildChineseScreeningRulesRewritePrompt,
  checkScreeningRulesChineseLanguage,
  parseScreeningStandardsRewriteResult,
  rewriteCoverageIds,
  rewriteDispositionMissingReason,
} from "../lib/screening_standards_rewrite_result.mjs";

export async function applyScreeningStandardsDocxRewrite({
  docxPath,
  mdPath,
  backupPath = "",
  rewriteResult = {},
  suggestions = null,
  chineseRewriteClient = null,
} = {}) {
  const report = {
    mode: "apply_to_docx",
    applied: false,
    partial_failure: false,
    docx_path: docxPath || "",
    md_path: mdPath || "",
    backup_path: backupPath || "",
    consumed_suggestion_ids: [],
    unapplied_suggestions: [],
    blockers: [],
    semantic_risk_level: String(rewriteResult.semantic_risk_level || "low").toLowerCase(),
    restored_docx_from_backup: false,
    rules_language_check: null,
    chinese_rewrite_retry_attempted: false,
    chinese_rewrite_retry_error: "",
  };
  if (!docxPath || !mdPath) {
    report.blockers.push("missing_docx_or_md_path");
    return report;
  }

  let parsed;
  try {
    parsed = await parseScreeningStandardsDocx(docxPath);
  } catch (error) {
    report.blockers.push("docx_unreadable");
    report.error = String(error?.message || error);
    return report;
  }

  const allSuggestions = Array.isArray(suggestions) ? suggestions : suggestionObjectsFromTable(parsed.suggestions_table);
  const applicableSuggestions = allSuggestions.filter((suggestion) => shouldTriggerScreeningStandardsRewrite(suggestion));
  if (!applicableSuggestions.length) {
    report.blockers.push("no_applicable_suggestions");
    return report;
  }

  const coverageIds = rewriteCoverageIds(rewriteResult);
  const missingCoverage = applicableSuggestions.filter((suggestion) => !coverageIds.has(String(suggestion.suggestion_id || "").trim()));
  if (missingCoverage.length) {
    report.blockers.push("suggestion_coverage_incomplete");
    report.unapplied_suggestions = missingCoverage.map((suggestion) => suggestion.suggestion_id || suggestion.suggested_rule || "");
    return report;
  }
  if (report.semantic_risk_level === "high") {
    report.blockers.push("semantic_risk_high");
    return report;
  }
  if (!String(rewriteResult.updated_rules_text || "").trim()) {
    report.blockers.push("updated_rules_text_missing");
    return report;
  }
  if (rewriteDispositionMissingReason(rewriteResult.deleted_rules) || rewriteDispositionMissingReason(rewriteResult.modified_rules)) {
    report.blockers.push("rule_disposition_reason_missing");
    return report;
  }

  let effectiveRewriteResult = rewriteResult;
  report.rules_language_check = checkScreeningRulesChineseLanguage(effectiveRewriteResult.updated_rules_text);
  if (!report.rules_language_check.ok) {
    if (typeof chineseRewriteClient !== "function") {
      report.blockers.push("rules_language_violation");
      return report;
    }
    report.chinese_rewrite_retry_attempted = true;
    try {
      const retryRaw = await chineseRewriteClient({
        rewriteResult: effectiveRewriteResult,
        languageCheck: report.rules_language_check,
        prompt: buildChineseScreeningRulesRewritePrompt(effectiveRewriteResult, report.rules_language_check),
      });
      effectiveRewriteResult = parseScreeningStandardsRewriteResult(retryRaw, { applicableSuggestions });
      report.rules_language_check = checkScreeningRulesChineseLanguage(effectiveRewriteResult.updated_rules_text);
    } catch (error) {
      report.blockers.push("rules_language_violation");
      report.chinese_rewrite_retry_error = String(error?.message || error);
      return report;
    }
  }

  report.consumed_suggestion_ids = applicableSuggestions.map((suggestion) => suggestion.suggestion_id).filter(Boolean);
  report.backup_path = backupPath || path.join(path.dirname(docxPath), SCREENING_STANDARDS_BEFORE_LLM_REFINE_BACKUP_FILE_NAME);
  try {
    await fs.promises.copyFile(docxPath, report.backup_path);
    const updatedRulesText = String(effectiveRewriteResult.updated_rules_text || "").trim();
    const parts = buildDocxParts({
      previousText: updatedRulesText,
      currentText: updatedRulesText,
      keywordGroups: parsed.keyword_state,
      evaluationText: parsed.evaluation_text,
      suggestions: allSuggestions,
    });
    await fs.promises.writeFile(docxPath, buildDocxBuffer(parts, { unknownBlocks: parsed.unknown_blocks || [] }));
    const updatedParsed = await parseScreeningStandardsDocx(docxPath);
    await fs.promises.writeFile(mdPath, `${updatedParsed.rules_text.trim()}\n`, "utf8");
    report.applied = true;
    report.rules_reused = effectiveRewriteResult.reused_rules || [];
    report.rules_merged = effectiveRewriteResult.merged_rules || [];
    report.rules_modified = effectiveRewriteResult.modified_rules || [];
    report.rules_deleted = effectiveRewriteResult.deleted_rules || [];
    report.rules_created = effectiveRewriteResult.created_rules || [];
    report.semantic_risk_reasons = effectiveRewriteResult.semantic_risk_reasons || [];
    report.md_synced_from_docx = true;
    return report;
  } catch (error) {
    report.partial_failure = true;
    report.error = String(error?.message || error);
    try {
      if (report.backup_path && fs.existsSync(report.backup_path)) {
        await fs.promises.copyFile(report.backup_path, docxPath);
        report.restored_docx_from_backup = true;
      }
    } catch (restoreError) {
      report.restore_error = String(restoreError?.message || restoreError);
    }
    return report;
  }
}
