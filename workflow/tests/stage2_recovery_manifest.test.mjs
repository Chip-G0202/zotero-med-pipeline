import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  Stage2RecoveryManifestStore,
  atomicWriteStage2RecoveryManifest,
  createStage2RecoveryManifest,
  validateStage2RecoveryManifest,
} from "../tools/maintenance/stage2_recovery_manifest.mjs";
import { buildStage2SmokeCleanupPlan } from "../tools/maintenance/stage2_smoke_cleanup.mjs";

async function makeStore(overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-recovery-"));
  const filePath = path.join(dir, "recovery.json");
  const store = await Stage2RecoveryManifestStore.initialize({ filePath, runId: "run-1", backend: "web_api", ...overrides });
  return { dir, filePath, store };
}

test("initializes a non-applyable recovery manifest", async () => {
  const { filePath, store } = await makeStore();
  assert.equal(store.manifest.state, "initialized");
  assert.equal(store.manifest.cleanupEligible, false);
  assert.equal(JSON.parse(await fs.readFile(filePath, "utf8")).runId, "run-1");
});

test("records created, reused, and unknown collections without making unsafe entries deletable", async () => {
  const { store } = await makeStore();
  await store.recordCollections([
    { key: "CREATED", created: true, role: "day" },
    { key: "REUSED", created: false, role: "month" },
    { key: "UNKNOWN", role: "source" },
    { key: "ROOT", created: true, role: "root_pool", name: "文献池" },
  ]);
  const plan = buildStage2SmokeCleanupPlan(store.manifest, { expectedRunId: "run-1" });
  assert.deepEqual(plan.collectionKeys, ["CREATED"]);
  assert.ok(store.manifest.reusedCollectionKeys.includes("REUSED"));
  assert.equal(plan.skipped.filter((entry) => entry.reason === "collection_ownership_unknown").length, 1);
  assert.ok(plan.skipped.some((entry) => entry.reason === "root_pool_protected"));
});

test("records item keys once and preserves exact ownership after failure", async () => {
  const { store } = await makeStore();
  await store.recordItems(["I1", "I1", "I2"]);
  await store.markFailed({ stage: "summary_write", code: "write_failed" });
  assert.deepEqual(store.manifest.createdItemKeys, ["I1", "I2"]);
  assert.equal(store.manifest.state, "failed");
  assert.equal(store.manifest.cleanupEligible, true);
  assert.equal(buildStage2SmokeCleanupPlan(store.manifest, { expectedRunId: "run-1" }).ok, true);
});

test("rejects run id mismatch, unsupported version, and dry-run ownership", () => {
  assert.equal(validateStage2RecoveryManifest(createStage2RecoveryManifest({ runId: "run-1", backend: "web_api" }), { expectedRunId: "other" }).ok, false);
  assert.equal(validateStage2RecoveryManifest({ ...createStage2RecoveryManifest({ runId: "run-1", backend: "web_api" }), version: 2 }).ok, false);
  const dryRun = createStage2RecoveryManifest({ runId: "dry", backend: "web_api", dryRun: true });
  dryRun.createdItemKeys = ["NOPE"];
  dryRun.cleanupEligible = true;
  assert.equal(validateStage2RecoveryManifest(dryRun).ok, false);
});

test("atomic write interruption preserves the prior recovery manifest", async () => {
  const { filePath, store } = await makeStore();
  const previous = await fs.readFile(filePath, "utf8");
  const failingFs = {
    mkdir: fs.mkdir,
    rename: fs.rename,
    unlink: fs.unlink,
    open: async () => { throw new Error("interrupted_write"); },
  };
  await assert.rejects(() => atomicWriteStage2RecoveryManifest(filePath, { ...store.manifest, state: "failed" }, { fsApi: failingFs }), /interrupted_write/);
  assert.equal(await fs.readFile(filePath, "utf8"), previous);
});
