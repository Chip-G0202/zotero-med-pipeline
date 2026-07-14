import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runStage2WritebackBenchmark } from "./stage2_writeback_benchmark.mjs";
import { runStage2WritebackBenchmark as runStage2ApiWritebackBenchmark } from "./stage2_api_writeback_benchmark.mjs";

test("stage2 writeback benchmark builds isolated replay input and dry-run report", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-bench-test-"));
  const inputFile = path.join(dir, "input.json");
  await fs.writeFile(inputFile, JSON.stringify([
    { title: "Bench A", grade: "A", final_grade: "A", source_channel: "rss" },
    { title: "Bench B", grade: "B", final_grade: "B", source_channel: "database" },
  ]), "utf8");

  const report = await runStage2WritebackBenchmark([
    "node",
    "workflow/tests/stage2_writeback_benchmark.mjs",
    `--input-file=${inputFile}`,
    `--output-root=${dir}`,
    "--limit=1",
    "--run-id=bench-test",
  ]);

  assert.equal(report.run_id, "bench-test");
  assert.equal(report.real_run, false);
  assert.equal(report.item_count, 1);
  assert.match(report.pipeline_dir, /stage2-bench-test/);
  assert.match(report.pipeline_dir, /99\.1\.2/);
  const replayItems = JSON.parse(await fs.readFile(report.replay_input_path, "utf8"));
  assert.equal(replayItems.length, 1);
  const saved = JSON.parse(await fs.readFile(report.report_path, "utf8"));
  assert.equal(saved.result.status, "completed");
  assert.equal(saved.result.created, 0);
});

test("stage2 writeback benchmark requires explicit launch authorization", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-bench-launch-"));
  const inputFile = path.join(dir, "input.json");
  await fs.writeFile(inputFile, "[]", "utf8");
  const launches = [];
  const run = async (argv) => runStage2WritebackBenchmark(argv, {
    runStage2: async ({ launchDesktop }) => {
      launches.push(launchDesktop);
      return { writeback_items: [] };
    },
  });
  const base = ["node", "workflow/tests/stage2_writeback_benchmark.mjs", `--input-file=${inputFile}`, `--output-root=${dir}`, "--real-run"];

  const defaultReport = await run([...base, "--run-id=no-launch"]);
  const allowedReport = await run([...base, "--run-id=allow-launch", "--allow-launch"]);

  assert.deepEqual(launches, [false, true]);
  assert.equal(defaultReport.desktop_launch_authorized, false);
  assert.equal(allowedReport.desktop_launch_authorized, true);
  await assert.rejects(() => run([...base, "--run-id=invalid-launch", "--allow-launch=maybe"]), /--allow-launch/);
});

test("stage2 desktop benchmark stops before Stage2 when recovery initialization fails", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-desktop-recovery-init-"));
  const inputFile = path.join(dir, "input.json");
  await fs.writeFile(inputFile, "[]", "utf8");
  let runnerCalled = false;
  await assert.rejects(
    () => runStage2WritebackBenchmark([
      "node", "workflow/tests/stage2_writeback_benchmark.mjs", `--input-file=${inputFile}`, `--output-root=${dir}`,
      "--real-run", "--date=2098-12-31T00:00:00.000Z", "--run-id=init-failure",
    ], {
      recoveryStoreFactory: async () => { throw new Error("recovery_init_failed"); },
      runStage2: async () => { runnerCalled = true; },
    }),
    /recovery_init_failed/,
  );
  assert.equal(runnerCalled, false);
});

