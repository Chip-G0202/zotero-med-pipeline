import fs from "node:fs/promises";
import path from "node:path";

import { buildMonthlyReportPayload, generateMonthlyDocxReport } from "./monthly_docx_report.mjs";
import { eachMonthDayLabel } from "../lib/report_period_support.mjs";

export async function collectMonthlyRunArtifacts(rootDir, now) {
  const artifacts = [];
  for (const day of eachMonthDayLabel(now)) {
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

export async function maybeGenerateMonthlyReport({
  enabled,
  outputDirectory,
  now,
  recentRunArtifacts,
  latestExportSummary,
}) {
  if (!enabled) {
    return {
      generated: false,
      outputPath: null,
      payload: null,
      reason: "not_last_due_run_of_month",
    };
  }
  await fs.mkdir(outputDirectory, { recursive: true });
  const payload = buildMonthlyReportPayload({
    now,
    recentRuns: recentRunArtifacts,
    latestExportSummary,
  });
  const result = await generateMonthlyDocxReport({
    outputDirectory,
    payload,
    now,
  });
  return {
    generated: true,
    outputPath: result.outputPath,
    payload: result.payload,
    reason: "",
  };
}
