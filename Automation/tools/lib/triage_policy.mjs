/**
 * Triage Policy - Compatibility Re-export Module
 * 
 * This module now re-exports from workflow_classifier.mjs for backward compatibility.
 * All grading logic is now based on workflow_rules.json via workflow_classifier.mjs.
 * 
 * @deprecated Use workflow_classifier.mjs directly for new code.
 */

export {
  LABELS,
  SOURCE_LABELS,
  TRIAGE_VERSION,
  classifyItem,
  buildDedupeKey,
  summarizeGradeCounts,
  normalizeGradeLetter,
  buildFeedbackIndex,
  deriveSemanticGradeFromFeedbackMatches,
  deriveSemanticGradeFromStandards,
  synthesizeFinalGrade,
  parseScreeningStandards,
  loadScreeningStandards,
} from "./workflow_classifier.mjs";
