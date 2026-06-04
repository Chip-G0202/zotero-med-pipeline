import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_MCP_URL = "http://127.0.0.1:23120/mcp";
const DEFAULT_POST_START_DELAY_MS = 5000;
const DEFAULT_RETRIES = 15;
const DEFAULT_INTERVAL_MS = 2000;
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

function trunc(s, max = 300) {
  const v = String(s || "").trim();
  return v.length <= max ? v : `${v.slice(0, max)}...`;
}

function makeError(code, message, details) {
  const err = new Error(`${code}: ${message}`);
  err.code = code;
  err.details = { ...details, finalErrorCode: code };
  return err;
}

function isWindowsPlatform() {
  return process.platform === "win32";
}

function defaultZoteroExePath() {
  if (isWindowsPlatform()) return "D:/Zotero/zotero.exe";
  if (process.platform === "darwin") return "/Applications/Zotero.app/Contents/MacOS/zotero";
  return "zotero";
}

function platformLaunchStrategy() {
  if (isWindowsPlatform()) return "node_spawn";
  if (process.platform === "darwin") return "open_macos+node_spawn";
  return "node_spawn";
}

function fallbackMacAppPath() {
  return "/Applications/Zotero.app";
}

function resolveZoteroExe() {
  const envOverride = toPosix(process.env.ZOTERO_EXE || "");
  const source = envOverride ? "env" : "default";

  if (envOverride) {
    return { path: envOverride, source, exists: fileExists(envOverride) };
  }

  const primary = defaultZoteroExePath();
  if (fileExists(primary)) {
    return { path: primary, source, exists: true };
  }

  if (!isWindowsPlatform()) {
    const fallback = fallbackMacAppPath();
    if (fileExists(fallback)) {
      return { path: fallback, source, exists: true };
    }
  }

  return { path: primary, source, exists: false };
}

function getMcpUrl() {
  return process.env.ZOTERO_MCP_URL || process.env.MCP_URL || DEFAULT_MCP_URL;
}

function getExternalLauncherMode() {
  return String(process.env.ZOTERO_EXTERNAL_LAUNCHER || "").trim().toLowerCase();
}

/**
 * MCP HTTP probe — the ONLY process detection method.
 * No system binary spawning; works in any sandbox.
 */