test("stage2 desktop benchmark retains incremental recovery after a later failure", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-desktop-recovery-failure-"));
  const inputFile = path.join(dir, "input.json");
  await fs.writeFile(inputFile, "[]", "utf8");
  const runId = "ownership-failure";
  await assert.rejects(
    () => runStage2WritebackBenchmark([
      "node", "workflow/tests/stage2_writeback_benchmark.mjs", `--input-file=${inputFile}`, `--output-root=${dir}`,
      "--real-run", "--date=2098-12-31T00:00:00.000Z", `--run-id=${runId}`,
    ], {
      runCleanup: async () => ({ ok: true }),
      runStage2: async ({ recovery }) => {
        await recovery.recordCollections([
          { key: "CREATED", created: true, role: "source" },
          { key: "REUSED", created: false, role: "source" },
          { key: "ROOT", created: true, role: "root_pool", name: "文献池" },
          { key: "UNKNOWN", role: "grade" },
        ]);
        await recovery.recordItems(["I1"]);
        throw new Error("stage_failed");
      },
    }),
    /stage_failed/,
  );
  const pipelineDir = path.join(dir, "review_results", "pipeline", "98.12.31");
  const recovery = JSON.parse(await fs.readFile(path.join(pipelineDir, `stage2_recovery_${runId}.json`), "utf8"));
  assert.equal(recovery.state, "failed");
  assert.deepEqual(recovery.createdItemKeys, ["I1"]);
  assert.equal(recovery.createdCollections.find((entry) => entry.key === "CREATED").ownership, "created");
  assert.equal(recovery.createdCollections.find((entry) => entry.key === "REUSED").ownership, "reused");
  assert.equal(recovery.createdCollections.find((entry) => entry.key === "UNKNOWN").ownership, "unknown");
  const cleanup = JSON.parse(await fs.readFile(path.join(pipelineDir, "stage2_smoke_cleanup_manifest.json"), "utf8"));
  assert.deepEqual(cleanup.createdItemKeys, ["I1"]);
  assert.equal(cleanup.createdCollections.some((entry) => entry.key === "ROOT"), true);
});

test("stage2 desktop benchmark keeps recovery state when final manifest writing fails", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-desktop-recovery-final-"));
  const inputFile = path.join(dir, "input.json");
  await fs.writeFile(inputFile, "[]", "utf8");
  const runId = "final-manifest-failure";
  await assert.rejects(
    () => runStage2WritebackBenchmark([
      "node", "workflow/tests/stage2_writeback_benchmark.mjs", `--input-file=${inputFile}`, `--output-root=${dir}`,
      "--real-run", "--date=2098-12-31T00:00:00.000Z", `--run-id=${runId}`,
    ], {
      runCleanup: async () => ({ ok: true }),
      runStage2: async ({ recovery }) => {
        await recovery.recordItems(["I1"]);
        return { writeback_items: [] };
      },
      writeCleanupManifest: async () => { throw new Error("final_manifest_write_failed"); },
    }),
    /final_manifest_write_failed/,
  );
  const filePath = path.join(dir, "review_results", "pipeline", "98.12.31", `stage2_recovery_${runId}.json`);
  const recovery = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.deepEqual(recovery.createdItemKeys, ["I1"]);
  assert.equal(recovery.cleanupEligible, true);
});

test("stage2 desktop benchmark cleans by default and only exact true keeps artifacts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-desktop-cleanup-"));
  const inputFile = path.join(dir, "input.json");
  await fs.writeFile(inputFile, "[]", "utf8");
  const cleanupCalls = [];
  const run = async (label, keepValue) => {
    const previous = process.env.PAPERFLOW_BENCHMARK_KEEP_ARTIFACTS;
    if (keepValue === undefined) delete process.env.PAPERFLOW_BENCHMARK_KEEP_ARTIFACTS;
    else process.env.PAPERFLOW_BENCHMARK_KEEP_ARTIFACTS = keepValue;
    try {
      return await runStage2WritebackBenchmark([
        "node", "workflow/tests/stage2_writeback_benchmark.mjs", `--input-file=${inputFile}`, `--output-root=${dir}`,
        "--real-run", "--date=2098-12-31T00:00:00.000Z", `--run-id=${label}`,
      ], {
        runStage2: async ({ recovery }) => {
          await recovery.recordCollections([
            { key: "CREATED", created: true, role: "source" },
            { key: "REUSED", created: false, role: "source" },
            { key: "ROOT", created: true, role: "root_pool", name: "文献池" },
          ]);
          await recovery.recordItems(["I1"]);
          return { writeback_items: [{ itemKey: "I1" }] };
        },
        runCleanup: async ({ manifest }) => {
          cleanupCalls.push(manifest);
          return { ok: true, deleted_items: 1, deleted_collections: 1, residual: { cloud: 0 } };
        },
      });
    } finally {
      if (previous === undefined) delete process.env.PAPERFLOW_BENCHMARK_KEEP_ARTIFACTS;
      else process.env.PAPERFLOW_BENCHMARK_KEEP_ARTIFACTS = previous;
    }
  };

  const kept = await run("keep", "true");
  const cleaned = [await run("unset", undefined), await run("false", "false"), await run("empty", ""), await run("uppercase", "TRUE")];
  assert.equal(kept.cleanup_enabled, false);
  assert.equal(kept.result.cleanup.mode, "kept");
  assert.equal(cleanupCalls.length, 4);
  assert.ok(cleaned.every((report) => report.cleanup_enabled && report.result.cleanup.ok));
  assert.ok(cleanupCalls.every((manifest) => JSON.stringify(manifest).includes('"createdItemKeys":["I1"]')));
  assert.ok(cleanupCalls.every((manifest) => !/api.?key|token|secret|Bench A/i.test(JSON.stringify(manifest))));
});

