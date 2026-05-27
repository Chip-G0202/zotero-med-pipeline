import fs from "node:fs/promises";
import path from "node:path";
import { buildStandardSummary } from "./preference_refinement.mjs";

export const EXPORT_METHODS = {
  SPREADSHEETS_SKILL: "spreadsheets_skill",
  NODE_FALLBACK: "node_fallback",
  PYTHON_SPAWN_LEGACY: "python_spawn_legacy",
  MANUAL_REQUIRED: "manual_required",
};

export const PREFERENCE_AUDIT_SHEET_NAMES = ["偏好学习摘要", "偏好证据明细", "筛选标准变更", "本次筛选影响", "当前筛选标准摘要"];
export const STANDARD_SUMMARY_HEADERS = ["当前筛选标准", "我的评价"];
export const STANDARD_SUMMARY_SHEET_SCHEMA = "zh_two_column";
export const STANDARD_SUMMARY_FEEDBACK_OPTIONS = [
  "accurate", "too_broad", "too_narrow", "wrong_focus", "missing_priority", "over_excluding", "under_excluding", "needs_more_clinical_focus", "other",
  "准确", "太宽泛", "太窄", "重点错了", "缺少重点", "过度排除", "排除不足", "需要更偏临床", "其他",
];

export const DAILY_REVIEW_HEADERS = ["英文标题", "标题翻译", "推荐等级", "期刊/来源", "来源等级", "feedback", "comment", "已处理时间", "处理状态", "备注"];

export async function detectSpreadsheetsSkillAvailability() {
  try {
    await import("@oai/artifact-tool");
    return { available: true, reason: null };
  } catch (err) {
    return { available: false, reason: String(err?.message || err) };
  }
}

async function saveWorkbook(workbook, outputPath) {
  const { SpreadsheetFile } = await import("@oai/artifact-tool");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await xlsx.save(outputPath);
  return outputPath;
}

function createWorkbookWithSheet(Workbook, name) {
  const wb = Workbook.create();
  const ws = wb.worksheets.add(name);
  return { wb, ws };
}

function toDailyRows(triaged) {
  const banned = new Set(["D", "D无关"]);
  return triaged
    .filter((it) => !banned.has(String(it?.grade || "")) && !banned.has(String(it?.["推荐等级"] || "")))
    .map((it) => {
      const translated = it?.["标题翻译"] || it?.["中文标题"] || it?.shortTitle || it?.title || "";
      const source = String(it?.journal || it?.source_platform || "").replace("ScienceDirect Publication:", "").trim();
      return [
        it?.title || "",
        translated,
        it?.["推荐等级"] || it?.grade_label || "",
        source,
        "abstract_only",
        "",
        "",
        "",
        "待反馈",
        "",
      ];
    });
}

function writeHeader(sheet, range, headers) {
  sheet.getRange(range).values = [headers];
  sheet.getRange(range).format = {
    fill: "#1F4E78",
    font: { bold: true, color: "#FFFFFF" },
  };
}

export function buildStandardSummarySheetRows(preferenceAudit = {}, generatedAt = "") {
  const explicitRows = Array.isArray(preferenceAudit?.sheets?.standard_summary) ? preferenceAudit.sheets.standard_summary : [];
  const currentSummary = preferenceAudit?.current_standard_summary || null;
  const fallbackClusters = preferenceAudit?.clusters || preferenceAudit?.store?.clusters || [];
  const fallbackChanges = preferenceAudit?.cluster_changes || preferenceAudit?.sheets?.changes || [];
  const usingFallback = explicitRows.length === 0;
  const unavailable = !currentSummary && fallbackClusters.length === 0;
  const summary = currentSummary || buildStandardSummary(fallbackClusters, fallbackChanges);
  const fallbackText = buildCompactStandardSummaryText(summary, { unavailable });
  const fallbackRow = {
    "当前筛选标准": fallbackText,
    "我的评价": "",
  };
  const rows = explicitRows.length
    ? explicitRows.map((row) => ({
      "当前筛选标准": row?.["当前筛选标准"] || row?.standard_summary_text || buildCompactStandardSummaryText({
        one_sentence_summary: row?.one_sentence_summary || fallbackText,
        priority_summary: row?.current_priority_summary || row?.priority_summary || "",
        downrank_summary: row?.current_downrank_summary || row?.downrank_summary || "",
        uncertain_boundaries: row?.uncertain_boundaries || "",
        caveats: row?.caveats || "",
      }, { unavailable }),
      "我的评价": "",
    }))
    : [fallbackRow];
  return {
    rows,
    metadata: {
      standard_summary_generated: Boolean(currentSummary || fallbackClusters.length || explicitRows.length),
      standard_summary_generated_from_fallback: usingFallback,
      standard_summary_unavailable: unavailable,
      standard_summary_sheet_schema: STANDARD_SUMMARY_SHEET_SCHEMA,
      standard_summary_user_feedback_columns_present: false,
      standard_summary_sheet_name: PREFERENCE_AUDIT_SHEET_NAMES[4],
    },
  };
}

