import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const DEFAULT_ZOTERO_EXE = "D:/Zotero/zotero.exe";
const DEFAULT_MCP_URL = "http://127.0.0.1:23120/mcp";
const DEFAULT_POST_START_DELAY_MS = 3000;
const DEFAULT_RETRIES = 10;
const DEFAULT_INTERVAL_MS = 1000;
const SCHEDULED_TASK_NAME = "StartZoteroForCodexOnly";
const DESKTOP_COMMANDER_FIXED_COMMAND = `schtasks /Run /TN ${SCHEDULED_TASK_NAME}`;
const EXTERNAL_LAUNCHER_DESKTOP_COMMANDER = "desktop_commander";

function toPosix(p) {
  return String(p || "").replace(/\\/g, "/");
}

function fileExists(p) {
  if (!p) return false;
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function isPermissionDeniedText(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("eperm") || s.includes("access is denied") || s.includes("permission denied") || s.includes("operation not permitted");
}

function trunc(s, max = 300) {
  const v = String(s || "").trim();
  return v.length <= max ? v : `${v.slice(0, max)}...`;
}

function sanitizeSpawnResult(method, command, result) {
  return {
    method,
    command,
    success: result?.status === 0,
    errno: result?.error?.errno ?? null,
    code: result?.error?.code ?? null,
    syscall: result?.error?.syscall ?? null,
    exitCode: result?.status ?? null,
    stderr: trunc(result?.stderr),
    stdout: trunc(result?.stdout),
    signal: result?.signal ?? null,
  };
}

function makeError(code, message, details) {
  const err = new Error(`${code}: ${message}`);
  err.code = code;
  err.details = { ...details, finalErrorCode: code };
  return err;
}

function resolveZoteroExe() {
  const envOverride = toPosix(process.env.ZOTERO_EXE || "");
  const candidate = envOverride || DEFAULT_ZOTERO_EXE;
  const source = envOverride ? "env" : "default";
  return { path: candidate, source, exists: fileExists(candidate) };
}

function getMcpUrl() {
  return process.env.ZOTERO_MCP_URL || process.env.MCP_URL || DEFAULT_MCP_URL;
}

function getExternalLauncherMode() {
  return String(process.env.ZOTERO_EXTERNAL_LAUNCHER || "").trim().toLowerCase();
}

function runPowerShellProbe(exe) {
  const script = "$p = Get-Process -Name zotero -ErrorAction SilentlyContinue; if ($p) { 'running' } else { 'stopped' }";
  const result = spawnSync(exe, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8" });
  const base = sanitizeSpawnResult(`process_check_${exe}`, `${exe} Get-Process zotero`, result);
  const out = String(result.stdout || "").trim().toLowerCase();
  if (out === "running") return { ok: true, running: true, method: exe, error: null, raw: base };
  if (out === "stopped") return { ok: true, running: false, method: exe, error: null, raw: base };
  return {
    ok: false,
    running: null,
    method: exe,
    error: result.error ? String(result.error) : (base.stderr || base.stdout || "unknown"),
    raw: base,
  };
}

function runTasklistProbe() {
  const result = spawnSync("tasklist", ["/FI", "IMAGENAME eq zotero.exe"], { encoding: "utf8" });
  const base = sanitizeSpawnResult("process_check_tasklist", "tasklist /FI IMAGENAME eq zotero.exe", result);
  const txt = `${result.stdout || ""}\n${result.stderr || ""}`.toLowerCase();
  if (txt.includes("zotero.exe")) return { ok: true, running: true, method: "tasklist", error: null, raw: base };
  if (txt.includes("no tasks are running") || txt.includes("没有运行的任务")) {
    return { ok: true, running: false, method: "tasklist", error: null, raw: base };
  }
  return {
    ok: false,
    running: null,
    method: "tasklist",
    error: result.error ? String(result.error) : (base.stderr || base.stdout || "unknown"),
    raw: base,
  };
}

function detectProcessWithFallback(diagnostics) {
  const methods = [
    () => runTasklistProbe(),
    () => runPowerShellProbe("powershell.exe"),
    () => runPowerShellProbe("pwsh"),
  ];
  let firstPermError = null;
  for (const run of methods) {
    const r = run();
    diagnostics.processChecks.push(r.raw);
    if (r.ok) {
      diagnostics.processCheckAvailable = true;
      diagnostics.processCheckMethod = r.method;
      diagnostics.processCheckError = null;
      return { available: true, running: r.running, blocked: false };
    }
    if (isPermissionDeniedText(r.error)) {
      firstPermError = firstPermError || r.error;
      continue;
    }
  }

  if (firstPermError) {
    diagnostics.processCheckAvailable = false;
    diagnostics.processCheckMethod = "none";
    diagnostics.processCheckError = firstPermError;
    return { available: false, running: null, blocked: true };
  }

  const errText = diagnostics.processChecks.map((x) => `${x.method}:${x.stderr || x.stdout || x.code || "unknown"}`).join(" | ");
  diagnostics.processCheckAvailable = false;
  diagnostics.processCheckMethod = "none";
  diagnostics.processCheckError = errText || "process detection failed";
  return { available: false, running: null, blocked: false };
}

function quoteForPowerShell(s) {
  return `'${String(s || "").replace(/'/g, "''")}'`;
}

function startWithPowerShell(exe, zoteroExe, workingDirectory) {
  const script = `Start-Process -FilePath ${quoteForPowerShell(zoteroExe)} -WorkingDirectory ${quoteForPowerShell(workingDirectory)}`;
  const result = spawnSync(exe, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8" });
  return sanitizeSpawnResult(`launch_${exe}`, `${exe} Start-Process <zotero>`, result);
}

async function startWithNodeSpawn(zoteroExe, workingDirectory) {
  const command = `spawn ${zoteroExe} detached`;
  return new Promise((resolve) => {
    let settled = false;
    try {
      const child = spawn(zoteroExe, [], {
        cwd: workingDirectory,
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });

      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        resolve({
          method: "launch_node_spawn",
          command,
          success: false,
          errno: error?.errno ?? null,
          code: error?.code ?? null,
          syscall: error?.syscall ?? null,
          exitCode: null,
          stderr: trunc(String(error || "")),
          stdout: "",
          signal: null,
        });
      });

      child.unref();
      setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({
          method: "launch_node_spawn",
          command,
          success: true,
          errno: null,
          code: null,
          syscall: null,
          exitCode: 0,
          stderr: "",
          stdout: "spawned",
          signal: null,
        });
      }, 500);
    } catch (error) {
      if (settled) return;
      settled = true;
      resolve({
        method: "launch_node_spawn",
        command,
        success: false,
        errno: error?.errno ?? null,
        code: error?.code ?? null,
        syscall: error?.syscall ?? null,
        exitCode: null,
        stderr: trunc(String(error || "")),
        stdout: "",
        signal: null,
      });
    }
  });
}