test("stage2 desktop benchmark reports cleanup failure and still cleans after Stage2 failure", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-desktop-cleanup-failure-"));
  const inputFile = path.join(dir, "input.json");
  await fs.writeFile(inputFile, "[]", "utf8");
  let cleanupCalls = 0;
  const options = {
    runStage2: async ({ recovery }) => { await recovery.recordItems(["ONLY_THIS_RUN"]); throw new Error("stage_failed"); },
    runCleanup: async () => { cleanupCalls += 1; return { ok: true, deleted_items: 1, residual: { cloud: 0 } }; },
  };
  await assert.rejects(() => runStage2WritebackBenchmark([
    "node", "workflow/tests/stage2_writeback_benchmark.mjs", `--input-file=${inputFile}`, `--output-root=${dir}`,
    "--real-run", "--date=2098-12-31T00:00:00.000Z", "--run-id=failed-but-cleaned",
  ], options), /stage_failed/);
  assert.equal(cleanupCalls, 1);

  options.runStage2 = async ({ recovery }) => { await recovery.recordItems(["ONLY_THIS_RUN"]); return { writeback_items: [] }; };
  options.runCleanup = async () => ({ ok: false, failed_item_deletes: [{ itemKey: "ONLY_THIS_RUN", error: "blocked" }], residual: { cloud: 1 } });
  await assert.rejects(() => runStage2WritebackBenchmark([
    "node", "workflow/tests/stage2_writeback_benchmark.mjs", `--input-file=${inputFile}`, `--output-root=${dir}`,
    "--real-run", "--date=2098-12-31T00:00:00.000Z", "--run-id=cleanup-partial",
  ], options), /stage2_benchmark_cleanup_failed/);
});

test("stage2 api writeback benchmark dry-run ignores stale formal summary", async () => {
  const expectedBackend = process.env.ZOTERO_BACKEND || "auto";
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-api-bench-test-"));
  const inputFile = path.join(dir, "input.json");
  const stalePipelineDir = path.join(dir, "review_results", "pipeline", "99.1.2");
  await fs.mkdir(stalePipelineDir, { recursive: true });
  await fs.writeFile(inputFile, JSON.stringify([
    { title: "API Bench A", grade: "A", final_grade: "A", source_channel: "rss" },
  ]), "utf8");
  await fs.writeFile(path.join(stalePipelineDir, "zotero_writeback_summary.json"), JSON.stringify({
    counters: { created: 99, failed: 0 },
    writeback_items: Array.from({ length: 99 }, (_, i) => ({ itemKey: `STALE${i}` })),
  }), "utf8");

  const report = await runStage2ApiWritebackBenchmark([
    "node",
    "workflow/tests/stage2_api_writeback_benchmark.mjs",
    `--input-file=${inputFile}`,
    `--output-root=${dir}`,
    "--limit=1",
    "--date=2098-12-31T00:00:00.000Z",
    "--run-id=api-bench-test",
  ]);

  assert.equal(report.run_id, "api-bench-test");
  assert.equal(report.real_run, false);
  assert.equal(report.item_count, 1);
  assert.match(report.pipeline_dir, /98\.12\.31/);
  assert.equal(report.result.created, 0);
  assert.equal(report.result.cleanup, null);
  const manifest = JSON.parse(await fs.readFile(report.cleanup_manifest_path, "utf8"));
  assert.equal(manifest.cleanupEligible, false);
  assert.equal(manifest.backend, expectedBackend);
  assert.deepEqual(manifest.createdItemKeys, []);
  assert.match(report.summary_path, /98\.12\.31/);
  assert.match(report.cleanup_manifest_path, /98\.12\.31/);
});

test("stage2 api benchmark writes a non-applyable manifest when the stage runner fails", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-api-bench-failure-"));
  const inputFile = path.join(dir, "input.json");
  await fs.writeFile(inputFile, "[]", "utf8");
  const argv = [
    "node",
    "workflow/tests/stage2_api_writeback_benchmark.mjs",
    `--input-file=${inputFile}`,
    `--output-root=${dir}`,
    "--real-run",
    "--date=2098-12-31T00:00:00.000Z",
    "--run-id=api-bench-failure",
  ];

  await assert.rejects(
    () => runStage2ApiWritebackBenchmark(argv, { runStage2: async () => { throw new Error("stage_failed"); } }),
    /stage_failed/,
  );
  const manifestPath = path.join(dir, "review_results", "pipeline", "98.12.31", "stage2_smoke_cleanup_manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.cleanupEligible, false);
  assert.deepEqual(manifest.createdItemKeys, []);
});