function buildCompactStandardSummaryText(summary = {}, { unavailable = false } = {}) {
  const lines = [];
  const oneSentence = String(summary?.one_sentence_summary || "").trim();
  const priority = String(summary?.priority_summary || summary?.current_priority_summary || "").trim();
  const downrank = String(summary?.downrank_summary || summary?.current_downrank_summary || "").trim();
  const uncertain = String(summary?.uncertain_boundaries || "").trim();
  const caveats = String(summary?.caveats || "").trim();
  if (unavailable || !oneSentence) {
    lines.push("当前稳定筛选标准仍有限，以下为基于现有反馈的暂定理解：");
  } else {
    lines.push(oneSentence);
  }
  if (priority) lines.push(`优先关注：${priority}`);
  if (downrank) lines.push(`相对降权：${downrank}`);
  if (uncertain) lines.push(`不确定边界：${uncertain}`);
  if (caveats) lines.push(`注意：${caveats}`);
  return lines.join("\n");
}

export async function exportAllResearchOsXlsxWithSpreadsheetsSkill({
  sourcePath,
  reviewRootDir,
  reviewWeekDir,
  reviewDayDir,
  dateStr,
  weekLabel,
  dayLabel,
}) {
  const { Workbook } = await import("@oai/artifact-tool");
  const payload = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  const triaged = Array.isArray(payload?.triaged) ? payload.triaged : [];
  const ctx = payload?.reportContext || {};
  const preferenceAudit = ctx?.preferenceLearningAudit || {};

  const dailyRows = toDailyRows(triaged);
  const exportPaths = {
    every_other_day_report: path.join(reviewDayDir, "隔日报.xlsx"),
    biweekly_report: path.join(reviewWeekDir, "双周报.xlsx"),
  };

  const { wb: daily, ws: dailySheet } = createWorkbookWithSheet(Workbook, "每日反馈");
  const allDaily = [DAILY_REVIEW_HEADERS, ...dailyRows];
  dailySheet.getRange(`A1:J${allDaily.length}`).values = allDaily;
  writeHeader(dailySheet, "A1:J1", DAILY_REVIEW_HEADERS);
  dailySheet.freezePanes.freezeRows(1);
  const maxRow = Math.max(allDaily.length, 2);
  dailySheet.getRange(`C2:C${maxRow}`).dataValidation = { rule: { type: "list", values: ["A课题相关", "B专题相关", "C领域相关", "D无关"] } };
  dailySheet.getRange(`E2:E${maxRow}`).dataValidation = { rule: { type: "list", values: ["metadata_only", "abstract_only", "pdf_fulltext"] } };
  dailySheet.getRange(`F2:F${maxRow}`).dataValidation = { rule: { type: "list", values: ["keep", "drop", "upgrade", "downgrade"] } };
  dailySheet.getRange(`I2:I${maxRow}`).dataValidation = { rule: { type: "list", values: ["待反馈", "已学习", "跳过", "需复核"] } };

  await saveWorkbook(daily, exportPaths.every_other_day_report);

  const { wb: weekly, ws: weeklySheet } = createWorkbookWithSheet(Workbook, "自动双周汇总");
  const weeklyHeaders = ["日期", "区块", "值", "内容", "说明", "来源等级", "备注"];
  writeHeader(weeklySheet, "A1:G1", weeklyHeaders);
  const top = dailyRows.slice(0, 5).map((r, i) => [dateStr, "Top文献", i + 1, r[0], r[2], "abstract_only", r[1]]);
  const weeklyRows = top.length ? top : [[dateStr, "Top文献", 0, "无导出条目", "", "", ""]];
  weeklySheet.getRange(`A2:G${weeklyRows.length + 1}`).values = weeklyRows;
  await saveWorkbook(weekly, exportPaths.biweekly_report);

  return {
    headers: DAILY_REVIEW_HEADERS,
    rows_count: dailyRows.length,
    excluded_d_count: triaged.length - dailyRows.length,
    daily_workbook_sheets: ["每日反馈"],
    preference_learning_sheets: ["每日反馈"],
    standard_summary_sheet_exported: false,
    standard_summary_sheet_name: "",
    standard_summary_sheet_schema: "",
    standard_summary_generated: Boolean(preferenceAudit?.current_standard_summary),
    standard_summary_generated_from_fallback: false,
    standard_summary_unavailable: false,
    standard_summary_user_feedback_columns_present: false,
    standard_summary_headers: [],
    outputs: exportPaths,
  };
}