async function mcpProbeHttp(mcpUrl, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "1.0" } } }),
      signal: controller.signal,
    });
    if (res.ok) return { ok: true, status: res.status };
    return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: null, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function startWithMacOpen(zoteroExe) {
  const isAppBundle = zoteroExe.toLowerCase().endsWith(".app") || zoteroExe.includes("/Zotero.app");
  const args = isAppBundle ? ["-a", zoteroExe] : ["-a", "Zotero"];
  try {
    const child = spawn("open", args, { detached: true, stdio: "ignore" });
    child.unref();
    return { method: "open_macos", command: `open ${args.join(" ")}`, success: true };
  } catch (error) {
    return { method: "open_macos", command: `open ${args.join(" ")}`, success: false, error: String(error) };
  }
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

export async function ensureZoteroMcpReady({
  retries = parsePositiveInt(process.env.ZOTERO_MCP_RETRIES, DEFAULT_RETRIES),
  intervalMs = parsePositiveInt(process.env.ZOTERO_MCP_INTERVAL_MS, DEFAULT_INTERVAL_MS),
  postStartDelayMs = parsePositiveInt(process.env.ZOTERO_MCP_POST_START_DELAY_MS, DEFAULT_POST_START_DELAY_MS),
  log = console.log,
  mcpProbe: mcpProbeTopLevel,    // backward-compat: some callers pass mcpProbe at top level
  dependencies = {},
} = {}) {
  const mcpUrl = dependencies.mcpUrl || getMcpUrl();
  const mcpProbeFn = mcpProbeTopLevel || dependencies.mcpProbe || ((attempt) => mcpProbeHttp(mcpUrl));
  const resolved = dependencies.resolvedZoteroExe || resolveZoteroExe();
  const zoteroExe = resolved.path;
  const workingDirectory = dependencies.workingDirectory || path.dirname(zoteroExe);
  const getExternalLauncherModeFn = dependencies.getExternalLauncherMode || getExternalLauncherMode;
  const startWithNodeSpawnFn = dependencies.startWithNodeSpawn || startWithNodeSpawn;
  const startWithMacOpenFn = dependencies.startWithMacOpen || startWithMacOpen;
  const makeErrorFn = dependencies.makeError || makeError;
  const waitFn = dependencies.wait || wait;

  const diagnostics = {
    mcpUrl,
    launchStrategy: platformLaunchStrategy(),
    initialMcpReady: false,
    launchMode: null,
    launchMethod: null,
    processCheckError: null,
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

  // Phase 1: MCP HTTP probe (the only process detection)
  try {
    await mcpProbeFn(0);
    diagnostics.initialMcpReady = true;
    diagnostics.postLaunchMcpReady = true;
    diagnostics.wasZoteroAlreadyRunning = true;
    return {
      ok: true,
      attempts: 1,
      started_now: false,
      was_running: true,
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
    const suggestion = isWindowsPlatform()
      ? "Set ZOTERO_EXE to the installed Zotero executable path, for example D:/Zotero/zotero.exe."
      : "Set ZOTERO_EXE to the installed Zotero executable path, for example /Applications/Zotero.app/Contents/MacOS/zotero.";
    throw makeErrorFn("ZOTERO_EXE_NOT_FOUND", `zotero executable not found at ${zoteroExe}. ${suggestion}`, diagnostics);
  }

  // Phase 2: Launch Zotero (skip process detection — go directly to launch)
  diagnostics.launchAttempted = true;
  diagnostics.wasZoteroAlreadyRunning = false;
  const attempts = [];

  if (isWindowsPlatform()) {
    // Windows: node spawn is the only reliable method in sandbox environments
    diagnostics.fallbackUsed = true;
    diagnostics.fallbackMethod = "node_spawn";
    attempts.push(await startWithNodeSpawnFn(zoteroExe, workingDirectory));
  } else if (process.platform === "darwin") {
    diagnostics.fallbackUsed = true;
    diagnostics.fallbackMethod = "open_macos";
    attempts.push(startWithMacOpenFn(zoteroExe));
    if (!attempts.some((a) => a.success)) {
      diagnostics.fallbackMethod = "node_spawn";
      attempts.push(await startWithNodeSpawnFn(zoteroExe, workingDirectory));
    }
  } else {
    diagnostics.fallbackUsed = true;
    diagnostics.fallbackMethod = "node_spawn";
    attempts.push(await startWithNodeSpawnFn(zoteroExe, workingDirectory));
  }

  diagnostics.launchMethodsTried = attempts;

  const successAttempt = attempts.find((a) => a.success);
  if (!successAttempt) {
    throw makeErrorFn("ZOTERO_LAUNCH_COMMAND_FAILED", "all launch methods failed", diagnostics);
  }

  diagnostics.waitAfterLaunchMs = postStartDelayMs;
  log(`Waiting ${postStartDelayMs}ms for Zotero MCP plugin to load...`);
  await waitFn(postStartDelayMs);

  // Phase 3: Poll MCP HTTP endpoint until ready
  let lastErr = null;
  for (let i = 1; i <= retries; i += 1) {
    try {
      await mcpProbeFn(i);
      diagnostics.postLaunchMcpReady = true;
      return {
        ok: true,
        attempts: i,
        started_now: true,
        was_running: false,
        wait_after_start_ms: diagnostics.waitAfterLaunchMs,
        diagnostics,
      };
    } catch (err) {
      lastErr = err;
      diagnostics.lastProbeError = String(err?.message || err);
      if (i < retries) await waitFn(intervalMs);
    }
  }

  // MCP never came online after launch + retries
  throw makeErrorFn(
    "MCP_NOT_READY_AFTER_ZOTERO_START",
    `mcp not ready after ${retries} retries (${retries * intervalMs}ms)`,
    diagnostics,
  );
}
