import fs from "node:fs";
import { readPreviousFeedbackWorkbook } from "./review_workbook_reader.mjs";
import { readScreeningStandardsFileSync } from "./screening_standards_file.mjs";

function tokenize(text) {
  const v = String(text || "");
  const en = v.toLowerCase().match(/[a-z]{4,}/g) || [];
  const zh = v.match(/[\u4e00-\u9fff]{2,8}/g) || [];
  return [...en, ...zh];
}

export function runFeedbackLearningDiagnostic(now, { reviewRoot, desktopRoot, projectRoot, researchRoot, writeReportPath = null, lookbackDays = 7 } = {}) {
  const reader = readPreviousFeedbackWorkbook(now, { reviewRoot, desktopRoot, projectRoot, researchRoot, lookbackDays });
  let screeningStandards;
  try {
    screeningStandards = readScreeningStandardsFileSync(reviewRoot);
  } catch (err) {
    screeningStandards = {
      path: "",
      loaded: false,
      created: false,
      cleaned: false,
      content: "",
      source_name: "screening_standards_md",
      error: String(err?.message || err),
    };
  }
  const result = {
    ok: reader.ok,
    timestamp: new Date().toISOString(),
    feedback_review_root: reviewRoot,
    desktop_review_root: desktopRoot,
    project_review_root: `${projectRoot}/文献评价`,
    candidate_feedback_files: reader.lookup_paths,
    selected_feedback_file: reader.selected_previous_feedback_file,
    selected_feedback_file_source: reader.selected_feedback_file_source,
    selected_feedback_file_exists: Boolean(reader.selected_previous_feedback_file && fs.existsSync(reader.selected_previous_feedback_file)),
    fallback_reason: "",
    workbook_read_method: reader.workbook_read_method,
    python_read_attempted: false,
    python_read_failed: false,
    workbook_unreadable: reader.workbook_unreadable,
    sheet: { name: reader.sheet_name, headers: reader.detected_headers, header_map: {} },
    summary_feedback: reader.summary_feedback,
    screening_standards: {
      path: screeningStandards.path,
      loaded: Boolean(screeningStandards.loaded),
      created: Boolean(screeningStandards.created),
      cleaned: Boolean(screeningStandards.cleaned),
      source_name: screeningStandards.source_name,
      content_length: String(screeningStandards.content || "").length,
      error: screeningStandards.error || "",
      primary_rationale_source: Boolean(screeningStandards.loaded),
    },
    columns: reader.columns,
    counts: { ...reader.counts, total_rows: reader.counts.rows_total, rows_missing_title: 0, rows_missing_title_translation: 0 },
    samples_preview: [],
    preference_learning: { would_update_preference: false, positive_samples: 0, negative_samples: 0, ambiguous_samples: 0, ignored_samples: 0, blockers: [...reader.blockers] },
    recommendations: [],
    learning_payload: { rows_used: 0, hardPositiveTerms: [], hardNegativeTerms: [], signals: [], meta_preference_signals: [], screening_standards: screeningStandards },
  };
  if (reader.workbook_unreadable) {
    if (!result.preference_learning.blockers.includes("workbook_unreadable")) result.preference_learning.blockers.push("workbook_unreadable");
  } else {
    if (reader.detected_headers.length && !reader.columns.feedback && !result.preference_learning.blockers.includes("required_feedback_columns_missing")) {
      result.preference_learning.blockers.push("required_feedback_columns_missing");
    }
    const pos = {};
    const neg = {};
    for (const s of reader.learning_signals) {
      if (s.feedback === "keep" || s.feedback === "upgrade") result.preference_learning.positive_samples += 1;
      else if (s.feedback === "drop" || s.feedback === "downgrade") result.preference_learning.negative_samples += 1;
      else result.preference_learning.ambiguous_samples += 1;
      if (!s.feedback) result.preference_learning.ignored_samples += 1;
      if (s.title_translation_missing) result.counts.rows_missing_title_translation += 1;
      if (!s.english_title && !s.title_translation) result.counts.rows_missing_title += 1;
      if (s.feedback === "keep" || s.feedback === "upgrade") {
        for (const t of tokenize(`${s.title_context} ${s.english_title} ${s.comment}`)) pos[t] = (pos[t] || 0) + 1;
      }
      if (s.feedback === "drop" || s.feedback === "downgrade") {
        for (const t of tokenize(`${s.title_context} ${s.english_title} ${s.comment}`)) neg[t] = (neg[t] || 0) + 1;
      }
    }
    result.learning_payload.signals = reader.learning_signals;
    result.learning_payload.meta_preference_signals = Array.isArray(reader.summary_feedback?.rows) ? reader.summary_feedback.rows : [];
    result.learning_payload.rows_used = result.preference_learning.positive_samples + result.preference_learning.negative_samples;
    result.learning_payload.hardPositiveTerms = Object.entries(pos).filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k]) => k);
    result.learning_payload.hardNegativeTerms = Object.entries(neg).filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k]) => k);
    result.preference_learning.would_update_preference = result.learning_payload.rows_used > 0 && !result.preference_learning.blockers.includes("required_feedback_columns_missing") && !result.preference_learning.blockers.includes("workbook_unreadable");
    if (!result.preference_learning.would_update_preference && result.learning_payload.rows_used === 0 && !result.preference_learning.blockers.includes("no_supported_feedback_rows")) {
      result.preference_learning.blockers.push("no_supported_feedback_rows");
    }
  }
  result.standard_summary_feedback = {
    sheet_present: Boolean(reader.summary_feedback?.sheet_present),
    schema: reader.summary_feedback?.schema || "",
    rows: Number(reader.summary_feedback?.feedback_rows || 0),
    warnings: Array.isArray(reader.summary_feedback?.warnings) ? reader.summary_feedback.warnings : [],
    used: Array.isArray(result.learning_payload.meta_preference_signals) && result.learning_payload.meta_preference_signals.length > 0,
  };
  result.samples_preview = reader.rows.slice(0, 20).map((r) => ({ row_index: r.row, feedback: r.feedback, comment_present: Boolean(r.comment), english_title_present: Boolean(r.english_title), title_translation_present: Boolean(r.title_translation) }));
  if (writeReportPath) fs.writeFileSync(writeReportPath, JSON.stringify(result, null, 2), "utf8");
  return result;
}