function allLaunchAttemptsPermissionDenied(attempts) {
  return attempts.length > 0 && attempts.every((a) => {
    const marker = `${a.code || ""} ${a.stderr || ""} ${a.stdout || ""}`;
    return isPermissionDeniedText(marker);
  });
}

export async function ensureZoteroMcpReady({
  mcpProbe,
  retries = parsePositiveInt(process.env.ZOTERO_MCP_READY_RETRIES, DEFAULT_RETRIES),
  intervalMs = parsePositiveInt(process.env.ZOTERO_MCP_READY_INTERVAL_MS, DEFAULT_INTERVAL_MS),
  postStartDelayMs = DEFAULT_POST_START_DELAY_MS,
  log = console.log,
  dependencies = {},
} = {}) {
  if (typeof mcpProbe !== "function") {
    throw makeError("PRECHECK_INVALID_ARGUMENT", "mcpProbe function is required", {});
  }

  const resolveZoteroExeFn = dependencies.resolveZoteroExe || resolveZoteroExe;
  const getExternalLauncherModeFn = dependencies.getExternalLauncherMode || getExternalLauncherMode;
  const detectProcessWithFallbackFn = dependencies.detectProcessWithFallback || detectProcessWithFallback;
  const startWithPowerShellFn = dependencies.startWithPowerShell || startWithPowerShell;
  const startWithNodeSpawnFn = dependencies.startWithNodeSpawn || startWithNodeSpawn;
  const allLaunchAttemptsPermissionDeniedFn = dependencies.allLaunchAttemptsPermissionDenied || allLaunchAttemptsPermissionDenied;
  const makeErrorFn = dependencies.makeError || makeError;

  const resolved = resolveZoteroExeFn();
  const zoteroExe = resolved.path;
  const workingDirectory = toPosix(path.dirname(zoteroExe));
  const mcpUrl = getMcpUrl();
  const diagnostics = {
    launchMode: "local_fallback_only",
    expectedExternalLauncher: "desktop_commander",
    expectedLauncherTool: "mcp__desktop_commander__.start_process",
    expectedLauncherCommand: DESKTOP_COMMANDER_FIXED_COMMAND,
    scheduledTaskName: SCHEDULED_TASK_NAME,
    zoteroExe,
    workingDirectory,
    mcpUrl,
    initialMcpReady: false,
    processCheckAvailable: null,
    processCheckMethod: null,
    processCheckError: null,
    processChecks: [],
    wasZoteroAlreadyRunning: null,
    launchAttempted: false,
    launchMethodsTried: [],
    waitAfterLaunchMs: 0,
    postLaunchMcpReady: false,
    lastProbeError: null,
    fallbackUsed: false,
    fallbackMethod: null,
  };
  const externalLauncher = getExternalLauncherModeFn();
  if (externalLauncher === EXTERNAL_LAUNCHER_DESKTOP_COMMANDER) {
    diagnostics.launchMode = "external_launcher_only";
  }

  try {
    await mcpProbe(0);
    diagnostics.initialMcpReady = true;
    diagnostics.postLaunchMcpReady = true;
    return {
      ok: true,
      attempts: 1,
      started_now: false,
      was_running: null,
      wait_after_start_ms: 0,
      diagnostics,
    };
  } catch (e) {
    diagnostics.initialMcpReady = false;
    diagnostics.lastProbeError = String(e?.message || e);
  }

  if (externalLauncher === EXTERNAL_LAUNCHER_DESKTOP_COMMANDER) {
    diagnostics.fallbackUsed = false;
    diagnostics.fallbackMethod = null;
    throw makeErrorFn(
      "MCP_NOT_READY_AFTER_EXTERNAL_LAUNCHER",
      "mcp not ready after external launcher handoff",
      diagnostics,
    );
  }

  if (!resolved.exists) {
    throw makeErrorFn("ZOTERO_EXE_NOT_FOUND", `zotero executable not found at ${zoteroExe}`, diagnostics);
  }

  const processState = detectProcessWithFallbackFn(diagnostics);
  if (!processState.available && !processState.blocked) {
    throw makeErrorFn("ZOTERO_PROCESS_DETECTION_FAILED", diagnostics.processCheckError || "unknown process detection failure", diagnostics);
  }
  if (processState.blocked) {
    log(`Process check blocked by permission policy: ${diagnostics.processCheckError}`);
  }
  diagnostics.wasZoteroAlreadyRunning = processState.running;

  let startedNow = false;
  if (!processState.available || processState.running !== true) {
    diagnostics.launchAttempted = true;
    const attempts = [];
    diagnostics.fallbackUsed = true;
    diagnostics.fallbackMethod = "powershell.exe";
    attempts.push(startWithPowerShellFn("powershell.exe", zoteroExe, workingDirectory));
    if (!attempts.some((a) => a.success)) {
      diagnostics.fallbackUsed = true;
      diagnostics.fallbackMethod = "node_spawn";
      attempts.push(await startWithNodeSpawnFn(zoteroExe, workingDirectory));
    }
    if (!attempts.some((a) => a.success)) {
      diagnostics.fallbackMethod = attempts[attempts.length - 1]?.method || diagnostics.fallbackMethod;
    }

    diagnostics.launchMethodsTried = attempts;

    const successAttempt = attempts.find((a) => a.success);
    if (!successAttempt) {
      if (allLaunchAttemptsPermissionDeniedFn(attempts)) {
        if (processState.blocked) {
          throw makeErrorFn(
            "CODEX_PERMISSION_INSUFFICIENT_FOR_ZOTERO_LAUNCH",
            "launch denied and process check also permission-blocked",
            {
              ...diagnostics,
              processCheckError: diagnostics.processCheckError || "EPERM",
            },
          );
        }
        throw makeErrorFn("CODEX_PERMISSION_INSUFFICIENT_FOR_ZOTERO_LAUNCH", "all launch methods denied by permission policy", diagnostics);
      }
      throw makeErrorFn("ZOTERO_LAUNCH_COMMAND_FAILED", "all launch methods failed", diagnostics);
    }

    startedNow = true;
    diagnostics.waitAfterLaunchMs = postStartDelayMs;
    log(`Waiting ${postStartDelayMs}ms for Zotero MCP plugin to load...`);
    await wait(postStartDelayMs);
  }

  let lastErr = null;
  for (let i = 1; i <= retries; i += 1) {
    try {
      await mcpProbe(i);
      diagnostics.postLaunchMcpReady = true;
      return {
        ok: true,
        attempts: i,
        started_now: startedNow,
        was_running: diagnostics.wasZoteroAlreadyRunning,
        wait_after_start_ms: diagnostics.waitAfterLaunchMs,
        diagnostics,
      };
    } catch (err) {
      lastErr = err;
      diagnostics.lastProbeError = String(err?.message || err);
      if (i < retries) await wait(intervalMs);
    }
  }

  const postProcess = detectProcessWithFallback(diagnostics);
  if (!postProcess.available && postProcess.blocked) {
    throw makeErrorFn(
      "MCP_NOT_READY_AFTER_ZOTERO_START",
      "mcp not ready and process detection unavailable due to EPERM",
      diagnostics,
    );
  }
  if (postProcess.available && postProcess.running === true) {
    const code = startedNow ? "MCP_NOT_READY_AFTER_ZOTERO_START" : "MCP_NOT_READY_WITH_RUNNING_ZOTERO";
    throw makeErrorFn(code, "zotero running but mcp not ready", diagnostics);
  }
  if (postProcess.available && postProcess.running === false) {
    throw makeErrorFn("ZOTERO_STARTED_BUT_NOT_RUNNING", "launch command returned but process not running after wait", diagnostics);
  }

  if (postProcess.blocked) {
    throw makeErrorFn("CODEX_PERMISSION_INSUFFICIENT_FOR_PROCESS_CHECK", diagnostics.processCheckError || "process check denied", diagnostics);
  }

  throw makeErrorFn(
    startedNow ? "MCP_NOT_READY_AFTER_ZOTERO_START" : "MCP_NOT_READY_WITH_RUNNING_ZOTERO",
    String(lastErr?.message || lastErr || "mcp probe failed"),
    diagnostics,
  );
}
