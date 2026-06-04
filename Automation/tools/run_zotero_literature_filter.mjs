// Must be first import: sets RESEARCH_OS_OVERRIDE_DATE from --date= CLI arg before stage modules load.
import "./lib/date_override_bootstrap.mjs";
import "./lib/env_file_bootstrap.mjs";

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { checkZoteroMcpReadyStage } from "./check_zotero_mcp_ready.mjs";
import { finalizeResearchOsExports, markFinalizeExportsFailure } from "./finalize_research_os_exports.mjs";
import { markWritebackFailure, runMcpBulkWriteback } from "./mcp_bulk_writeback.mjs";
import { markBackfillFailure, runMcpTranslationBackfill } from "./mcp_translation_backfill.mjs";
import { runResearchOsPipeline } from "./run_research_os_pipeline.mjs";
import { buildRuntimeConfig } from "./lib/runtime_config.mjs";
import { evaluateRunInterval } from "./lib/schedule_support.mjs";
import { filterDesktopReviewSourceByWritebackSummary } from "./lib/pipeline_stage_support.mjs";
import { buildRunContext, buildOrchestratorReport, deriveWorkflowStatus, workflowStatusToExitCode } from "./lib/orchestrator_status.mjs";
import { ensureWorkflowStartupReady } from "./lib/workflow_startup_ready.mjs";

const AUTOMATION_NAME = "zotero-literature-filter";
const MANUAL_BYPASS_REASON = "manual_bypass_interval_gate";
const EXPLICIT_FORCE_BYPASS_REASON = "explicit_force_run";

function iso(d) {
  return d.toISOString();
}

function artifactPath(config, name) {
  return `${config.pipelineDir}/${name}`;
}

function makeStage(name, scriptPath, handler) {
  return {
    name,
    command: `node ${scriptPath}`,
    scriptPath,
    handler,
  };
}

async function defaultRunStage(stage) {
  const originalWrite = process.stdout.write;
  const originalErrorWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";
  process.stdout.write = function writeStdout(chunk, ...args) {
    stdout += String(chunk);
    return originalWrite.call(this, chunk, ...args);
  };
  process.stderr.write = function writeStderr(chunk, ...args) {
    stderr += String(chunk);
    return originalErrorWrite.call(this, chunk, ...args);
  };
  try {
    await stage.handler();
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    const message = String(err?.stack || err?.message || err);
    stderr += message;
    try {
      if (stage.name === "stage2_writeback") await markWritebackFailure(err);
      if (stage.name === "stage3_translation") await markBackfillFailure(err);
      if (stage.name === "stage4_exports") await markFinalizeExportsFailure(err);
    } catch (markErr) {
      stderr += "\n[orchestrator] markFailure also threw: " + String(markErr?.message || markErr);
    }
    return { exitCode: stage.name === "stage3_translation" && /^partial_failed:/i.test(message) ? 2 : 1, stdout, stderr };
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalErrorWrite;
  }
}

async function defaultStatArtifact(p) {
  try {
    const st = await fs.stat(p);
    return { exists: true, mtimeMs: st.mtimeMs };
  } catch {
    return { exists: false, mtimeMs: null };
  }
}

async function defaultReadJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

async function defaultWriteReport(report) {
  await fs.mkdir(report.pipelineDir, { recursive: true });
  await fs.writeFile(`${report.pipelineDir}/orchestrator_report.json`, JSON.stringify(report, null, 2), "utf8");
}

