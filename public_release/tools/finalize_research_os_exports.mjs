import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildSkillAlignmentMatrix } from "./lib/research_os_exports.mjs";
import { buildFinalExportPayload } from "./lib/finalize_exports_support.mjs";
import {
  EXPORT_METHODS,
  detectSpreadsheetsSkillAvailability,
  exportAllResearchOsXlsxWithSpreadsheetsSkill,
} from "./lib/spreadsheet_adapter.mjs";
import { loadTranslationCache } from "./lib/title_translation_support.mjs";
import { buildRuntimeConfig } from "./lib/runtime_config.mjs";
import { buildBiweeklyReportPayload, generateBiweeklyDocxReport } from "./lib/biweekly_docx_report.mjs";

const RUNTIME = buildRuntimeConfig();
const ROOT = RUNTIME.projectRoot;
const RESEARCH_ROOT = RUNTIME.researchRoot;
const REVIEW_ROOT = RUNTIME.reviewRoot;
const DESKTOP_REVIEW_ROOT = RUNTIME.legacyDesktopReviewRoot;
const RUNTIME_STATE_PATH = path.join(RESEARCH_ROOT, "runtime_state.json");
const TODAY = RUNTIME.now;

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function yyMd(d) {
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
}
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
function weekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}
function weekLabel(d) {
  return `${String(d.getFullYear()).slice(2)} Week${weekNumber(d)}`;
}

function* recentPipelineDays(now) {
  for (let offset = 13; offset >= 0; offset--) {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() - offset);
    yield yyMd(d);
  }
}

async function collectRecentRunArtifacts(rootDir, now) {
  const artifacts = [];
  for (const day of recentPipelineDays(now)) {
    const filePath = path.join(rootDir, "pipeline", day, "run_report.json");
    try {
      const report = JSON.parse(await fs.readFile(filePath, "utf8"));
      artifacts.push({
        day,
        date: report?.date || report?.current_planned_slot_at || null,
        started_at: report?.started_at || report?.startedAt || null,
        finished_at: report?.finished_at || report?.finishedAt || null,
        status: report?.status || "unknown",
        failures: Array.isArray(report?.failures) ? report.failures : [],
        skip_reason: report?.skip_reason || report?.skipped_due_to_interval_reason || null,
        export_error: report?.steps?.stage4_export_audit?.export_error || null,
        export_outputs: report?.steps?.stage4_export_audit?.export_outputs || null,
      });
    } catch {}
  }
  return artifacts;
}

