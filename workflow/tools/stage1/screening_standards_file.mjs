/**
 * Stage 1 compatibility facade for screening standards APIs.
 * Ownership lives in the smaller path/docx/rewrite/manual-evaluation modules.
 */

export {
  SCREENING_STANDARDS_FILE_NAME,
  SCREENING_STANDARDS_DOCX_FILE_NAME,
  SCREENING_STANDARDS_LAST_SYNCED_FILE_NAME,
  SCREENING_STANDARDS_BEFORE_LLM_REFINE_BACKUP_FILE_NAME,
  SCREENING_STANDARDS_SOURCE_NAME,
  INITIAL_SCREENING_STANDARDS_ZH,
  screeningStandardsPath,
  screeningStandardsDocxPath,
  ruleSuggestionsLogPath,
  screeningStandardsLastSyncedPath,
  cleanScreeningStandardsMarkdown,
  ensureScreeningStandardsFile,
  readScreeningStandardsFile,
  readScreeningStandardsFileSync,
} from "../lib/screening_standards_paths.mjs";

export {
  parseScreeningStandardsDocx,
  processUserSuggestionDecisions,
  syncScreeningStandardsDocx,
  buildScreeningStandardsSyncPlan,
} from "./screening_standards_docx.mjs";

export { applyScreeningStandardsDocxRewrite } from "./screening_standards_rewrite.mjs";

export {
  applyScreeningStandardsLearningUpdate,
  processManualStandardEvaluation,
} from "./manual_standard_evaluation.mjs";

export {
  buildScreeningStandardsPendingRewritePlan,
  buildScreeningStandardsPendingRewriteReport,
  collectScreeningStandardsRewriteSuggestions,
  normalizeSuggestionStatus,
  shouldTriggerScreeningStandardsRewrite,
} from "../lib/screening_standards_rewrite_plan.mjs";

export {
  buildChineseScreeningRulesRewritePrompt,
  buildScreeningStandardsRewritePrompt,
  checkScreeningRulesChineseLanguage,
  parseScreeningStandardsRewriteResult,
  rewriteCoverageIds,
  rewriteDispositionMissingReason,
} from "../lib/screening_standards_rewrite_result.mjs";

export {
  generateRuleSuggestionsFromFeedback,
  loadRuleSuggestionsLog,
  normalizeRuleForDedup,
  syncSuggestionsToScreeningStandardsMd,
  writeRuleSuggestionsLog,
} from "../lib/screening_standards_rule_suggestions.mjs";
