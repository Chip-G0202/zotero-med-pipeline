import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { buildRuntimeConfig } from "./lib/runtime_config.mjs";
import { evaluateRunInterval } from "./lib/schedule_support.mjs";

function iso(d) {
  return d.toISOString();
}

function artifactPath(config, name) {
  return `${config.pipelineDir}/${name}`;
}

function makeStage(name, scriptPath) {
  return {
    name,
    command: `node ${scriptPath}`,
    scriptPath,
  };
}

async function defaultRunCommand(stage, config) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [stage.scriptPath], {
      cwd: config.projectRoot,
      env: {
        ...process.env,
        ZOTERO_PROJECT_ROOT: config.projectRoot,
        ZOTERO_MCP_URL: config.mcpUrl,
        ZOTERO_EXTERNAL_LAUNCHER: config.externalLauncher || process.env.ZOTERO_EXTERNAL_LAUNCHER || "",
        PWSH_PATH: config.pwshPath,
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      resolve({ exitCode: 1, stdout, stderr: String(err?.message || err) });
    });
    child.on("close", (code) => {
      resolve({ exitCode: Number(code ?? 1), stdout, stderr });
    });
  });
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

async function executeStage(stage, config, runCommand, clock) {
  const startedAt = iso(clock());
  const result = await runCommand(stage, config);
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

function parseTriggerMode(env = process.env, argv = process.argv) {
  const fromEnv = String(env.RESEARCH_OS_ORCHESTRATOR_TRIGGER || env.ZOTERO_ORCHESTRATOR_TRIGGER || "").trim().toLowerCase();
  if (fromEnv) return fromEnv;
  const arg = (argv || []).find((x) => x.startsWith("--trigger="));
  const fromArg = arg ? String(arg.split("=")[1] || "").trim().toLowerCase() : "";
  return fromArg || "manual";
}

function isManualTrigger(triggerMode) {
  return String(triggerMode || "").trim().toLowerCase() !== "scheduled" && String(triggerMode || "").trim().toLowerCase() !== "background";
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

export async function runZoteroPaperRank({
  config = buildRuntimeConfig(),
  runCommand = defaultRunCommand,
  statArtifact = defaultStatArtifact,
  readJson = defaultReadJson,
  writeReport = defaultWriteReport,
  writeJson = defaultWriteJson,
  triggerMode = parseTriggerMode(),
  clock = () => new Date(),
} = {}) {
  const runId = `zpr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = iso(clock());
  const stages = [];
  const artifacts = {};
  const stageDefs = {
    stage1: makeStage("stage1", `${config.repoRoot}/tools/run_research_os_pipeline.mjs`),
    mcpReady: makeStage("mcp_ready", `${config.repoRoot}/tools/check_zotero_mcp_ready.mjs`),
    stage2: makeStage("stage2_writeback", `${config.repoRoot}/tools/mcp_bulk_writeback.mjs`),
    stage3: makeStage("stage3_translation", `${config.repoRoot}/tools/mcp_translation_backfill.mjs`),
    stage4: makeStage("stage4_exports", `${config.repoRoot}/tools/finalize_research_os_exports.mjs`),
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
    const report = { runId, startedAt, finishedAt: startedAt, status: "skipped", pipelineDir: config.pipelineDir, stages, artifacts, skipReport };
    await writeReport(report);
    return report;
  }

  stages.push(await executeStage(stageDefs.stage1, config, runCommand, clock));
  if (stages.at(-1).exitCode !== 0) {
    stages.push(skippedStage(stageDefs.mcpReady.name, stageDefs.mcpReady.scriptPath, "stage1_failed", clock));
    stages.push(skippedStage(stageDefs.stage2.name, stageDefs.stage2.scriptPath, "stage1_failed", clock));
    stages.push(skippedStage(stageDefs.stage3.name, stageDefs.stage3.scriptPath, "stage1_failed", clock));
    stages.push(skippedStage(stageDefs.stage4.name, stageDefs.stage4.scriptPath, "stage1_failed", clock));
    const report = { runId, startedAt, finishedAt: iso(clock()), status: "failed", pipelineDir: config.pipelineDir, stages, artifacts };
    await writeReport(report);
    return report;
  }

  stages.push(await executeStage(stageDefs.mcpReady, config, runCommand, clock));
  if (stages.at(-1).exitCode !== 0) {
    stages.push(skippedStage(stageDefs.stage2.name, stageDefs.stage2.scriptPath, "mcp_ready_failed", clock));
    stages.push(skippedStage(stageDefs.stage3.name, stageDefs.stage3.scriptPath, "mcp_ready_failed", clock));
    stages.push(skippedStage(stageDefs.stage4.name, stageDefs.stage4.scriptPath, "mcp_ready_failed", clock));
    const report = { runId, startedAt, finishedAt: iso(clock()), status: "failed", pipelineDir: config.pipelineDir, stages, artifacts };
    await writeReport(report);
    return report;
  }

  const stage2 = await executeStage(stageDefs.stage2, config, runCommand, clock);
  stages.push(stage2);
  artifacts.writeback_summary = await inspectArtifact(
    "writeback_summary",
    "mcp_writeback_summary.json",
    stage2.startedAt,
    config,
    statArtifact,
    readJson,
  );
  if (stage2.exitCode !== 0 || !artifacts.writeback_summary.currentRun) {
    const reason = stage2.exitCode !== 0 ? "stage2_failed" : "writeback_summary_stale_or_missing";
    stages.push(skippedStage(stageDefs.stage3.name, stageDefs.stage3.scriptPath, reason, clock));
    stages.push(skippedStage(stageDefs.stage4.name, stageDefs.stage4.scriptPath, reason, clock));
    const report = { runId, startedAt, finishedAt: iso(clock()), status: "failed", pipelineDir: config.pipelineDir, stages, artifacts };
    await writeReport(report);
    return report;
  }

  const stage3 = await executeStage(stageDefs.stage3, config, runCommand, clock);
  artifacts.translation_backfill = await inspectArtifact(
    "translation_backfill",
    "abc_translation_backfill.json",
    stage3.startedAt,
    config,
    statArtifact,
    readJson,
  );
  const stage3FailureCount = Number(artifacts.translation_backfill.data?.failure_count || 0);
  if (stage3.exitCode === 2 || (stage3.exitCode === 0 && stage3FailureCount > 0)) {
    stage3.status = "partial_failed";
  }
  stages.push(stage3);

  if ((stage3.exitCode !== 0 && stage3.exitCode !== 2) || !artifacts.translation_backfill.currentRun) {
    const reason = stage3.exitCode !== 0 && stage3.exitCode !== 2 ? "stage3_failed" : "translation_backfill_stale_or_missing";
    stages.push(skippedStage(stageDefs.stage4.name, stageDefs.stage4.scriptPath, reason, clock));
    const report = { runId, startedAt, finishedAt: iso(clock()), status: "failed", pipelineDir: config.pipelineDir, stages, artifacts };
    await writeReport(report);
    return report;
  }

  stages.push(await executeStage(stageDefs.stage4, config, runCommand, clock));
  const status = stages.at(-1).exitCode === 0 ? "completed" : "failed";
  const report = { runId, startedAt, finishedAt: iso(clock()), status, pipelineDir: config.pipelineDir, stages, artifacts };
  await writeReport(report);
  return report;
}

async function main() {
  const config = buildRuntimeConfig();
  const report = await runZoteroPaperRank({ config, triggerMode: parseTriggerMode() });
  console.log(JSON.stringify(report, null, 2));
  process.exit(["completed", "skipped"].includes(report.status) ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