export async function finalizeResearchOsExports() {
  const stageStarted = Date.now();
  const dateStr = fmtDate(TODAY);
  const week = isoWeek(TODAY);
  const day = yyMd(TODAY);
  const pipelineDir = path.join(RESEARCH_ROOT, "pipeline", day);
  const reviewWeekDir = path.join(REVIEW_ROOT, weekLabel(TODAY));
  const reviewDayDir = path.join(REVIEW_ROOT, weekLabel(TODAY), day);

  const runReportPath = path.join(pipelineDir, "run_report.json");
  const writebackReadyPath = path.join(pipelineDir, "writeback_ready_items.json");
  const backfillPath = path.join(pipelineDir, "abc_translation_backfill.json");
  const sourcePath = path.join(pipelineDir, "desktop_daily_review_source.json");
  const writebackSummaryPath = path.join(pipelineDir, "mcp_writeback_summary.json");
  const preferenceAuditPath = path.join(pipelineDir, "preference_learning_audit.json");
  const requestedOutputPath = path.join(reviewDayDir, "隔日报.xlsx");

  const runReport = JSON.parse(await fs.readFile(runReportPath, "utf8"));
  const failures = Array.isArray(runReport?.failures) ? runReport.failures : [];
  const hasStage2Failure = failures.some((f) => String(f?.stage || "").includes("stage2") || String(f?.reason || "").includes("MCP_NOT_READY"));
  const hasStage3Failure = failures.some((f) => String(f?.stage || "").includes("stage3") || String(f?.reason || "").includes("MCP_NOT_READY"));
  if (hasStage2Failure || hasStage3Failure) {
    throw new Error(`UPSTREAM_STAGE_FAILED: stage2_failed=${hasStage2Failure} stage3_failed=${hasStage3Failure}`);
  }

  const writebackReady = JSON.parse(await fs.readFile(writebackReadyPath, "utf8"));
  const backfillReport = JSON.parse(await fs.readFile(backfillPath, "utf8"));
  const writebackSummary = JSON.parse(await fs.readFile(writebackSummaryPath, "utf8"));
  let preferenceLearningAudit = {};
  try {
    preferenceLearningAudit = JSON.parse(await fs.readFile(preferenceAuditPath, "utf8"));
  } catch {
    preferenceLearningAudit = {};
  }
  const translationCache = await loadTranslationCache(RUNTIME.translationCachePath);

  // Read Stage 1 output for full ABC item set (includes semantic grading fields)
  let allAbcItems = [];
  try {
    const stage1Source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
    if (Array.isArray(stage1Source?.triaged)) {
      allAbcItems = stage1Source.triaged.filter((it) => it && it.grade && it.grade !== "D");
    }
  } catch {
    // Stage 1 source not available; fall back below
  }

  // Conservative fallback: if desktop source is unexpectedly smaller than writeback-ready candidates,
  // prefer the broader candidate set so daily export is not under-counted.
  if (allAbcItems.length < writebackReady.length) {
    allAbcItems = writebackReady.filter((it) => it && it.grade && it.grade !== "D");
  }

  const finalPayload = buildFinalExportPayload({
    writebackReady,
    writebackSummary,
    backfillReport,
    translationCache,
    allAbcItems,
    reportContext: {
      triggerMode: runReport.triggerMode || runReport.trigger_mode || "",
      feedbackLearning: runReport.steps.feedback_learning,
      preferenceLearningAudit,
      connector: runReport.steps.connector,
      counts: runReport.counts,
      failures: runReport.failures,
      translation: runReport.steps.translation,
      skillAlignment: buildSkillAlignmentMatrix({
        feedbackLearning: runReport.steps.feedback_learning,
        dailyExport: {
          rssCount: runReport.counts.rss_raw,
          databaseCount: runReport.counts.db_raw,
          mergedCount: runReport.counts.merged,
          exportedCount: runReport.counts.daily_export,
          excludesD: true,
          translationFailuresTracked: true,
        },
        weeklyAssets: { updated: false },
        zoteroWriteback: { mcpOnly: true, tagCleanupUsesWriteTag: true, migrationTracked: true },
      }),
    },
  });

  await fs.mkdir(reviewDayDir, { recursive: true });
  await fs.writeFile(sourcePath, JSON.stringify({ date: dateStr, triaged: finalPayload.triaged, reportContext: finalPayload.reportContext }, null, 2), "utf8");

  const recentRunArtifacts = await collectRecentRunArtifacts(RESEARCH_ROOT, TODAY);
  const biweeklyPayload = buildBiweeklyReportPayload({
    now: TODAY,
    recentRuns: recentRunArtifacts,
    latestExportSummary: {
      status: "pending",
      summary: "stage4 spreadsheet export not finished when building biweekly report payload",
      key_outputs: [requestedOutputPath],
      export_error: null,
    },
  });
  await fs.mkdir(reviewWeekDir, { recursive: true });
  const biweeklyReportResult = await generateBiweeklyDocxReport({
    outputDirectory: reviewWeekDir,
    payload: biweeklyPayload,
    now: TODAY,
  });

  const skillAvailability = await detectSpreadsheetsSkillAvailability();
  const fallbackChain = [EXPORT_METHODS.SPREADSHEETS_SKILL, EXPORT_METHODS.NODE_FALLBACK, EXPORT_METHODS.PYTHON_SPAWN_LEGACY, EXPORT_METHODS.MANUAL_REQUIRED];

  let exportAudit;
  if (skillAvailability.available) {
    const res = await exportAllResearchOsXlsxWithSpreadsheetsSkill({
      sourcePath,
      reviewRootDir: REVIEW_ROOT,
      reviewWeekDir,
      reviewDayDir,
      dateStr,
      weekLabel: week,
      dayLabel: day,
    });
    const sheets = Array.isArray(res.daily_workbook_sheets) ? res.daily_workbook_sheets : [];
    if (!sheets.includes("每日反馈")) {
      throw new Error("DAILY_FEEDBACK_SHEET_MISSING: expected '每日反馈' in workbook sheets, got: " + JSON.stringify(sheets));
    }
    exportAudit = {
      stage4_export_status: "success",
      export_method: EXPORT_METHODS.SPREADSHEETS_SKILL,
      export_skill: "Spreadsheets",
      spreadsheets_skill_available: true,
      export_root: REVIEW_ROOT,
      requested_output_path: requestedOutputPath,
      actual_output_path: res.outputs?.every_other_day_report || null,
      desktop_export_disabled: true,
      export_input_files: [writebackReadyPath, backfillPath, writebackSummaryPath, runReportPath, sourcePath],
      export_rows_count: res.rows_count,
      export_excluded_d_count: Number(runReport?.counts?.d_skipped || res.excluded_d_count || 0),
      export_writeback_failures_count: Array.isArray(writebackSummary?.failures) ? writebackSummary.failures.length : 0,
      export_translation_failures_count: Number(backfillReport?.failure_count || 0),
      export_error: null,
      export_degraded: false,
      export_fallback_chain: fallbackChain,
      final_xlsx_outputs: ["隔日报.xlsx"],
      final_docx_outputs: [biweeklyReportResult.outputPath],
      biweekly_docx_report_path: biweeklyReportResult.outputPath,
      biweekly_docx_data_source_note: biweeklyReportResult.payload.dataSourceNote,
      export_generated_at: new Date().toISOString(),
      manual_required: false,
      export_outputs: {
        ...res.outputs,
        biweekly_docx_report: biweeklyReportResult.outputPath,
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
  } else {
    exportAudit = {
      stage4_export_status: "failed",
      export_method: EXPORT_METHODS.MANUAL_REQUIRED,
      export_skill: null,
      spreadsheets_skill_available: false,
      spreadsheets_skill_unavailable_reason: skillAvailability.reason,
      export_output_path: null,
      export_root: REVIEW_ROOT,
      requested_output_path: requestedOutputPath,
      actual_output_path: null,
      desktop_export_disabled: true,
      export_input_files: [writebackReadyPath, backfillPath, writebackSummaryPath, runReportPath, sourcePath],
      export_rows_count: 0,
      export_excluded_d_count: Number(runReport?.counts?.d_skipped || 0),
      export_writeback_failures_count: Array.isArray(writebackSummary?.failures) ? writebackSummary.failures.length : 0,
      export_translation_failures_count: Number(backfillReport?.failure_count || 0),
      export_error: "Spreadsheets skill unavailable",
      export_degraded: true,
      export_degrade_reason: "spreadsheets_skill_unavailable",
      export_fallback_chain: fallbackChain,
      final_xlsx_outputs: ["隔日报.xlsx"],
      final_docx_outputs: [biweeklyReportResult.outputPath],
      biweekly_docx_report_path: biweeklyReportResult.outputPath,
      biweekly_docx_data_source_note: biweeklyReportResult.payload.dataSourceNote,
      export_generated_at: new Date().toISOString(),
      manual_required: true,
      manual_steps: [
        "Ensure @oai/artifact-tool is available in Codex runtime.",
        "Rerun: node tools/finalize_research_os_exports.mjs",
      ],
    };
    throw new Error(`SPREADSHEETS_SKILL_UNAVAILABLE: ${skillAvailability.reason}`);
  }

  runReport.steps = runReport.steps || {};
  runReport.steps.stage4_export_audit = exportAudit;
  runReport.steps.med_weekly_synthesis = {
    ok: true,
    completed: true,
    date: dateStr,
    export_policy: "spreadsheets_skill_first_for_daily_xlsx_with_biweekly_docx",
    report_label: "隔日报",
    synthesis_label: "双周报",
    outputs: {
      ...(exportAudit.export_outputs || { every_other_day_report: requestedOutputPath }),
      biweekly_docx_report: biweeklyReportResult.outputPath,
    },
  };
  runReport.stage_timings = runReport.stage_timings || {};
  runReport.stage_timings.excel_export = {
    status: "completed",
    ms: Date.now() - stageStarted,
    method: exportAudit.export_method,
  };

  await fs.writeFile(path.join(pipelineDir, "skill_alignment.json"), JSON.stringify(runReport.steps.skill_alignment || finalPayload.reportContext.skillAlignment, null, 2), "utf8");
  await fs.writeFile(runReportPath, JSON.stringify(runReport, null, 2), "utf8");
  await fs.writeFile(RUNTIME_STATE_PATH, JSON.stringify({ last_successful_full_run_at: new Date().toISOString(), last_accepted_planned_slot_at: runReport?.current_planned_slot_at || new Date().toISOString() }, null, 2), "utf8");

  console.log(JSON.stringify({ ok: true, stage: "finalize_exports", export: exportAudit }, null, 2));
}

export async function markFinalizeExportsFailure(err) {
  try {
    const week = isoWeek(TODAY);
    const day = yyMd(TODAY);
    const runReportPath = path.join(RESEARCH_ROOT, "pipeline", day, "run_report.json");
    const runReport = JSON.parse(await fs.readFile(runReportPath, "utf8"));
    runReport.failures = Array.isArray(runReport.failures) ? runReport.failures : [];
    runReport.failures.push({ stage: "stage4_weekly_synthesis_export", reason: String(err?.message || err), at: new Date().toISOString() });
    runReport.steps = runReport.steps || {};
    runReport.steps.med_weekly_synthesis = {
      ok: false,
      completed: false,
      date: fmtDate(TODAY),
      downgrade_reason: String(err?.message || err),
      export_policy: "spreadsheets_skill_first_for_daily_and_biweekly_docx",
    };
    await fs.writeFile(runReportPath, JSON.stringify(runReport, null, 2), "utf8");
  } catch {}
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  finalizeResearchOsExports().catch(async (err) => {
    await markFinalizeExportsFailure(err);
    console.error(err);
    process.exit(1);
  });
}
