import fs from "node:fs/promises";
import nodeFsSync from "node:fs";

export function buildEmergencyOrchestratorReport(error, { errorClass = "orchestrator_exception" } = {}) {
  const errMsg = String(error?.stack || error?.message || error);
  return {
    status: "orchestrator_crash",
    errorClass,
    error: errMsg.slice(0, 2000),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

export async function writeEmergencyOrchestratorReport(pipelineDir, error, options = {}) {
  const report = buildEmergencyOrchestratorReport(error, options);
  await fs.mkdir(pipelineDir, { recursive: true });
  await fs.writeFile(`${pipelineDir}/orchestrator_report.json`, JSON.stringify(report, null, 2), "utf8");
  return report;
}

export function writeEmergencyOrchestratorReportSync(pipelineDir, error, options = {}) {
  const report = buildEmergencyOrchestratorReport(error, options);
  nodeFsSync.mkdirSync(pipelineDir, { recursive: true });
  nodeFsSync.writeFileSync(`${pipelineDir}/orchestrator_report.json`, JSON.stringify(report, null, 2), "utf8");
  return report;
}
