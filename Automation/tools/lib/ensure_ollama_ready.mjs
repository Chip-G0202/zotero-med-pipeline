import { spawn } from "node:child_process";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_RETRIES = 10;
const DEFAULT_INTERVAL_MS = 3000;

function getOllamaUrl() {
  return process.env.OLLAMA_HOST || DEFAULT_OLLAMA_URL;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function healthCheck(ollamaUrl) {
  const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
  const json = await res.json();
  return { ok: true, models: json?.models || [] };
}

/**
 * Start Ollama via node spawn (detached) — works in sandbox environments.
 * No system binary spawning (no powershell, no cmd).
 */
function startOllamaNodeSpawn() {
  try {
    const child = spawn("ollama", ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return {
      method: "node_spawn_ollama_serve",
      success: true,
      exitCode: null,
      stderr: "",
      stdout: "detached ollama serve",
    };
  } catch (error) {
    return {
      method: "node_spawn_ollama_serve",
      success: false,
      exitCode: null,
      stderr: trunc(String(error)),
      stdout: "",
    };
  }
}

function startOllamaMacOS() {
  try {
    const child = spawn("open", ["-a", "Ollama"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return {
      method: "open_macos",
      success: true,
      exitCode: null,
      stderr: "",
      stdout: "open -a Ollama",
    };
  } catch (error) {
    return {
      method: "open_macos",
      success: false,
      exitCode: null,
      stderr: trunc(String(error)),
      stdout: "",
    };
  }
}

function detectPlatform() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

export async function ensureOllamaReady({
  retries = DEFAULT_RETRIES,
  intervalMs = DEFAULT_INTERVAL_MS,
  log = console.log,
  dependencies = {},
} = {}) {
  const ollamaUrl = dependencies.ollamaUrl || getOllamaUrl();
  const healthCheckFn = dependencies.healthCheck || healthCheck;
  const startOllamaFn = dependencies.startOllama || (
    detectPlatform() === "macos" ? startOllamaMacOS : startOllamaNodeSpawn
  );
  const waitFn = dependencies.wait || wait;

  const diagnostics = {
    platform: process.platform,
    ollamaUrl,
    initialReady: false,
    launchAttempted: false,
    launchMethod: null,
    launchSuccess: null,
    attempts: 0,
    lastError: null,
  };

  // Phase 1: Check if already ready
  try {
    const result = await healthCheckFn(ollamaUrl);
    diagnostics.initialReady = true;
    return {
      ok: true,
      started_now: false,
      attempts: 1,
      diagnostics,
      models: result.models,
    };
  } catch (e) {
    diagnostics.lastError = String(e?.message || e);
  }

  // Phase 2: Start Ollama
  diagnostics.launchAttempted = true;
  const launchResult = startOllamaFn();
  diagnostics.launchMethod = launchResult.method;
  diagnostics.launchSuccess = launchResult.success;

  if (!launchResult.success) {
    throw makeError("OLLAMA_START_FAILED", `Failed to start Ollama via ${launchResult.method}`, {
      ...diagnostics,
      launchResult,
    });
  }

  // Phase 3: Poll until ready
  for (let i = 1; i <= retries; i++) {
    diagnostics.attempts = i;
    try {
      const result = await healthCheckFn(ollamaUrl);
      return {
        ok: true,
        started_now: true,
        attempts: i,
        diagnostics,
        models: result.models,
      };
    } catch (e) {
      diagnostics.lastError = String(e?.message || e);
      if (i < retries) await waitFn(intervalMs);
    }
  }

  throw makeError("OLLAMA_NOT_REACHABLE", `Ollama not reachable after ${retries} attempts`, diagnostics);
}
