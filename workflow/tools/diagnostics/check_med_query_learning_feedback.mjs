import path from "node:path";
import { pathToFileURL } from "node:url";
import { runFeedbackLearningDiagnostic } from "../lib/feedback_learning_support.mjs";
import { buildRuntimeConfig } from "../lib/runtime_config.mjs";

const RUNTIME = buildRuntimeConfig();
const ROOT = RUNTIME.projectRoot || path.resolve(".");
const RESEARCH_ROOT = RUNTIME.researchRoot;
const REVIEW_ROOT = RUNTIME.reviewRoot;
const DESKTOP_REVIEW_ROOT = RUNTIME.legacyDesktopReviewRoot;

export function main() {
  const report = runFeedbackLearningDiagnostic(new Date(), {
    reviewRoot: REVIEW_ROOT,
    desktopRoot: DESKTOP_REVIEW_ROOT,
    projectRoot: ROOT,
    researchRoot: RESEARCH_ROOT,
  });

  console.log(JSON.stringify({
    ok: Boolean(report.ok),
    selected_previous_feedback_file: report.selected_feedback_file || null,
    workbook_read_method: report.workbook_read_method || "node_xlsx",
    python_read_attempted: false,
    python_read_failed: false,
    workbook_unreadable: Boolean(report.workbook_unreadable),
    detected_headers: report.sheet?.headers || [],
    feedback_column_detected: Boolean(report.columns?.feedback),
    comment_column_detected: Boolean(report.columns?.comment),
    rows_total: Number(report.counts?.total_rows || 0),
    rows_with_feedback: Number(report.counts?.rows_with_feedback || 0),
    rows_with_comment: Number(report.counts?.rows_with_comment || 0),
    positive_samples: Number(report.preference_learning?.positive_samples || 0),
    negative_samples: Number(report.preference_learning?.negative_samples || 0),
    ambiguous_samples: Number(report.preference_learning?.ambiguous_samples || 0),
    ignored_samples: Number(report.preference_learning?.ignored_samples || 0),
    blockers: Array.isArray(report.preference_learning?.blockers) ? report.preference_learning.blockers : [],
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
