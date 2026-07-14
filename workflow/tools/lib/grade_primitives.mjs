import { loadWorkflowRules } from "./literature_config.mjs";

const WORKFLOW_RULES = loadWorkflowRules().config;
const TRIAGE_RULES = WORKFLOW_RULES.triage || {};

export const LABELS = {
  A: TRIAGE_RULES.labels?.A || "A课题相关",
  B: TRIAGE_RULES.labels?.B || "B专题相关",
  C: TRIAGE_RULES.labels?.C || "C领域相关",
  D: TRIAGE_RULES.labels?.D || "D无关",
};

export const SOURCE_LABELS = {
  rss: TRIAGE_RULES.source_labels?.rss || "RSS",
  pubmed: TRIAGE_RULES.source_labels?.pubmed || "PubMed",
  pmc: TRIAGE_RULES.source_labels?.pmc || "PMC",
  other: TRIAGE_RULES.source_labels?.other || "other",
};

export const TRIAGE_VERSION = TRIAGE_RULES.version || "2026-05-28-v2-workflow-based";

export function summarizeGradeCounts(items = []) {
  const grade_counts = { A: 0, B: 0, C: 0, D: 0 };
  let uncertain_count = 0;
  for (const item of items) {
    if (item?.grade && grade_counts[item.grade] !== undefined) {
      grade_counts[item.grade] += 1;
    }
    if (item?.flags?.uncertain) uncertain_count += 1;
  }
  return {
    grade_counts,
    uncertain_count,
    writeback_candidate_count: grade_counts.A + grade_counts.B + grade_counts.C,
    skipped_d_count: grade_counts.D,
  };
}

export function normalizeGradeLetter(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (/^[ABCD]$/.test(raw)) return raw;
  const m = raw.match(/^[ABCD]/);
  return m ? m[0] : "";
}
