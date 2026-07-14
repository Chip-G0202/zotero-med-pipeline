import { fileURLToPath, pathToFileURL } from "node:url";

import { runFixedModeLauncher } from "../../../workflow/tools/runner/launcher.mjs";

export const MODE = "web";
export const RUNNER_PATH = fileURLToPath(new URL("../../../workflow/tools/runner/main.mjs", import.meta.url));

export function main(argv = process.argv.slice(2), dependencies = {}) {
  return runFixedModeLauncher({ mode: MODE, runnerPath: RUNNER_PATH, argv }, dependencies);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main().then((code) => { process.exitCode = code; });
