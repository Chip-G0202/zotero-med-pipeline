import { ensureZoteroMcpReady } from "./ensure_zotero_mcp_ready.mjs";
import { ensureOllamaReady } from "./ensure_ollama_ready.mjs";

const DEFAULT_ZOTERO_STARTUP_RETRIES = 45;
const DEFAULT_ZOTERO_STARTUP_INTERVAL_MS = 1000;
const DEFAULT_ZOTERO_POST_START_DELAY_MS = 5000;

function parsePositiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function trunc(s, max = 500) {
  const v = String(s || "").trim();
  return v.length <= max ? v : `${v.slice(0, max)}...`;
}

function containsPermissionDenied(value) {
  const s = JSON.stringify(value || {}).toLowerCase();
  return s.includes("eperm") || s.includes("access is denied") || s.includes("permission denied") || s.includes("operation not permitted");
}

export function classifyStartupFailure(details = {}) {
  if (containsPermissionDenied(details)) return "process_permission_denied";
  return "dependency_not_ready";
}

export function createStartupError(code, message, details = {}) {
  const err = new Error(`${code}: ${message}`);
  err.code = code;
  err.details = { ...details, finalErrorCode: code };
  return err;
}

function platformName(platform = process.platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return "linux";
}

/**
 * Restart a workflow process. In sandbox environments, system binary spawning
 * (taskkill, wmic, pkill) is not available. This function returns gracefully
 * with killed=false when restart is not possible, allowing the caller to
 * proceed with a fresh ensureReady() attempt.
 */
export async function restartWorkflowProcess(target, { platform = process.platform, spawnSyncFn } = {}) {
  const normalizedTarget = String(target || "").trim().toLowerCase();
  const family = platformName(platform);
  const commands = [];

  // In sandbox environments (Codex, CI, etc.), system binary spawning is blocked.
  // Return gracefully so the caller can retry ensureReady() with a fresh attempt.
  if (family === "windows") {
    // Windows: try taskkill to stop the target process, then allow caller to restart.
    // In sandbox environments taskkill may not be available; fall back to graceful skip.
    const killTarget = normalizedTarget === "zotero" ? "zotero.exe" : "ollama.exe";
    try {
      const syncFn = spawnSyncFn || (await import("node:child_process")).spawnSync;
      const result = syncFn("taskkill", ["/IM", killTarget, "/F"], { encoding: "utf8" });
      commands.push({
        method: `restart_${normalizedTarget}_taskkill`,
        command: `taskkill /IM ${killTarget} /F`,
        success: result?.status === 0,
        exitCode: result?.status ?? null,
        stdout: trunc(result?.stdout),
        stderr: trunc(result?.stderr),
        error: result?.error ? trunc(String(result.error)) : null,
        signal: result?.signal ?? null,
      });
    } catch (e) {
      commands.push({
        method: `restart_${normalizedTarget}_taskkill`,
        command: `taskkill /IM ${killTarget} /F`,
        success: false,
        exitCode: null,
        stdout: "",
        stderr: trunc(String(e)),
        error: trunc(String(e)),
        signal: null,
      });
    }
    // If taskkill was blocked (sandbox), log graceful skip
    const taskkillSucceeded = commands.some((x) => x.success);
    if (!taskkillSucceeded) {
      commands.push({
        method: `restart_${normalizedTarget}_skipped_windows_sandbox`,
        command: `skipped: ${normalizedTarget} restart fallback not available in sandbox`,
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "skipped: taskkill failed and no further restart methods available in sandbox",
        error: "EPERM: sandbox environment",
        signal: null,
      });
    }
  } else if (family === "macos") {
    const patterns = normalizedTarget === "zotero" ? ["Zotero"] : ["Ollama", "ollama"];
    for (const pattern of patterns) {
      try {
        const syncFn = spawnSyncFn || (await import("node:child_process")).spawnSync;
        const result = syncFn("pkill", ["-x", pattern], { encoding: "utf8" });
        commands.push({
          method: `restart_${normalizedTarget}_pkill`,
          command: `pkill -x ${pattern}`,
          success: result?.status === 0,
          exitCode: result?.status ?? null,
          stdout: trunc(result?.stdout),
          stderr: trunc(result?.stderr),
          error: result?.error ? trunc(String(result.error)) : null,
          signal: result?.signal ?? null,
        });
      } catch (e) {
        commands.push({
          method: `restart_${normalizedTarget}_pkill`,
          command: `pkill -x ${pattern}`,
          success: false,
          exitCode: null,
          stdout: "",
          stderr: trunc(String(e)),
          error: trunc(String(e)),
          signal: null,
        });
      }
    }
  } else {
    const pattern = normalizedTarget === "zotero" ? "zotero" : "ollama";
    try {
      const syncFn = spawnSyncFn || (await import("node:child_process")).spawnSync;
      const result = syncFn("pkill", ["-f", pattern], { encoding: "utf8" });
      commands.push({
        method: `restart_${normalizedTarget}_pkill`,
        command: `pkill -f ${pattern}`,
        success: result?.status === 0,
        exitCode: result?.status ?? null,
        stdout: trunc(result?.stdout),
        stderr: trunc(result?.stderr),
        error: result?.error ? trunc(String(result.error)) : null,
        signal: result?.signal ?? null,
      });
    } catch (e) {
      commands.push({
        method: `restart_${normalizedTarget}_pkill`,
        command: `pkill -f ${pattern}`,
        success: false,
        exitCode: null,
        stdout: "",
        stderr: trunc(String(e)),
        error: trunc(String(e)),
        signal: null,
      });
    }
  }

  const killed = commands.some((x) => x.success) || commands.some((x) => /not found|not running|没有找到|找不到/i.test(`${x.stdout}\n${x.stderr}`));
  return { target: normalizedTarget, killed, commands };
}

