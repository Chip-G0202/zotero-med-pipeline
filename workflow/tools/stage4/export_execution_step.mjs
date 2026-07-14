import {
  EXPORT_METHODS,
  EXPORT_FALLBACK_CHAIN,
  detectCodexSpreadsheetAvailability,
  exportAllResearchOsXlsxWithCodexSpreadsheet,
  detectNodeFallbackAvailability,
  exportAllResearchOsXlsxWithNodeFallback,
} from "./spreadsheet_adapter.mjs";
import { REVIEW_WORKBOOK_FILE_NAME } from "../lib/report_period_support.mjs";

export async function runStage4WorkbookExport({
  paths,
  labels,
  source,
} = {}) {
  const spreadsheetAvailability = await detectCodexSpreadsheetAvailability();
  const nodeFallbackAvailability = await detectNodeFallbackAvailability();
  const fallbackChain = EXPORT_FALLBACK_CHAIN;
  const {
    runReport,
    writebackSummary,
    backfillReport,
    sourceFilterAudit,
    fallbackExportFields,
  } = source;

  let exportAudit;
  let terminalExportError = null;
  if (spreadsheetAvailability.available) {
    const res = await exportAllResearchOsXlsxWithCodexSpreadsheet({
      sourcePath: paths.sourcePath,
      reviewRootDir: paths.reviewRoot,
      reviewWeekDir: paths.reviewMonthDir,
      reviewDayDir: paths.reviewDayDir,
      dateStr: labels.dateStr,
      weekLabel: labels.reviewMonthLabel,
      dayLabel: labels.reviewDayLabel,
    });
    const sheets = Array.isArray(res.daily_workbook_sheets) ? res.daily_workbook_sheets : [];
    if (!sheets.includes("每日反馈")) {
      throw new Error("DAILY_FEEDBACK_SHEET_MISSING: expected '每日反馈' in workbook sheets, got: " + JSON.stringify(sheets));
    }
    exportAudit = {
      stage4_export_status: "success",
      export_method: EXPORT_METHODS.CODEX_SPREADSHEET,
      export_skill: "codex_spreadsheet",
      export_provider: "Spreadsheets",
      codex_spreadsheet_available: true,
      spreadsheets_plugin_available: true,
      export_root: paths.reviewRoot,
      requested_output_path: paths.requestedOutputPath,
      actual_output_path: res.outputs?.every_other_day_report || null,
      desktop_export_disabled: true,
      export_input_files: paths.exportInputFiles,
      export_rows_count: res.rows_count,
      source_filter: sourceFilterAudit,
      ...fallbackExportFields,
      export_excluded_d_count: Number(runReport?.counts?.d_skipped || res.excluded_d_count || 0),
      export_writeback_failures_count: Array.isArray(writebackSummary?.failures) ? writebackSummary.failures.length : 0,
      export_translation_failures_count: Number(backfillReport?.failure_count || 0),
      export_error: null,
      export_degraded: false,
      export_fallback_chain: fallbackChain,
      final_xlsx_outputs: [REVIEW_WORKBOOK_FILE_NAME],
      final_docx_outputs: [],
      monthly_docx_report_path: null,
      monthly_docx_report_generated: false,
      monthly_docx_data_source_note: "",
      export_generated_at: new Date().toISOString(),
      manual_required: false,
      export_outputs: {
        ...res.outputs,
      },
      daily_workbook_sheets: res.daily_workbook_sheets || ["每日反馈"],
      standard_summary_sheet_exported: Boolean(res.standard_summary_sheet_exported),
      standard_summary_sheet_name: res.standard_summary_sheet_name || "当前筛选标准摘要",
      standard_summary_sheet_schema: res.standard_summary_sheet_schema || "",
      standard_summary_generated: Boolean(res.standard_summary_generated),
      standard_summary_generated_from_fallback: Boolean(res.standard_summary_generated_from_fallback),
      standard_summary_unavailable: Boolean(res.standard_summary_unavailable),
      standard_summary_user_feedback_columns_present: Boolean(res.standard_summary_user_feedback_columns_present),
    };
  } else if (nodeFallbackAvailability.available) {
    const res = await exportAllResearchOsXlsxWithNodeFallback({
      sourcePath: paths.sourcePath,
      reviewRootDir: paths.reviewRoot,
      reviewWeekDir: paths.reviewMonthDir,
      reviewDayDir: paths.reviewDayDir,
      dateStr: labels.dateStr,
      weekLabel: labels.reviewMonthLabel,
      dayLabel: labels.reviewDayLabel,
    });
    const sheets = Array.isArray(res.daily_workbook_sheets) ? res.daily_workbook_sheets : [];
    if (!sheets.includes("每日反馈")) {
      throw new Error("DAILY_FEEDBACK_SHEET_MISSING: expected '每日反馈' in workbook sheets, got: " + JSON.stringify(sheets));
    }
    exportAudit = {
      stage4_export_status: "success",
      export_method: EXPORT_METHODS.NODE_FALLBACK,
      export_skill: "exceljs",
      export_provider: "exceljs",
      codex_spreadsheet_available: false,
      codex_spreadsheet_unavailable_reason: spreadsheetAvailability.reason,
      spreadsheets_plugin_available: false,
      spreadsheets_plugin_unavailable_reason: spreadsheetAvailability.reason,
      node_fallback_available: true,
      export_degraded: true,
      export_degrade_reason: "codex_spreadsheet_unavailable_using_node_fallback",
      export_root: paths.reviewRoot,
      requested_output_path: paths.requestedOutputPath,
      actual_output_path: res.outputs?.every_other_day_report || null,
      desktop_export_disabled: true,
      export_input_files: paths.exportInputFiles,
      export_rows_count: res.rows_count,
      source_filter: sourceFilterAudit,
      ...fallbackExportFields,
      export_excluded_d_count: Number(runReport?.counts?.d_skipped || res.excluded_d_count || 0),
      export_writeback_failures_count: Array.isArray(writebackSummary?.failures) ? writebackSummary.failures.length : 0,
      export_translation_failures_count: Number(backfillReport?.failure_count || 0),
      export_error: null,
      export_fallback_chain: fallbackChain,
      final_xlsx_outputs: [REVIEW_WORKBOOK_FILE_NAME],
      final_docx_outputs: [],
      monthly_docx_report_path: null,
      monthly_docx_report_generated: false,
      monthly_docx_data_source_note: "",
      export_generated_at: new Date().toISOString(),
      manual_required: false,
      export_outputs: {
        ...res.outputs,
      },
      daily_workbook_sheets: res.daily_workbook_sheets || ["每日反馈"],
      standard_summary_sheet_exported: false,
      standard_summary_sheet_name: "",
      standard_summary_sheet_schema: "",
      standard_summary_generated: false,
      standard_summary_generated_from_fallback: false,
      standard_summary_unavailable: true,
      standard_summary_user_feedback_columns_present: false,
    };
  } else {
    exportAudit = {
      stage4_export_status: "failed",
      export_method: EXPORT_METHODS.MANUAL_REQUIRED,
      export_skill: null,
      export_provider: null,
      codex_spreadsheet_available: false,
      codex_spreadsheet_unavailable_reason: spreadsheetAvailability.reason,
      spreadsheets_plugin_available: false,
      spreadsheets_plugin_unavailable_reason: spreadsheetAvailability.reason,
      node_fallback_available: false,
      node_fallback_unavailable_reason: nodeFallbackAvailability.reason,
      export_output_path: null,
      export_root: paths.reviewRoot,
      requested_output_path: paths.requestedOutputPath,
      actual_output_path: null,
      desktop_export_disabled: true,
      export_input_files: paths.exportInputFiles,
      export_rows_count: 0,
      source_filter: sourceFilterAudit,
      ...fallbackExportFields,
      export_excluded_d_count: Number(runReport?.counts?.d_skipped || 0),
      export_writeback_failures_count: Array.isArray(writebackSummary?.failures) ? writebackSummary.failures.length : 0,
      export_translation_failures_count: Number(backfillReport?.failure_count || 0),
      export_error: "Both codex_spreadsheet and node_fallback unavailable",
      export_degraded: true,
      export_degrade_reason: "all_export_methods_unavailable",
      export_fallback_chain: fallbackChain,
      final_xlsx_outputs: [REVIEW_WORKBOOK_FILE_NAME],
      final_docx_outputs: [],
      monthly_docx_report_path: null,
      monthly_docx_report_generated: false,
      monthly_docx_data_source_note: "",
      export_generated_at: new Date().toISOString(),
      manual_required: true,
      manual_steps: [
        "Ensure @oai/artifact-tool is available in Codex runtime, or install exceljs: npm install exceljs",
        "Rerun: node workflow/tools/stage4/main.mjs",
      ],
    };
    terminalExportError = new Error(`ALL_EXPORT_METHODS_UNAVAILABLE: codex_spreadsheet=${spreadsheetAvailability.reason} node_fallback=${nodeFallbackAvailability.reason}`);
  }

  return { exportAudit, terminalExportError };
}
