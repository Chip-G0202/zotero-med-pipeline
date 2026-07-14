import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { wait } from "./async_utils.mjs";

const DEFAULT_POST_START_DELAY_MS = 5000;

function isWindowsPlatform(platform) {
  return (platform || process.platform) === "win32";
}

function quotePowerShellSingleQuoted(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))];
}

function trunc(value, max = 500) {
  const s = String(value || "").trim();
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

function windowsZoteroCandidatePaths(env = process.env) {
  return uniqueNonEmpty([
    env.ZOTERO_EXE,
    env.ProgramFiles ? path.join(env.ProgramFiles, "Zotero", "zotero.exe") : "",
    env["ProgramFiles(x86)"] ? path.join(env["ProgramFiles(x86)"], "Zotero", "zotero.exe") : "",
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs", "Zotero", "zotero.exe") : "",
    "D:/Zotero/zotero.exe",
    "C:/Zotero/zotero.exe",
  ]);
}

function attemptedZoteroLaunchSources({ platform = process.platform, env = process.env } = {}) {
  if (!isWindowsPlatform(platform)) return ["system app command", "bare zotero command"];
  return [
    "ZOTERO_EXE",
    "ProgramFiles/Zotero/zotero.exe",
    "ProgramFiles(x86)/Zotero/zotero.exe",
    "LOCALAPPDATA/Programs/Zotero/zotero.exe",
    "D:/Zotero/zotero.exe",
    "C:/Zotero/zotero.exe",
    "where.exe zotero.exe",
    "bare zotero command",
  ].filter((source) => source !== "ZOTERO_EXE" || String(env.ZOTERO_EXE || "").trim());
}

export function resolveZoteroLaunchTarget({
  platform = process.platform,
  zoteroExe = "",
  env = process.env,
  existsSync = fs.existsSync,
  execFileSyncFn = execFileSync,
} = {}) {
  const explicit = String(zoteroExe || env.ZOTERO_EXE || "").trim();
  if (explicit) return { target: explicit, source: "explicit", exists: existsSync(explicit) };
  if (!isWindowsPlatform(platform)) return { target: "zotero", source: "default_command", exists: null };

  for (const candidate of windowsZoteroCandidatePaths(env)) {
    if (existsSync(candidate)) return { target: candidate, source: "common_install_path", exists: true };
  }

  try {
    const found = String(execFileSyncFn("where.exe", ["zotero.exe"], { encoding: "utf8" }) || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (found) return { target: found, source: "path_zotero_exe", exists: true };
  } catch {
    // Fall through to the historical command-name fallback.
  }

  return { target: "zotero", source: "bare_command_fallback", exists: null };
}

function launchExecUsingSystemCommand(platform, zoteroExe = "", dependencies = {}) {
  platform = platform || process.platform;
  let command, args;
  let resolvedTarget = null;
  if (isWindowsPlatform(platform)) {
    resolvedTarget = resolveZoteroLaunchTarget({
      platform,
      zoteroExe,
      env: dependencies.env || process.env,
      existsSync: dependencies.existsSync || fs.existsSync,
      execFileSyncFn: dependencies.execFileSync || execFileSync,
    });
    const target = quotePowerShellSingleQuoted(resolvedTarget.target);
    const workingDirectory = path.isAbsolute(resolvedTarget.target)
      ? quotePowerShellSingleQuoted(path.dirname(resolvedTarget.target))
      : "";
    command = "powershell";
    args = [
      "-NoProfile",
      "-Command",
      workingDirectory
        ? `Start-Process -FilePath ${target} -WorkingDirectory ${workingDirectory} -WindowStyle Hidden`
        : `Start-Process -FilePath ${target} -WindowStyle Hidden`,
    ];
  } else if (platform === "darwin") {
    command = "open";
    args = ["-a", "Zotero"];
  } else {
    command = "zotero";
    args = [];
  }
  return { command, args, resolvedTarget };
}

export function platformLaunchStrategy(platform) {
  platform = platform || process.platform;
  if (isWindowsPlatform(platform)) return "system_command";
  if (platform === "darwin") return "system_command";
  return "node_spawn";
}

export function detectZoteroDesktopProcess({
  platform = process.platform,
  dependencies = {},
} = {}) {
  const spawnSyncFn = dependencies.spawnSync || spawnSync;
  try {
    if (isWindowsPlatform(platform)) {
      const result = spawnSyncFn("tasklist", ["/FI", "IMAGENAME eq zotero.exe"], { encoding: "utf8" });
      const output = `${result?.stdout || ""}\n${result?.stderr || ""}`;
      return {
        running: /\bzotero\.exe\b/i.test(output),
        method: "tasklist",
        exitCode: result?.status ?? null,
        error: result?.error ? trunc(result.error.message || String(result.error)) : null,
      };
    }

    const result = spawnSyncFn("ps", ["-A", "-o", "comm="], { encoding: "utf8" });
    const names = String(result?.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);
    const running = platform === "darwin"
      ? names.some((name) => name === "zotero" || name.endsWith("/zotero"))
      : names.some((name) => name === "zotero" || name.endsWith("/zotero"));
    return {
      running,
      method: "ps",
      exitCode: result?.status ?? null,
      error: result?.error ? trunc(result.error.message || String(result.error)) : null,
    };
  } catch (error) {
    return {
      running: false,
      method: isWindowsPlatform(platform) ? "tasklist" : "ps",
      exitCode: null,
      error: trunc(error?.message || String(error)),
    };
  }
}

export async function launchZoteroDesktop(opts) {
  opts = opts || {};
  const platform = opts.platform || process.platform;
  const postStartDelayMs = opts.postStartDelayMs !== undefined ? opts.postStartDelayMs : DEFAULT_POST_START_DELAY_MS;
  const dependencies = opts.dependencies || {};
  const log = opts.log || console.log;
  const zoteroExe = String(opts.zoteroExe || opts.resolvedExecutable?.path || "").trim();

  const diagnostics = {
    launchStrategy: platformLaunchStrategy(platform),
    launchAttempted: false,
    launchMethodsTried: [],
    waitAfterLaunchMs: 0,
    fallbackUsed: false,
    fallbackMethod: null,
    processCheck: null,
    alreadyRunning: false,
  };

  const detectProcess = dependencies.detectDesktopProcess || detectZoteroDesktopProcess;
  diagnostics.processCheck = detectProcess({ platform, dependencies });
  if (diagnostics.processCheck?.running) {
    diagnostics.alreadyRunning = true;
    return {
      ok: true,
      started_now: false,
      was_running: true,
      wait_after_start_ms: 0,
      diagnostics,
    };
  }

  diagnostics.launchAttempted = true;
  const attempts = [];
  const spawnFn = dependencies.spawn || spawn;

  const startWithDirectExecutableFn = dependencies.startWithDirectExecutable || async function() {
    if (!isWindowsPlatform(platform)) {
      return { method: `direct_executable_${platform}`, success: false, skipped: true, error: "direct executable launch is Windows-only" };
    }
    const resolvedTarget = resolveZoteroLaunchTarget({
      platform,
      zoteroExe,
      env: dependencies.env || process.env,
      existsSync: dependencies.existsSync || fs.existsSync,
      execFileSyncFn: dependencies.execFileSync || execFileSync,
    });
    if (!path.isAbsolute(resolvedTarget.target)) {
      return {
        method: "direct_executable_win32",
        command: resolvedTarget.target,
        resolvedTarget,
        success: false,
        skipped: true,
        error: "resolved target is not an absolute executable path",
      };
    }
    try {
      const child = spawnFn(resolvedTarget.target, [], {
        cwd: path.dirname(resolvedTarget.target),
        detached: true,
        stdio: "ignore",
      });
      const spawnResult = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        child.once?.("error", (error) => finish({ success: false, error: String(error?.message || error) }));
        child.once?.("spawn", () => finish({ success: true }));
        setTimeout(() => finish({ success: true }), 100);
      });
      if (spawnResult.success) child.unref?.();
      return {
        method: "direct_executable_win32",
        command: resolvedTarget.target,
        resolvedTarget,
        success: Boolean(spawnResult.success),
        error: spawnResult.error || null,
      };
    } catch (error) {
      return {
        method: "direct_executable_win32",
        command: resolvedTarget.target,
        resolvedTarget,
        success: false,
        error: String(error?.message || error),
      };
    }
  };

  const startWithSystemCommandFn = dependencies.startWithSystemCommand || async function() {
    const info = launchExecUsingSystemCommand(platform, zoteroExe, dependencies);
    try {
      const child = spawnFn(info.command, info.args, { detached: true, stdio: "ignore" });
      const spawnResult = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        child.once?.("error", (error) => finish({ success: false, error: String(error?.message || error) }));
        child.once?.("spawn", () => finish({ success: true }));
        setTimeout(() => finish({ success: true }), 100);
      });
      if (spawnResult.success) child.unref?.();
      return {
        method: `system_command_${platform}`,
        command: `${info.command} ${info.args.join(" ")}`,
        resolvedTarget: info.resolvedTarget,
        success: Boolean(spawnResult.success),
        error: spawnResult.error || null,
      };
    } catch (error) {
      return {
        method: `system_command_${platform}`,
        command: `${info.command} ${info.args.join(" ")}`,
        resolvedTarget: info.resolvedTarget,
        success: false,
        error: String(error),
      };
    }
  };

  diagnostics.fallbackUsed = true;
  diagnostics.fallbackMethod = "system_command";
  if (isWindowsPlatform(platform) && !dependencies.startWithSystemCommand) {
    attempts.push(await startWithDirectExecutableFn());
  }
  if (!attempts.some((a) => a.success)) {
    attempts.push(await startWithSystemCommandFn());
  }

  diagnostics.launchMethodsTried = attempts;
  const successAttempt = attempts.find(a => a.success);
  if (!successAttempt) {
    return {
      ok: false,
      started_now: false,
      diagnostics,
      errorCode: "ZOTERO_LAUNCH_COMMAND_FAILED",
      error: `all launch methods failed; tried ${attemptedZoteroLaunchSources({ platform, env: dependencies.env || process.env }).join(", ")}. Set ZOTERO_EXE to the full Zotero executable path if auto-discovery fails.`,
    };
  }

  diagnostics.waitAfterLaunchMs = postStartDelayMs;
  if (postStartDelayMs > 0) {
    log(`Waiting ${postStartDelayMs}ms for Zotero desktop to start...`);
    await (dependencies.wait || wait)(postStartDelayMs);
  }

  const postLaunchProcessCheck = detectProcess({ platform, dependencies });
  diagnostics.postLaunchProcessCheck = postLaunchProcessCheck;
  if (!postLaunchProcessCheck?.running) {
    diagnostics.processDetectionAfterLaunchUnreliable = true;
    diagnostics.processDetectionWarning = "launch_command_completed_but_process_not_detected_continue_to_backend_probe";
  }

  return {
    ok: true,
    started_now: true,
    wait_after_start_ms: postStartDelayMs,
    diagnostics,
  };
}
