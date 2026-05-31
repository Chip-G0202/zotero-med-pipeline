import fs from "node:fs/promises";
import path from "node:path";

import { buildDocxBuffer, paragraph, table, writeDocxFile } from "./docx_support.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

function toIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function labelForStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "completed") return "completed";
  if (normalized === "skipped") return "skipped";
  if (normalized === "failed") return "failed";
  return normalized || "unknown";
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function buildPeriod(now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = addDays(end, -13);
  return { start, end, startIso: toIsoDate(start), endIso: toIsoDate(end) };
}

function collectRecentRuns(periodStart, artifacts = []) {
  const periodStartMs = periodStart.getTime();
  return artifacts
    .filter((artifact) => {
      const at = artifact?.finished_at || artifact?.started_at || artifact?.date || artifact?.generated_at;
      if (!at) return false;
      const time = new Date(at).getTime();
      return Number.isFinite(time) && time >= periodStartMs;
    })
    .sort((left, right) => {
      const leftTime = new Date(left.finished_at || left.started_at || left.date || left.generated_at || 0).getTime();
      const rightTime = new Date(right.finished_at || right.started_at || right.date || right.generated_at || 0).getTime();
      return leftTime - rightTime;
    });
}

function buildRunStats(runs = []) {
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  for (const run of runs) {
    const status = labelForStatus(run.status || run.stage_status || run.pipeline_status);
    if (status === "completed") completed += 1;
    else if (status === "skipped") skipped += 1;
    else if (status === "failed") failed += 1;
  }
  return { total: runs.length, completed, skipped, failed };
}

function mergeStringArrays(...arrays) {
  const set = new Set();
  for (const array of arrays) {
    for (const item of array) {
      const text = String(item || "").trim();
      if (text) set.add(text);
    }
  }
  return [...set];
}

function collectOutputs(runs = []) {
  const outputs = [];
  for (const run of runs) {
    const exportOutputs = run.export_outputs || run.export_audit?.export_outputs || run.outputs || {};
    for (const value of Object.values(exportOutputs)) {
      if (typeof value === "string" && value.trim()) outputs.push(value.trim());
    }
    if (typeof run.output_path === "string" && run.output_path.trim()) outputs.push(run.output_path.trim());
  }
  return [...new Set(outputs)];
}

function resolveSectionEntry(entry, { period } = {}) {
  if (!entry) return null;
  if (typeof entry === "string") {
    return { summary: entry, keyOutputs: [], exceptions: [], sourcePath: "" };
  }
  return {
    summary: String(entry.summary || "当前可用记录不足，未生成历史汇总。"),
    keyOutputs: toStringArray(entry.key_outputs),
    exceptions: toStringArray(entry.exceptions),
    sourcePath: String(entry.source_path || ""),
  };
}

function sectionEntries(fallbackSummary, sourcePaths = []) {
  if (!sourcePaths.length) {
    return [resolveSectionEntry(fallbackSummary)];
  }
  return sourcePaths.map((sourcePath) => resolveSectionEntry({
    summary: fallbackSummary,
    key_outputs: [],
    exceptions: [],
    source_path: sourcePath,
  }));
}

function buildParagraphs(title, text) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [paragraph(`${title}：当前可用记录不足`)];
  return lines.map((line) => paragraph(`${title}：${line}`));
}

function appendParagraphs(bodyXmlParts, title, textOrTexts) {
  const texts = Array.isArray(textOrTexts) ? textOrTexts : [textOrTexts];
  for (const text of texts) {
    const lines = String(text || "").split(/\r?\n/).filter(Boolean);
    if (!lines.length) {
      bodyXmlParts.push(paragraph(`${title}：当前可用记录不足`));
    } else {
      for (const line of lines) {
        bodyXmlParts.push(paragraph(`${title}：${line}`));
      }
    }
  }
  return bodyXmlParts;
}

function collectExceptionsFromRuns(runs = []) {
  const exceptions = [];
  for (const run of runs) {
    if (Array.isArray(run.failures)) {
      for (const failure of run.failures) {
        if (!failure) continue;
        const text = [failure.stage, failure.reason].filter(Boolean).join(": ");
        if (text) exceptions.push(text);
      }
    }
    if (run.skip_reason) exceptions.push(`skip: ${run.skip_reason}`);
    if (run.export_error) exceptions.push(`export_error: ${run.export_error}`);
  }
  return exceptions;
}

