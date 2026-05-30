import { spawnSync } from "node:child_process";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_RETRIES = 10;
const DEFAULT_INTERVAL_MS = 3000;

function getOllamaUrl() {
  return process.env.OLLAMA_HOST || DEFAULT_OLLAMA_URL;
}

function isWindowsPlatform() {
  return process.platform === "win32";
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

function startOllamaWindows() {
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
    'Start-Process -WindowStyle Hidden ollama -ArgumentList "serve"'
  ], { encoding: "utf8" });
  return {
    method: "powershell_start_process",
    success: result?.status === 0,
    exitCode: result?.status ?? null,
    stderr: trunc(result?.stderr),
    stdout: trunc(result?.stdout),
  };
}

function startOllamaMacOS() {
  const result = spawnSync("open", ["-a", "Ollama"], { encoding: "utf8" });
  return {
    method: "open_macos",
    success: result?.status === 0,
    exitCode: result?.status ?? null,
    stderr: trunc(result?.stderr),
    stdout: trunc(result?.stdout),
  };
}

export async function ensureOllamaReady({
  retries = DEFAULT_RETRIES,
  intervalMs = DEFAULT_INTERVAL_MS,
  log = console.log,
  dependencies = {},
} = {}) {
  const ollamaUrl = dependencies.ollamaUrl || getOllamaUrl();
  const healthCheckFn = dependencies.healthCheck || healthCheck;
  const startOllamaFn = dependencies.startOllama || (isWindowsPlatform() ? startOllamaWindows : startOllamaMacOS);
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