async function withLocalZoteroLauncher(fn) {
  const original = process.env.ZOTERO_EXTERNAL_LAUNCHER;
  delete process.env.ZOTERO_EXTERNAL_LAUNCHER;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.ZOTERO_EXTERNAL_LAUNCHER;
    else process.env.ZOTERO_EXTERNAL_LAUNCHER = original;
  }
}

function errorSummary(err) {
  return {
    code: err?.code || "UNKNOWN",
    message: String(err?.message || err),
    details: err?.details || null,
  };
}

async function ensureWithStrongRecovery({
  target,
  ensureReady,
  restartProcess,
}) {
  const attempts = [];
  const recovery = [];

  try {
    const result = await ensureReady();
    attempts.push({ layer: "primary", ok: true, result });
    return { ready: true, recovered: false, attempts, recovery, result };
  } catch (err) {
    attempts.push({ layer: "primary", ok: false, error: errorSummary(err) });
  }

  // Strong recovery: try restart, then retry ensureReady
  const restartResult = await restartProcess(target);
  recovery.push({ layer: "strong_recovery_restart", result: restartResult });

  try {
    const result = await ensureReady();
    attempts.push({ layer: "strong_recovery", ok: true, result });
    return { ready: true, recovered: true, attempts, recovery, result };
  } catch (err) {
    attempts.push({ layer: "strong_recovery", ok: false, error: errorSummary(err) });
    return { ready: false, recovered: true, attempts, recovery, result: null };
  }
}

export async function ensureWorkflowStartupReady({
  dependencies = {},
} = {}) {
  const ensureZoteroReady = dependencies.ensureZoteroMcpReady || ensureZoteroMcpReady;
  const ensureOllamaReadyFn = dependencies.ensureOllamaReady || ensureOllamaReady;
  const restartProcess = dependencies.restartProcess || restartWorkflowProcess;
  const zoteroReadyOptions = {
    retries: parsePositiveInt(process.env.WORKFLOW_STARTUP_ZOTERO_MCP_RETRIES, DEFAULT_ZOTERO_STARTUP_RETRIES),
    intervalMs: parsePositiveInt(process.env.WORKFLOW_STARTUP_ZOTERO_MCP_INTERVAL_MS, DEFAULT_ZOTERO_STARTUP_INTERVAL_MS),
    postStartDelayMs: parsePositiveInt(process.env.WORKFLOW_STARTUP_ZOTERO_POST_START_DELAY_MS, DEFAULT_ZOTERO_POST_START_DELAY_MS),
  };
  const startedAt = new Date().toISOString();
  const diagnostics = {
    ok: false,
    startedAt,
    finishedAt: null,
    platform: process.platform,
    strategy: "repo_bootstrap_with_strong_recovery",
    scheduledTaskRequired: false,
    desktopCommanderRequired: false,
    zoteroReadyOptions,
    zotero: { ready: null },
    ollama: { ready: null },
  };

  diagnostics.zotero = await ensureWithStrongRecovery({
    target: "zotero",
    ensureReady: () => withLocalZoteroLauncher(() => ensureZoteroReady(zoteroReadyOptions)),
    restartProcess,
  });

  if (!diagnostics.zotero.ready) {
    diagnostics.finishedAt = new Date().toISOString();
    diagnostics.failureClass = classifyStartupFailure(diagnostics);
    throw createStartupError("WORKFLOW_STARTUP_FAILED", "Zotero MCP was not ready after startup recovery", diagnostics);
  }

  diagnostics.ollama = await ensureWithStrongRecovery({
    target: "ollama",
    ensureReady: () => ensureOllamaReadyFn(),
    restartProcess,
  });

  if (!diagnostics.ollama.ready) {
    diagnostics.finishedAt = new Date().toISOString();
    diagnostics.failureClass = classifyStartupFailure(diagnostics);
    throw createStartupError("WORKFLOW_STARTUP_FAILED", "Ollama was not ready after startup recovery", diagnostics);
  }

  diagnostics.ok = true;
  diagnostics.failureClass = null;
  diagnostics.finishedAt = new Date().toISOString();
  return diagnostics;
}