async function defaultWriteJson(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

function trimLog(s) {
  const v = String(s || "").trim();
  return v.length <= 2000 ? v : `${v.slice(0, 2000)}...`;
}

async function inspectArtifact(key, fileName, stageStartedAt, config, statArtifact, readJson) {
  const p = artifactPath(config, fileName);
  const stat = await statArtifact(p);
  const stageStartMs = Date.parse(stageStartedAt);
  const stale = stat.exists ? !(Number(stat.mtimeMs) >= stageStartMs) : true;
  let data = null;
  if (stat.exists && !stale) {
    try {
      data = await readJson(p);
    } catch {
      data = null;
    }
  }
  return {
    key,
    path: p,
    exists: Boolean(stat.exists),
    mtimeMs: stat.mtimeMs ?? null,
    stale,
    currentRun: Boolean(stat.exists && !stale),
    data,
  };
}

function skippedStage(name, scriptPath, skipReason, clock) {
  const at = iso(clock());
  return {
    name,
    command: `node ${scriptPath}`,
    startedAt: at,
    finishedAt: at,
    exitCode: null,
    status: "skipped",
    skipReason,
  };
}

async function executeStage(stage, runStage, clock) {
  const startedAt = iso(clock());
  const result = await runStage(stage);
  const finishedAt = iso(clock());
  return {
    name: stage.name,
    command: stage.command,
    startedAt,
    finishedAt,
    exitCode: Number(result.exitCode ?? 1),
    status: Number(result.exitCode ?? 1) === 0 ? "completed" : "failed",
    stdout: trimLog(result.stdout),
    stderr: trimLog(result.stderr),
  };
}

function parseForceRun(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.FORCE_RESEARCH_OS_RUN || env.RESEARCH_OS_FORCE_RUN || "false"));
}

export function parseTriggerMode(env = process.env, argv = process.argv) {
  const fromEnv = String(env.RESEARCH_OS_ORCHESTRATOR_TRIGGER || env.ZOTERO_ORCHESTRATOR_TRIGGER || "").trim().toLowerCase();
  if (fromEnv) return fromEnv;
  if ((argv || []).includes("--manual")) return "manual";
  const arg = (argv || []).find((x) => x.startsWith("--trigger="));
  const fromArg = arg ? String(arg.split("=")[1] || "").trim().toLowerCase() : "";
  return fromArg || "manual";
}

function isManualTrigger(triggerMode) {
  const v = String(triggerMode || "").trim().toLowerCase();
  return v !== "scheduled" && v !== "background";
}

async function evaluateOrchestratorIntervalGate(config, clock, readJson, { triggerMode = "manual" } = {}) {
  let lastSuccessfulRunAt = null;
  try {
    const runtimeState = await readJson(`${config.researchRoot}/runtime_state.json`);
    lastSuccessfulRunAt = runtimeState?.last_successful_full_run_at || null;
  } catch {}
  const manualTrigger = isManualTrigger(triggerMode);
  const intervalInfo = evaluateRunInterval({
    now: clock(),
    lastSuccessfulRunAt,
    intervalDays: Number(process.env.RESEARCH_OS_RUN_INTERVAL_DAYS || 2),
    forceRun: manualTrigger || parseForceRun(process.env),
  });
  return !manualTrigger && intervalInfo.skipped_due_to_interval
    ? {
      started_at: intervalInfo.current_run_at,
      skipped: true,
      reason: "interval_not_reached",
      automation_name: AUTOMATION_NAME,
      triggerMode,
      forceRun: false,
      explicitForceRun: false,
      bypassIntervalGate: false,
      bypassReason: null,
      ...intervalInfo,
      report_cadence: "two_day",
      report_label: "隔日报",
      synthesis_cadence_days: 14,
      synthesis_label: "双周报",
      export_root: config.reviewRoot,
      desktop_export_disabled: true,
    }
    : null;
}

export function parseStage1Only(env = process.env, argv = process.argv) {
  const flag = (argv || []).includes("--stage1-only");
  const fromEnv = /^(1|true|yes)$/i.test(String(env.RESEARCH_OS_STAGE1_ONLY || "").trim());
  return flag || fromEnv;
}