export function buildBiweeklyReportPayload({
  now = new Date(),
  recentRuns = [],
  recentArtifacts = [],
  latestExportSummary = null,
  automationSummary = "当前可用记录不足，未生成历史汇总。",
  completedActions = "当前可用记录不足，未生成历史汇总。",
  keyOutputsFromHistory = [],
  exceptionsFromHistory = [],
  incompleteItems = "当前可用记录不足，未生成历史汇总。",
  conclusion = "当前可用记录不足，仅基于本次可用导出记录生成双周报。",
} = {}) {
  const period = buildPeriod(now);
  const recentRunsFromArtifacts = recentRuns.length ? recentRuns : collectRecentRuns(period.start, recentArtifacts);
  const runStats = buildRunStats(recentRunsFromArtifacts);
  const latestExportEntry = resolveSectionEntry(latestExportSummary, { period });
  const latestAutomationSummary = latestExportEntry?.summary || automationSummary;
  const latestKeyOutputs = latestExportEntry?.keyOutputs?.length ? latestExportEntry.keyOutputs : collectOutputs(recentRunsFromArtifacts);
  const latestExceptions = latestExportEntry?.exceptions?.length
    ? latestExportEntry.exceptions
    : mergeStringArrays(
        exceptionsFromHistory,
        collectExceptionsFromRuns(recentRunsFromArtifacts),
        latestExportSummary?.export_error ? [`export_error: ${latestExportSummary.export_error}`] : [],
      );
  const latestIncomplete = incompleteItems || latestAutomationSummary;
  const latestConclusion = latestExportSummary ? `本次阶段导出摘要：${latestAutomationSummary}` : conclusion;
  const historySections = [
    { title: "自动化运行摘要", entries: sectionEntries(automationSummary, keyOutputsFromHistory.length ? ["history"] : []), fallback: automationSummary },
    { title: "完成的主要操作", entries: sectionEntries(completedActions, keyOutputsFromHistory.length ? ["history"] : []), fallback: completedActions },
    { title: "关键输出文件或记录", entries: sectionEntries({ summary: "当前可用记录不足", key_outputs: keyOutputsFromHistory }), fallback: "当前可用记录不足" },
    { title: "异常、跳过、未完成项", entries: sectionEntries({ summary: "当前可用记录不足", exceptions: exceptionsFromHistory }), fallback: "当前可用记录不足" },
  ];

  return {
    period,
    runStats,
    latestAutomationSummary,
    latestKeyOutputs: latestKeyOutputs.length ? latestKeyOutputs : ["当前可用记录不足"],
    latestExceptions,
    latestIncomplete,
    latestConclusion,
    historySections,
    keyOutputsFromHistory: latestKeyOutputs,
    exceptionsFromHistory: latestExceptions,
    completedActions: latestAutomationSummary,
    conclusion: latestConclusion,
    dataSourceNote: recentRunsFromArtifacts.length ? "基于可用 run artifacts 汇总" : "未找到足够的历史 run artifacts，仅基于本次可用导出记录",
    generatedAt: now.toISOString(),
  };
}

export function buildBiweeklyReportXml(payload) {
  const periodText = payload.period ? `${payload.period.startIso} ~ ${payload.period.endIso}` : "当前可用记录不足";
  const runStats = payload.runStats || { total: 0, completed: 0, skipped: 0, failed: 0 };
  const bodyXmlParts = [];
  bodyXmlParts.push(paragraph("双周自动化运行汇总报告", "Heading1"));
  bodyXmlParts.push(paragraph(`报告周期：${periodText}`));
  bodyXmlParts.push(paragraph(`生成时间：${payload.generatedAt}`));
  bodyXmlParts.push(paragraph(`数据来源：${payload.dataSourceNote || "当前可用记录不足"}`));

  bodyXmlParts.push(paragraph("自动化运行摘要", "Heading2"));
  bodyXmlParts.push(table([
    ["指标", "值"],
    ["运行次数", String(runStats.total)],
    ["跳过次数", String(runStats.skipped)],
    ["失败次数", String(runStats.failed)],
    ["完成次数", String(runStats.completed)],
  ]));
  appendParagraphs(bodyXmlParts, "摘要说明", payload.latestAutomationSummary);

  bodyXmlParts.push(paragraph("完成的主要操作", "Heading2"));
  appendParagraphs(bodyXmlParts, "操作说明", payload.completedActions || payload.latestAutomationSummary);

  bodyXmlParts.push(paragraph("关键输出文件或记录", "Heading2"));
  appendParagraphs(bodyXmlParts, "输出记录", Array.isArray(payload.keyOutputsFromHistory) && payload.keyOutputsFromHistory.length ? payload.keyOutputsFromHistory : payload.latestKeyOutputs);

  bodyXmlParts.push(paragraph("异常、跳过、未完成项", "Heading2"));
  appendParagraphs(bodyXmlParts, "异常说明", Array.isArray(payload.exceptionsFromHistory) && payload.exceptionsFromHistory.length ? payload.exceptionsFromHistory : payload.latestExceptions);

  bodyXmlParts.push(paragraph("结论", "Heading2"));
  bodyXmlParts.push(paragraph(payload.conclusion || payload.latestConclusion || "当前可用记录不足"));

  return bodyXmlParts.join("");
}

export async function generateBiweeklyDocxReport({
  outputDirectory,
  payload,
  now = new Date(),
  write = writeDocxFile,
} = {}) {
  if (!outputDirectory) {
    throw new Error("BIWEEKLY_DOCX_OUTPUT_DIRECTORY_REQUIRED");
  }
  const finalPayload = payload || buildBiweeklyReportPayload({ now });
  const fileName = `双周报-${finalPayload.period.startIso}_${finalPayload.period.endIso}.docx`;
  const outputPath = path.join(outputDirectory, fileName);
  const bodyXml = buildBiweeklyReportXml(finalPayload);
  const resolvedPath = await write(outputPath, bodyXml);
  return {
    payload: finalPayload,
    outputPath: resolvedPath,
    fileName,
  };
}