test("stage2 api benchmark stops before Stage2 when recovery initialization fails", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-api-recovery-init-"));
  const inputFile = path.join(dir, "input.json");
  await fs.writeFile(inputFile, "[]", "utf8");
  let runnerCalled = false;
  await assert.rejects(
    () => runStage2ApiWritebackBenchmark([
      "node", "workflow/tests/stage2_api_writeback_benchmark.mjs", `--input-file=${inputFile}`, `--output-root=${dir}`,
      "--real-run", "--date=2098-12-31T00:00:00.000Z", "--run-id=init-failure",
    ], {
      recoveryStoreFactory: async () => { throw new Error("recovery_init_failed"); },
      runStage2: async () => { runnerCalled = true; },
    }),
    /recovery_init_failed/,
  );
  assert.equal(runnerCalled, false);
});

test("stage2 api benchmark preserves incrementally recorded ownership after a later failure", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-api-recovery-failure-"));
  const inputFile = path.join(dir, "input.json");
  await fs.writeFile(inputFile, "[]", "utf8");
  const runId = "ownership-failure";
  await assert.rejects(
    () => runStage2ApiWritebackBenchmark([
      "node", "workflow/tests/stage2_api_writeback_benchmark.mjs", `--input-file=${inputFile}`, `--output-root=${dir}`,
      "--real-run", "--date=2098-12-31T00:00:00.000Z", `--run-id=${runId}`,
    ], {
      runStage2: async ({ recovery }) => {
        await recovery.recordCollections([
          { key: "CREATED", created: true, role: "source" },
          { key: "REUSED", created: false, role: "source" },
          { key: "ROOT", created: true, role: "root_pool", name: "文献池" },
          { key: "UNKNOWN", role: "grade" },
        ]);
        await recovery.recordItems(["I1"]);
        throw new Error("summary_write_failed");
      },
    }),
    /summary_write_failed/,
  );
  const pipelineDir = path.join(dir, "review_results", "pipeline", "98.12.31");
  const recovery = JSON.parse(await fs.readFile(path.join(pipelineDir, `stage2_recovery_${runId}.json`), "utf8"));
  assert.equal(recovery.state, "failed");
  assert.deepEqual(recovery.createdItemKeys, ["I1"]);
  assert.equal(recovery.createdCollections.find((entry) => entry.key === "CREATED").ownership, "created");
  assert.equal(recovery.createdCollections.find((entry) => entry.key === "REUSED").ownership, "reused");
  assert.equal(recovery.createdCollections.find((entry) => entry.key === "UNKNOWN").ownership, "unknown");
  const cleanup = JSON.parse(await fs.readFile(path.join(pipelineDir, "stage2_smoke_cleanup_manifest.json"), "utf8"));
  assert.deepEqual(cleanup.createdItemKeys, ["I1"]);
  assert.equal(cleanup.createdCollections.some((entry) => entry.key === "ROOT"), true);
});

test("stage2 api benchmark keeps recovery state when the final manifest write fails", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-api-recovery-final-"));
  const inputFile = path.join(dir, "input.json");
  await fs.writeFile(inputFile, "[]", "utf8");
  const runId = "final-manifest-failure";
  await assert.rejects(
    () => runStage2ApiWritebackBenchmark([
      "node", "workflow/tests/stage2_api_writeback_benchmark.mjs", `--input-file=${inputFile}`, `--output-root=${dir}`,
      "--real-run", "--date=2098-12-31T00:00:00.000Z", `--run-id=${runId}`,
    ], {
      runStage2: async ({ recovery }) => {
        await recovery.recordItems(["I1"]);
        return { writeback_items: [] };
      },
      writeCleanupManifest: async () => { throw new Error("final_manifest_write_failed"); },
    }),
    /final_manifest_write_failed/,
  );
  const filePath = path.join(dir, "review_results", "pipeline", "98.12.31", `stage2_recovery_${runId}.json`);
  const recovery = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(recovery.createdItemKeys[0], "I1");
  assert.equal(recovery.cleanupEligible, true);
});
