import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Stage2RecoveryManifestStore } from "../../workflow/tools/maintenance/stage2_recovery_manifest.mjs";
import { buildStage2SmokeCleanupManifest, runStage2SmokeCleanup } from "../../workflow/tools/maintenance/stage2_smoke_cleanup.mjs";

async function store() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-recovery-safety-"));
  const filePath = path.join(dir, "recovery.json");
  return Stage2RecoveryManifestStore.initialize({ filePath, runId: "safety", backend: "cli" });
}

test("serial writer preserves 50 concurrent item records and concurrent collections", async () => {
  const recovery = await store();
  const items = Array.from({ length: 50 }, (_, index) => `I${index}`);
  await Promise.all([
    ...items.map((key) => recovery.recordItems([key])),
    recovery.recordCollections([{ key: "C1", created: true, role: "day" }]),
    recovery.recordCollections([{ key: "C2", created: false, role: "month" }]),
  ]);
  await recovery.flush();
  assert.deepEqual(new Set(recovery.manifest.createdItemKeys), new Set(items));
  assert.equal(recovery.manifest.createdItemKeys.length, 50);
  assert.deepEqual(new Set(recovery.manifest.createdCollections.map(({ key }) => key)), new Set(["C1", "C2"]));
  assert.deepEqual(recovery.manifest.reusedCollectionKeys, ["C2"]);
});

test("duplicate concurrent records remain unique", async () => {
  const recovery = await store();
  await Promise.all(Array.from({ length: 20 }, () => recovery.recordItems(["SAME"])));
  assert.deepEqual(recovery.manifest.createdItemKeys, ["SAME"]);
});

test("a failed writer poisons later updates instead of reporting success", async () => {
  let writes = 0;
  const fsApi = {
    mkdir: fs.mkdir,
    rename: fs.rename,
    unlink: fs.unlink,
    open: async (...args) => {
      writes += 1;
      if (writes > 1) throw new Error("manifest_write_failed");
      return fs.open(...args);
    },
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-recovery-fail-"));
  const recovery = await Stage2RecoveryManifestStore.initialize({ filePath: path.join(dir, "recovery.json"), runId: "fail", backend: "cli", fsApi });
  await assert.rejects(recovery.recordItems(["I1"]), /manifest_write_failed/);
  await assert.rejects(recovery.recordItems(["I2"]), /manifest_write_failed/);
});

test("cleanup is idempotent when exact resources are already absent", async () => {
  const cleanupManifest = buildStage2SmokeCleanupManifest({
    runId: "cleanup",
    backend: "cli",
    createdItemKeys: ["I1"],
    createdCollections: [{ key: "C1", createdByRun: true, role: "day" }],
  });
  let first = true;
  let collectionPresent = true;
  const backend = {
    deleteItems: async () => first ? { deleted: ["I1"], failed: [] } : { deleted: [], failed: [{ itemKey: "I1", error: "Item not found" }] },
    deleteCollections: async (keys) => { collectionPresent = false; return { deleted: keys, failed: [] }; },
    getItems: async () => [],
    getCollections: async () => [],
    getCollectionItems: async () => {
      if (!collectionPresent) throw new Error("Collection not found: C1");
      return [];
    },
  };
  const firstResult = await runStage2SmokeCleanup({ manifest: cleanupManifest, backend, apply: true, expectedRunId: "cleanup" });
  first = false;
  const secondResult = await runStage2SmokeCleanup({ manifest: cleanupManifest, backend, apply: true, expectedRunId: "cleanup" });
  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.already_absent_items, 1);
  assert.equal(secondResult.already_absent_collections, 1);
  assert.equal(secondResult.residual.cloud, 0);
});

test("cleanup keeps network uncertainty as unknown failure", async () => {
  const cleanupManifest = buildStage2SmokeCleanupManifest({ runId: "unknown", backend: "cli", createdItemKeys: ["I1"] });
  const result = await runStage2SmokeCleanup({
    manifest: cleanupManifest,
    apply: true,
    expectedRunId: "unknown",
    backend: {
      deleteItems: async () => { throw new Error("network timeout"); },
      deleteCollections: async () => ({ deleted: [], failed: [] }),
      getItems: async () => { throw new Error("network timeout"); },
      getCollections: async () => [],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.verification.items.unknown, 1);
});

test("Desktop cleanup batches exact item preflight and verification", async () => {
  const keys = Array.from({ length: 50 }, (_, index) => `I${index}`);
  const cleanupManifest = buildStage2SmokeCleanupManifest({ runId: "batch", backend: "cli", createdItemKeys: keys });
  let present = new Set(keys);
  let reads = 0;
  const result = await runStage2SmokeCleanup({
    manifest: cleanupManifest,
    apply: true,
    expectedRunId: "batch",
    backend: {
      backendType: "cli",
      getItems: async (requested) => { reads += 1; return requested.map((key) => ({ key, missing: !present.has(key) })); },
      deleteItems: async (requested) => { requested.forEach((key) => present.delete(key)); return { deleted: requested, failed: [] }; },
      deleteCollections: async () => ({ deleted: [], failed: [] }),
      getCollections: async () => [],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(reads, 2);
  assert.equal(result.deleted_items, 50);
  assert.equal(result.residual.items, 0);
});
