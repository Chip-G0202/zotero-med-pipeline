import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { main, parseCleanupArgs } from "../tools/maintenance/cleanup_runs.mjs";

test("cleanup CLI defaults to dry-run and parses the shared retention options", () => {
  assert.deepEqual(parseCleanupArgs([]), { dryRun: true, force: false, retentionDays: 30, runsDir: "", json: false, help: false });
  assert.deepEqual(parseCleanupArgs(["--apply", "--force", "--retention-days=45", "--runs-dir", "x", "--json"]), {
    dryRun: false, force: true, retentionDays: 45, runsDir: "x", json: true, help: false,
  });
});

test("cleanup CLI delegates to shared housekeeping without deleting by default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperflow-cleanup-cli-"));
  const runsDir = path.join(root, "runs");
  await fs.mkdir(runsDir, { recursive: true });
  let received;
  const result = await main(["--runs-dir", runsDir], {
    runtime: {},
    runCleanup: async (options) => { received = options; return { skipped: false, eligibleRuns: 2, deletedRuns: 0 }; },
  });
  assert.equal(received.dryRun, true);
  assert.equal(received.runRoot, path.resolve(runsDir));
  assert.equal(result.deletedRuns, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("cleanup CLI help is side-effect free", async () => {
  const result = await main(["--help"], { runCleanup: async () => { throw new Error("must not run"); } });
  assert.equal(result.help, true);
  assert.match(result.usage, /--apply/);
});
