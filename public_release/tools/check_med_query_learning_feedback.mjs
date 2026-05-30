import path from "node:path";
import { runFeedbackLearningDiagnostic } from "./lib/feedback_learning_support.mjs";

const ROOT = process.env.ZOTERO_PROJECT_ROOT || path.resolve(".");
const RESEARCH_ROOT = path.join(ROOT, "research_os");
const REVIEW_ROOT = path.join(RESEARCH_ROOT, "文献评价");
const DESKTOP_REVIEW_ROOT = process.env.DESKTOP_REVIEW_ROOT || path.join(ROOT, "research_os", "文献评价");

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
