import path from "node:path";

import { paragraph, table, writeDocxFile } from "./docx_support.mjs";
import { monthPeriod } from "./report_period_support.mjs";

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

function collectMonthlyRuns(period, artifacts = []) {
  const startMs = period.start.getTime();
  const endMs = period.end.getTime() + 24 * 60 * 60 * 1000 - 1;
  return artifacts
    .filter((artifact) => {
      const at = artifact?.finished_at || artifact?.started_at || artifact?.date || artifact?.generated_at;
      if (!at) return false;
      const time = new Date(at).getTime();
      return Number.isFinite(time) && time >= startMs && time <= endMs;
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
}

export function buildMonthlyReportPayload({
  now = new Date(),
  recentRuns = [],
  recentArtifacts = [],
  latestExportSummary = null,
  automationSummary = "当前可用记录不足，未生成历史汇总。",
  completedActions = "当前可用记录不足，未生成历史汇总。",
  keyOutputsFromHistory = [],
  exceptionsFromHistory = [],
  incompleteItems = "当前可用记录不足，未生成历史汇总。",
  conclusion = "当前可用记录不足，仅基于本次可用导出记录生成月报。",
} = {}) {
  const period = monthPeriod(now);
  const monthlyRuns = recentRuns.length ? collectMonthlyRuns(period, recentRuns) : collectMonthlyRuns(period, recentArtifacts);
  const runStats = buildRunStats(monthlyRuns);
  const latestSummary = latestExportSummary?.summary || automationSummary;
  const latestKeyOutputs = toStringArray(latestExportSummary?.key_outputs).length
    ? toStringArray(latestExportSummary.key_outputs)
    : collectOutputs(monthlyRuns);
  const latestExceptions = mergeStringArrays(
    exceptionsFromHistory,
    collectExceptionsFromRuns(monthlyRuns),
    latestExportSummary?.export_error ? [`export_error: ${latestExportSummary.export_error}`] : [],
  );

  return {
    period,
    runStats,
    latestAutomationSummary: latestSummary,
    latestKeyOutputs: latestKeyOutputs.length ? latestKeyOutputs : ["当前可用记录不足"],
    latestExceptions,
    latestIncomplete: incompleteItems || latestSummary,
    latestConclusion: latestExportSummary ? `本次阶段导出摘要：${latestSummary}` : conclusion,
    keyOutputsFromHistory: latestKeyOutputs,
    exceptionsFromHistory: latestExceptions,
    completedActions: completedActions || latestSummary,
    conclusion: latestExportSummary ? `本次阶段导出摘要：${latestSummary}` : conclusion,
    dataSourceNote: monthlyRuns.length ? "基于当月可用 run artifacts 汇总" : "未找到足够的当月 run artifacts，仅基于本次可用导出记录",
    generatedAt: now.toISOString(),
  };
}

export function buildMonthlyReportXml(payload) {
  const periodText = payload.period ? `${payload.period.startIso} ~ ${payload.period.endIso}` : "当前可用记录不足";
  const runStats = payload.runStats || { total: 0, completed: 0, skipped: 0, failed: 0 };
  const bodyXmlParts = [];
  bodyXmlParts.push(paragraph("月度自动化运行汇总报告", "Heading1"));
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

export async function generateMonthlyDocxReport({
  outputDirectory,
  payload,
  now = new Date(),
  write = writeDocxFile,
} = {}) {
  if (!outputDirectory) {
    throw new Error("MONTHLY_DOCX_OUTPUT_DIRECTORY_REQUIRED");
  }
  const finalPayload = payload || buildMonthlyReportPayload({ now });
  const fileName = `月报-${finalPayload.period.label}.docx`;
  const outputPath = path.join(outputDirectory, fileName);
  const bodyXml = buildMonthlyReportXml(finalPayload);
  const resolvedPath = await write(outputPath, bodyXml);
  return {
    payload: finalPayload,
    outputPath: resolvedPath,
    fileName,
  };
}
