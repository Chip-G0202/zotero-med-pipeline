import { spawn } from "node:child_process";

import { EXIT_CODES, MODES } from "./constants.mjs";

export function buildLauncherInvocation({ mode, runnerPath, argv = process.argv.slice(2), nodePath = process.execPath } = {}) {
  if (!MODES.has(mode)) throw new Error(`RUNNER_MODE_INVALID:${mode || "missing"}`);
  if (!String(runnerPath || "").trim()) throw new Error("RUNNER_PATH_REQUIRED");
  if (argv.some((value) => value === "--mode" || String(value).startsWith("--mode="))) {
    throw new Error("LAUNCHER_MODE_OVERRIDE_FORBIDDEN");
  }
  return {
    command: nodePath,
    args: [runnerPath, "--mode", mode, "--fixed-mode", ...argv],
    options: { shell: false, stdio: "inherit" },
  };
}
export function runFixedModeLauncher(options = {}, dependencies = {}) {
  const invocation = buildLauncherInvocation(options);
  const spawnImpl = dependencies.spawnImpl || spawn;
  return new Promise((resolve, reject) => {
    const child = spawnImpl(invocation.command, invocation.args, invocation.options);
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(signal ? EXIT_CODES.canceled : Number(code ?? EXIT_CODES.pipeline)));
  });
}
