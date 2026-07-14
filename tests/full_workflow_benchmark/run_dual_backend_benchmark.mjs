import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureOutputInventory,
  captureState,
  compareOutputInventories,
  restoreState,
  verifyState,
} from "../helpers/benchmark_state.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const runId = `dual-${Date.now()}`;
const runDir = path.join(repoRoot, "tests", "runs", runId);
const prestateDir = path.join(runDir, "prestate");
const lockPath = path.join(repoRoot, "tests", "runs", ".dual-backend-benchmark.lock");

async function runNode(script, args = [], env = {}) {
  const started = performance.now();
  const child = spawn(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on("close", resolve));
  return { code, ms: performance.now() - started, stdout: stdout.slice(-4000), stderr: stderr.slice(-2000) };
}

async function stopDesktop() {
  const command = "Get-Process Zotero -ErrorAction SilentlyContinue | Stop-Process -Force";
  return runNode(path.join(here, "powershell_bridge.mjs"), [command]);
}

await fs.mkdir(runDir, { recursive: true });
const lock = await fs.open(lockPath, "wx");
const suiteStarted = performance.now();
let report = { runId, startedAt: new Date().toISOString(), restore: {}, backends: {} };
try {
  const prestate = await captureState(repoRoot, prestateDir);
  const protectedOutputBefore = await captureOutputInventory(repoRoot);
  const gitStatusBefore = (await runNode(path.join(here, "git_status.mjs"))).stdout;
  await fs.writeFile(path.join(runDir, "git-status-before.txt"), gitStatusBefore);
  await fs.writeFile(path.join(prestateDir, "protected-output-inventory.json"), JSON.stringify(protectedOutputBefore, null, 2));
  const capture = await runNode(path.join(here, "capture_input.mjs"), [`--run-dir=${runDir}`]);
  report.inputCapture = capture;
  if (capture.code !== 0) throw new Error(`input_capture_failed:${capture.stderr}`);
  const captureRestoreStarted = performance.now();
  const captureRestored = await restoreState(repoRoot, prestateDir);
  const captureVerified = await verifyState(repoRoot, prestate);
  report.restore.inputCapture = { restored: captureRestored, verified: captureVerified, ms: performance.now() - captureRestoreStarted };
  if (!captureRestored.ok || !captureVerified.ok) throw new Error("input_capture_restore_failed");
  const fixtureRoot = path.join(runDir, "input_snapshot");

  for (const backend of ["desktop", "web_api"]) {
    const baseline = await restoreState(repoRoot, prestateDir);
    if (!baseline.ok) throw new Error(`${backend}_baseline_restore_failed`);
    if (backend === "web_api") {
      const stopped = await stopDesktop();
      if (stopped.code !== 0) throw new Error("desktop_stop_before_web_failed");
    }
    const backendDir = path.join(runDir, backend);
    const result = await runNode(path.join(here, "run_backend.mjs"), [
      `--backend=${backend}`,
      `--run-id=${runId}-${backend}`,
      `--run-dir=${backendDir}`,
      `--fixture-root=${fixtureRoot}`,
    ]);
    report.backends[backend] = { process: result };
    const resultPath = path.join(backendDir, "result.json");
    try { report.backends[backend].result = JSON.parse(await fs.readFile(resultPath, "utf8")); } catch {}
    const restoreStarted = performance.now();
    const restored = await restoreState(repoRoot, prestateDir);
    const verified = await verifyState(repoRoot, prestate);
    const protectedOutputAfter = await captureOutputInventory(repoRoot);
    const outputVerified = compareOutputInventories(protectedOutputBefore, protectedOutputAfter);
    report.restore[backend] = {
      restored,
      verified,
      pendingDryRun: verified.failures.length,
      protectedOutput: outputVerified,
      ms: performance.now() - restoreStarted,
    };
    if (result.code !== 0 || !report.backends[backend].result?.cleanup?.ok || !restored.ok || !verified.ok) {
      throw new Error(`${backend}_run_or_restore_failed`);
    }
    if (!outputVerified.ok) throw new Error(`${backend}_protected_output_changed`);
  }

  report.status = "completed";
  report.finishedAt = new Date().toISOString();
  report.totalWallMs = performance.now() - suiteStarted;
  const metadata = JSON.parse(await fs.readFile(path.join(runDir, "input_snapshot", "metadata.json"), "utf8"));
  const jsonPath = path.join(runDir, "benchmark-report.json");
  await fs.writeFile(jsonPath, JSON.stringify({ ...report, input: metadata }, null, 2));
  const lines = [
    `# Dual-backend workflow benchmark ${runId}`,
    "",
    `Input: ${metadata.replayCandidates} items (complete load), capture ${metadata.captureMs.toFixed(1)} ms, SHA-256 ${metadata.sha256}, config ${metadata.configSha256}`,
    "",
    "| Backend | Stage1 | Backend ready | Stage2 | Stage3 | Stage4 | Workflow | Wall | Requests |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...["desktop", "web_api"].map((name) => {
      const value = report.backends[name].result;
      return `| ${name} | ${value.stages.stage1 || 0} | ${value.stages.zotero_backend_ready || 0} | ${value.stages.stage2_writeback || 0} | ${value.stages.stage3_translation || 0} | ${value.stages.stage4_exports || 0} | ${value.workflowMs || 0} | ${value.wallMs.toFixed(1)} | ${value.requests.total || 0} |`;
    }),
    "",
    "## Top operations",
    ...["desktop", "web_api"].flatMap((name) => {
      const value = report.backends[name].result;
      const timings = value.details?.translation?.timings || {};
      const operations = [
        ["Stage 2", value.stages.stage2_writeback || 0],
        ["collection setup", value.details?.stage2?.collection_setup_ms || 0],
        ["item writeback", value.details?.stage2?.item_writeback_ms || 0],
        ["collection attach", value.details?.stage2?.collection_attach_duration || 0],
        ["translation", timings.translation_ms || 0],
        ["metadata write", timings.metadata_write_ms || 0],
      ].sort((a, b) => b[1] - a[1]).slice(0, 5);
      return [`### ${name}`, ...operations.map(([operation, ms]) => `- ${operation}: ${ms} ms`)];
    }),
    "",
    "This single complete-load run is descriptive, not a general performance claim.",
  ];
  await fs.writeFile(path.join(runDir, "benchmark-report.md"), `${lines.join("\n")}\n`);
  await fs.writeFile(path.join(runDir, "proposed-agents-update.md"), [
    "# Proposed AGENTS.md addition",
    "",
    "- Put benchmark scripts, fixtures, snapshots, manifests, logs, and reports under repository-root `tests/`.",
    "- Real integration tests use an independent run id, exact resource keys, persistent recovery, and restore verification.",
    "- Snapshot cache/state existence and SHA-256 before execution; restore atomically and verify afterward.",
    "- Multi-backend comparisons use identical input, configuration, translation mode, cache baseline, and timing boundaries.",
    "- Do not start the next backend unless cleanup and restore for the previous backend pass.",
    "",
  ].join("\n"));
  console.log(JSON.stringify({ runId, runDir, status: report.status }));
} catch (error) {
  report.status = "failed";
  report.error = String(error?.message || error);
  report.finishedAt = new Date().toISOString();
  report.totalWallMs = performance.now() - suiteStarted;
  await fs.writeFile(path.join(runDir, "benchmark-report.json"), JSON.stringify(report, null, 2));
  console.error(report.error);
  process.exitCode = 1;
} finally {
  const finalRestore = await restoreState(repoRoot, prestateDir).catch((error) => ({ ok: false, failures: [String(error?.message || error)] }));
  report.finalRestore = finalRestore;
  await stopDesktop().catch(() => {});
  const gitStatusAfter = (await runNode(path.join(here, "git_status.mjs"))).stdout;
  await fs.writeFile(path.join(runDir, "git-status-after.txt"), gitStatusAfter).catch(() => {});
  await fs.writeFile(path.join(runDir, "benchmark-report.json"), JSON.stringify(report, null, 2)).catch(() => {});
  await lock.close();
  await fs.rm(lockPath, { force: true });
}
