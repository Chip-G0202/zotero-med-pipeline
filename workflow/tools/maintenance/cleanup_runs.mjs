import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildRuntimeConfig } from "../lib/runtime_config.mjs";
import { runRetentionCleanup } from "../lib/runtime_housekeeping.mjs";

function argValue(argv, name) {
  const index = argv.indexOf(`--${name}`);
  const inline = argv.find((entry) => String(entry).startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : index >= 0 ? argv[index + 1] : "";
}

export function parseCleanupArgs(argv = process.argv.slice(2)) {
  const retentionRaw = argValue(argv, "retention-days");
  return {
    dryRun: argv.includes("--dry-run") || !argv.includes("--apply"),
    force: argv.includes("--force"),
    retentionDays: retentionRaw === "" ? 30 : Number(retentionRaw),
    runsDir: argValue(argv, "runs-dir"),
    json: argv.includes("--json"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseCleanupArgs(argv);
  if (args.help) {
    const result = { help: true, usage: "Usage: cleanup_runs.mjs [--dry-run|--apply] [--force] [--retention-days <n>] [--runs-dir <path>] [--json]" };
    console.log(result.usage);
    return result;
  }
  const runtime = dependencies.runtime || buildRuntimeConfig();
  const runRoot = path.resolve(args.runsDir || path.join(runtime.reviewRoot, "runs"));
  const custom = Boolean(args.runsDir);
  const runtimeRoot = custom ? path.dirname(runRoot) : runtime.researchRoot;
  const result = await (dependencies.runCleanup || runRetentionCleanup)({
    runtimeRoot,
    runRoot,
    allowedRoots: custom ? { runs: runRoot } : { runs: runRoot, research: runtime.researchRoot, review: runtime.reviewRoot },
    legacyRoots: custom ? [] : [path.join(runtime.researchRoot, "pipeline")],
    repoRoot: custom ? "" : runtime.repoRoot,
    currentRunId: "",
    dryRun: args.dryRun,
    force: args.force,
    config: { valid: Number.isSafeInteger(args.retentionDays) && args.retentionDays >= 0, enabled: true, retentionDays: args.retentionDays, warnings: Number.isSafeInteger(args.retentionDays) && args.retentionDays >= 0 ? [] : ["PAPERFLOW_RETENTION_DAYS_INVALID"] },
  });
  if (args.json) console.log(JSON.stringify(result));
  else console.log(`housekeeping: ${result.skipped ? result.reason : `${result.eligibleRuns} eligible, ${result.deletedRuns} deleted`}`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