export function detectRunMode(env = process.env, argv = process.argv) {
  const triggerMode = parseTriggerMode(env, argv);
  const manualTrigger = isManualTrigger(triggerMode);
  const forceRun = manualTrigger || parseForceRun(env);
  const isScheduled = triggerMode === "scheduled" || triggerMode === "background";
  const isManualOrForce = manualTrigger || forceRun;
  const explicitForceRun = parseForceRun(env);
  return { triggerMode, isScheduled, isManualOrForce, forceRun, explicitForceRun };
}

export async function runZoteroLiteratureFilter({
  config = buildRuntimeConfig(),
  runStage = defaultRunStage,
  runCommand = null,
  ensureStartupReady = ensureWorkflowStartupReady,
  statArtifact = defaultStatArtifact,
  readJson = defaultReadJson,
  writeReport = defaultWriteReport,
  writeJson = defaultWriteJson,
  triggerMode = parseTriggerMode(),
  runMode = detectRunMode(),
  clock = () => new Date(),
  stage1Only = parseStage1Only(),
} = {}) {
  const runId = `zlf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = iso(clock());
  const manualTrigger = runMode.isManualOrForce;
  const runContext = buildRunContext({
    automationName: AUTOMATION_NAME,
    runId,
    platform: config.platform || process.platform,
    startedAt,
    triggerMode,
    runMode,
    manualTrigger,
    pipelineDir: config.pipelineDir,
  });
  const stages = [];
  const artifacts = {};
  let startup = null;
  const baseStageRunner = runCommand
    ? async (stage) => runCommand(stage, config)
    : runStage;
  const runSameProcessStage = async (stage) => {
    if (!manualTrigger) return baseStageRunner(stage);
    const originalForceRun = process.env.RESEARCH_OS_FORCE_RUN;
    const originalLegacyForceRun = process.env.FORCE_RESEARCH_OS_RUN;
    const originalTrigger = process.env.RESEARCH_OS_ORCHESTRATOR_TRIGGER;
    process.env.RESEARCH_OS_FORCE_RUN = "true";
    process.env.FORCE_RESEARCH_OS_RUN = "true";
    process.env.RESEARCH_OS_ORCHESTRATOR_TRIGGER = "manual";
    try {
      return await baseStageRunner(stage);
    } finally {
      if (originalForceRun === undefined) delete process.env.RESEARCH_OS_FORCE_RUN;
      else process.env.RESEARCH_OS_FORCE_RUN = originalForceRun;
      if (originalLegacyForceRun === undefined) delete process.env.FORCE_RESEARCH_OS_RUN;
      else process.env.FORCE_RESEARCH_OS_RUN = originalLegacyForceRun;
      if (originalTrigger === undefined) delete process.env.RESEARCH_OS_ORCHESTRATOR_TRIGGER;
      else process.env.RESEARCH_OS_ORCHESTRATOR_TRIGGER = originalTrigger;
    }
  };
  const stageDefs = {
    stage1: makeStage("stage1", `${config.repoRoot}/tools/run_research_os_pipeline.mjs`, () => runResearchOsPipeline()),
    mcpReady: makeStage("mcp_ready", `${config.repoRoot}/tools/check_zotero_mcp_ready.mjs`, () => checkZoteroMcpReadyStage()),
    stage2: makeStage("stage2_writeback", `${config.repoRoot}/tools/mcp_bulk_writeback.mjs`, () => runMcpBulkWriteback()),
    stage3: makeStage("stage3_translation", `${config.repoRoot}/tools/mcp_translation_backfill.mjs`, () => runMcpTranslationBackfill()),
    stage4: makeStage("stage4_exports", `${config.repoRoot}/tools/finalize_research_os_exports.mjs`, () => finalizeResearchOsExports()),
  };

  const skipReport = await evaluateOrchestratorIntervalGate(config, () => new Date(startedAt), readJson, { triggerMode });
  if (skipReport) {
    stages.push(skippedStage(stageDefs.stage1.name, stageDefs.stage1.scriptPath, "interval_not_reached", () => new Date(startedAt)));
    stages.push(skippedStage(stageDefs.mcpReady.name, stageDefs.mcpReady.scriptPath, "interval_not_reached", () => new Date(startedAt)));
    stages.push(skippedStage(stageDefs.stage2.name, stageDefs.stage2.scriptPath, "interval_not_reached", () => new Date(startedAt)));
    stages.push(skippedStage(stageDefs.stage3.name, stageDefs.stage3.scriptPath, "interval_not_reached", () => new Date(startedAt)));
    stages.push(skippedStage(stageDefs.stage4.name, stageDefs.stage4.scriptPath, "interval_not_reached", () => new Date(startedAt)));
    await writeJson(`${config.pipelineDir}/run_skip_report.json`, skipReport);
    await writeJson(`${config.pipelineDir}/run_report.json`, skipReport);
    const report = buildOrchestratorReport({
      status: "skipped",
      runContext,
      finishedAt: startedAt,
      stages,
      artifacts,
      extra: { skipReport },
    });
    await writeReport(report);
    return report;
  }

  try {
    startup = await ensureStartupReady();
  } catch (err) {
    startup = {
      ok: false,
      errorCode: err?.code || "UNKNOWN",
      error: String(err?.message || err),
      failureClass: err?.details?.failureClass || null,
      details: err?.details || null,
    };
    stages.push(skippedStage(stageDefs.stage1.name, stageDefs.stage1.scriptPath, "startup_failed", clock));
    stages.push(skippedStage(stageDefs.mcpReady.name, stageDefs.mcpReady.scriptPath, "startup_failed", clock));
    stages.push(skippedStage(stageDefs.stage2.name, stageDefs.stage2.scriptPath, "startup_failed", clock));
    stages.push(skippedStage(stageDefs.stage3.name, stageDefs.stage3.scriptPath, "startup_failed", clock));
    stages.push(skippedStage(stageDefs.stage4.name, stageDefs.stage4.scriptPath, "startup_failed", clock));
    const report = buildOrchestratorReport({
      status: "failed_due_to_config_or_dependency",
      runContext,
      finishedAt: iso(clock()),
      stages,
      artifacts,
      extra: { startup },
    });
    await writeReport(report);
    return report;
  }

  stages.push(await executeStage(stageDefs.stage1, runSameProcessStage, clock));
  if (stage1Only && stages.at(-1).exitCode === 0) {
    stages.push(skippedStage(stageDefs.mcpReady.name, stageDefs.mcpReady.scriptPath, "stage1_only_mode", clock));
    stages.push(skippedStage(stageDefs.stage2.name, stageDefs.stage2.scriptPath, "stage1_only_mode", clock));
    stages.push(skippedStage(stageDefs.stage3.name, stageDefs.stage3.scriptPath, "stage1_only_mode", clock));
    stages.push(skippedStage(stageDefs.stage4.name, stageDefs.stage4.scriptPath, "stage1_only_mode", clock));
    const report = buildOrchestratorReport({
      status: "completed_stage1_only",
      runContext,
      finishedAt: iso(clock()),
      stages,
      artifacts,
      extra: { stage1Only: true, startup },
    });
    await writeReport(report);
    return report;
  }
  if (stages.at(-1).exitCode !== 0) {
    stages.push(skippedStage(stageDefs.mcpReady.name, stageDefs.mcpReady.scriptPath, "stage1_failed", clock));
    stages.push(skippedStage(stageDefs.stage2.name, stageDefs.stage2.scriptPath, "stage1_failed", clock));
    stages.push(skippedStage(stageDefs.stage3.name, stageDefs.stage3.scriptPath, "stage1_failed", clock));
    stages.push(skippedStage(stageDefs.stage4.name, stageDefs.stage4.scriptPath, "stage1_failed", clock));
    const report = buildOrchestratorReport({
      status: "failed_stage1",
      runContext,
      finishedAt: iso(clock()),
      stages,
      artifacts,
      extra: { startup },
    });
    await writeReport(report);
    return report;
  }

  stages.push(await executeStage(stageDefs.mcpReady, runSameProcessStage, clock));
  if (stages.at(-1).exitCode !== 0) {
    stages.push(skippedStage(stageDefs.stage2.name, stageDefs.stage2.scriptPath, "mcp_ready_failed", clock));
    stages.push(skippedStage(stageDefs.stage3.name, stageDefs.stage3.scriptPath, "mcp_ready_failed", clock));
    stages.push(skippedStage(stageDefs.stage4.name, stageDefs.stage4.scriptPath, "mcp_ready_failed", clock));
    const stage1Ok = stages.find((s) => s.name === "stage1")?.exitCode === 0;
    const mcpNotReadyStatus = stage1Ok ? "degraded_due_to_mcp_unavailable" : "failed_stage1";
    const report = buildOrchestratorReport({
      status: mcpNotReadyStatus,
      runContext,
      finishedAt: iso(clock()),
      stages,
      artifacts,
      extra: { startup },
    });
    await writeReport(report);
    return report;
  }

  const stage2 = await executeStage(stageDefs.stage2, runSameProcessStage, clock);
  stages.push(stage2);
  artifacts.writeback_summary = await inspectArtifact("writeback_summary", "mcp_writeback_summary.json", stage2.startedAt, config, statArtifact, readJson);
  if (stage2.exitCode !== 0 || !artifacts.writeback_summary.currentRun) {
    const reason = stage2.exitCode !== 0 ? "stage2_failed" : "writeback_summary_stale_or_missing";
    stages.push(skippedStage(stageDefs.stage3.name, stageDefs.stage3.scriptPath, reason, clock));
    stages.push(skippedStage(stageDefs.stage4.name, stageDefs.stage4.scriptPath, reason, clock));
    const report = buildOrchestratorReport({
      status: "failed_stage2_writeback",
      runContext,
      finishedAt: iso(clock()),
      stages,
      artifacts,
      extra: { startup },
    });
    await writeReport(report);
    return report;
  }

  // Filter desktop_daily_review_source.json to only include Stage 2 writeback items
  let desktopSourceFilterResult = null;
  try {
    const desktopSrcPath = `${config.pipelineDir}/desktop_daily_review_source.json`;
    const desktopSrc = await readJson(desktopSrcPath);
    const writebackData = artifacts.writeback_summary.data;
    desktopSourceFilterResult = filterDesktopReviewSourceByWritebackSummary(desktopSrc, writebackData);
    if (desktopSourceFilterResult.status !== "ok") {
      console.warn(`[orchestrator] desktop review source filter: ${desktopSourceFilterResult.status} - ${desktopSourceFilterResult.warning}`);
    }
    await writeJson(desktopSrcPath, desktopSourceFilterResult.source);
  } catch (e) {
    console.error(`[orchestrator] failed to filter desktop review source: ${String(e?.message || e).slice(0, 200)}`);
    desktopSourceFilterResult = { status: "filter_error", warning: String(e?.message || e).slice(0, 200), candidateCount: 0, writebackItemCount: 0, keptCount: 0, unmatchedCandidateCount: 0, unmatchedWritebackCount: 0, ambiguousCandidateKeyCount: 0, ambiguousWritebackKeyCount: 0 };
  }
  artifacts.desktop_source_filter = desktopSourceFilterResult;

  const stage3 = await executeStage(stageDefs.stage3, runSameProcessStage, clock);
  artifacts.translation_backfill = await inspectArtifact("translation_backfill", "abc_translation_backfill.json", stage3.startedAt, config, statArtifact, readJson);
  const stage3FailureCount = Number(artifacts.translation_backfill.data?.failure_count || 0);
  if (stage3.exitCode === 2 || (stage3.exitCode === 0 && stage3FailureCount > 0)) {
    stage3.status = "partial_failed";
  }
  stages.push(stage3);

  if ((stage3.exitCode !== 0 && stage3.exitCode !== 2) || !artifacts.translation_backfill.currentRun) {
    const reason = stage3.exitCode !== 0 && stage3.exitCode !== 2 ? "stage3_failed" : "translation_backfill_stale_or_missing";
    stages.push(skippedStage(stageDefs.stage4.name, stageDefs.stage4.scriptPath, reason, clock));
    const report = buildOrchestratorReport({
      status: "failed_stage3_translation",
      runContext,
      finishedAt: iso(clock()),
      stages,
      artifacts,
      extra: { startup },
    });
    await writeReport(report);
    return report;
  }

  stages.push(await executeStage(stageDefs.stage4, runSameProcessStage, clock));
  const stage4Ok = stages.at(-1).exitCode === 0;
  const finalStatus = deriveWorkflowStatus({
    explicitStatus: stage4Ok ? "completed" : "failed_stage4_export",
    stages,
    artifacts,
  });
  const report = buildOrchestratorReport({
    status: finalStatus,
    runContext,
    finishedAt: iso(clock()),
    stages,
    artifacts,
    extra: { startup },
  });
  await writeReport(report);
  return report;
}

async function main() {
  const runMode = detectRunMode();
  let orchestratorReportWritten = false;
  process.env.RESEARCH_OS_ORCHESTRATOR_TRIGGER = runMode.triggerMode;
  if (runMode.isManualOrForce) {
    process.env.RESEARCH_OS_FORCE_RUN = "true";
    process.env.FORCE_RESEARCH_OS_RUN = "true";
  }
  const dateArg = (process.argv || []).find((x) => x.startsWith("--date="));
  const overrideDateStr = dateArg ? dateArg.split("=")[1] : undefined;
  if (overrideDateStr) {
    process.env.RESEARCH_OS_OVERRIDE_DATE = overrideDateStr;
  }
  const overrideNow = overrideDateStr ? new Date(overrideDateStr) : undefined;
  const config = overrideNow ? buildRuntimeConfig({ now: overrideNow }) : buildRuntimeConfig();
  let report;
  try {
    report = await runZoteroLiteratureFilter({ triggerMode: runMode.triggerMode, runMode, config });
    orchestratorReportWritten = true;
  } catch (orchestratorErr) {
    // Emergency fallback: write a minimal report so downstream diagnostics work.
    const pipelineDir = buildRuntimeConfig().pipelineDir;
    const errMsg = String(orchestratorErr?.stack || orchestratorErr?.message || orchestratorErr);
    try { process.stderr.write(`[orchestrator] runZoteroLiteratureFilter threw: ${errMsg}\n`); } catch {}
    try {
      await fs.mkdir(pipelineDir, { recursive: true });
      const emergencyReport = {
        status: "orchestrator_crash",
        error: errMsg.slice(0, 2000),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };
      await fs.writeFile(`${pipelineDir}/orchestrator_report.json`, JSON.stringify(emergencyReport, null, 2), "utf8");
      orchestratorReportWritten = true;
    } catch (writeErr) {
      try { process.stderr.write(`[orchestrator] emergency report write also failed: ${writeErr}\n`); } catch {}
    }
    report = { status: "orchestrator_crash" };
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(["completed", "completed_stage1_only", "degraded_due_to_mcp_unavailable", "skipped"].includes(report.status) ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  // Catch unhandled promise rejections from inline stage handlers (e.g. mcp_bulk_writeback
  // async operations that reject after the handler returns). Without this, the process
  // crashes silently with exit code 1 and no orchestrator_report.json is written.
  process.on("unhandledRejection", (reason) => {
    const msg = reason?.stack || reason?.message || String(reason);
    try { process.stderr.write(`[orchestrator] unhandledRejection: ${msg}\n`); } catch {}
    process.exit(1);
  });
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
