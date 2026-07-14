import fs from "node:fs/promises";
import path from "node:path";

import { STAGE2_SMOKE_CLEANUP_MANIFEST_VERSION } from "./stage2_smoke_cleanup.mjs";

const RECOVERY_STATES = new Set(["initialized", "collections_recorded", "items_recorded", "completed", "failed"]);

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function normalizeCollection(entry = {}) {
  const createdByRun = entry?.createdByRun === true || entry?.created === true;
  const ownership = createdByRun ? "created" : entry?.ownership === "reused" || entry?.created === false ? "reused" : "unknown";
  return {
    key: String(entry?.key || "").trim(),
    createdByRun,
    ownership,
    role: String(entry?.role || "").trim(),
    parentKey: String(entry?.parentKey || entry?.parentCollection || "").trim(),
    name: String(entry?.name || "").trim(),
  };
}

function canCleanupCollection(collection) {
  return collection.createdByRun === true
    && collection.ownership === "created"
    && collection.role !== "root_pool"
    && collection.name !== "文献池";
}

function cleanupEligible(manifest) {
  return !manifest.dryRun && (
    manifest.createdItemKeys.length > 0
    || manifest.createdCollections.some(canCleanupCollection)
  );
}

export function createStage2RecoveryManifest({ runId, backend, localIndexPath = "", dryRun = false, startedAt = new Date().toISOString() } = {}) {
  return {
    version: STAGE2_SMOKE_CLEANUP_MANIFEST_VERSION,
    runId: String(runId || "").trim(),
    backend: String(backend || "").trim(),
    state: "initialized",
    startedAt,
    updatedAt: startedAt,
    createdItemKeys: [],
    createdCollections: [],
    reusedCollectionKeys: [],
    localIndexPath: String(localIndexPath || "").trim(),
    cleanupEligible: false,
    finalized: false,
    dryRun: Boolean(dryRun),
  };
}

export function validateStage2RecoveryManifest(manifest, { expectedRunId = "" } = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") errors.push("recovery_manifest_missing");
  if (manifest?.version !== STAGE2_SMOKE_CLEANUP_MANIFEST_VERSION) errors.push("unsupported_recovery_manifest_version");
  if (!String(manifest?.runId || "").trim()) errors.push("recovery_manifest_run_id_missing");
  if (expectedRunId && String(manifest?.runId || "") !== String(expectedRunId)) errors.push("recovery_manifest_run_id_mismatch");
  if (!String(manifest?.backend || "").trim()) errors.push("recovery_manifest_backend_missing");
  if (!RECOVERY_STATES.has(manifest?.state)) errors.push("recovery_manifest_state_invalid");
  if (!Array.isArray(manifest?.createdItemKeys)) errors.push("recovery_manifest_created_items_invalid");
  if (!Array.isArray(manifest?.createdCollections)) errors.push("recovery_manifest_created_collections_invalid");
  if (!Array.isArray(manifest?.reusedCollectionKeys)) errors.push("recovery_manifest_reused_collections_invalid");
  if (manifest?.dryRun && (manifest?.cleanupEligible || manifest?.createdItemKeys?.length)) errors.push("dry_run_recovery_manifest_not_safe");
  return { ok: errors.length === 0, errors };
}

export async function atomicWriteStage2RecoveryManifest(filePath, manifest, { fsApi = fs } = {}) {
  const validation = validateStage2RecoveryManifest(manifest, { expectedRunId: manifest?.runId });
  if (!validation.ok) throw new Error(validation.errors.join(","));
  const resolved = path.resolve(filePath);
  const tempPath = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  await fsApi.mkdir(path.dirname(resolved), { recursive: true });
  let handle;
  try {
    handle = await fsApi.open(tempPath, "w");
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fsApi.rename(tempPath, resolved);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fsApi.unlink(tempPath).catch(() => {});
    throw error;
  }
}

export class Stage2RecoveryManifestStore {
  constructor({ filePath, manifest, fsApi = fs } = {}) {
    this.filePath = filePath;
    this.manifest = manifest;
    this.fsApi = fsApi;
    this.writeQueue = Promise.resolve();
  }

  static async initialize({ filePath, runId, backend, localIndexPath = "", dryRun = false, fsApi = fs } = {}) {
    const manifest = createStage2RecoveryManifest({ runId, backend, localIndexPath, dryRun });
    const store = new Stage2RecoveryManifestStore({ filePath, manifest, fsApi });
    await store.persist();
    return store;
  }

  async persist() {
    this.manifest.updatedAt = new Date().toISOString();
    this.manifest.cleanupEligible = cleanupEligible(this.manifest);
    await atomicWriteStage2RecoveryManifest(this.filePath, this.manifest, { fsApi: this.fsApi });
    return this.manifest;
  }

  enqueue(update) {
    const operation = this.writeQueue.then(async () => {
      update();
      return this.persist();
    });
    this.writeQueue = operation;
    return operation;
  }

  async flush() {
    return this.writeQueue;
  }

  async recordCollections(entries = []) {
    if (this.manifest.dryRun) return this.manifest;
    return this.enqueue(() => {
      const byKey = new Map(this.manifest.createdCollections.map((entry) => [entry.key, entry]));
      for (const raw of entries) {
        const collection = normalizeCollection(raw);
        if (!collection.key) continue;
        byKey.set(collection.key, collection);
        if (collection.ownership === "reused") this.manifest.reusedCollectionKeys = unique([...this.manifest.reusedCollectionKeys, collection.key]);
      }
      this.manifest.createdCollections = [...byKey.values()];
      this.manifest.state = "collections_recorded";
    });
  }

  async recordItems(itemKeys = []) {
    if (this.manifest.dryRun) return this.manifest;
    return this.enqueue(() => {
      this.manifest.createdItemKeys = unique([...this.manifest.createdItemKeys, ...itemKeys]);
      this.manifest.state = "items_recorded";
    });
  }

  async markFailed({ stage = "unknown", code = "recovery_failed" } = {}) {
    return this.enqueue(() => {
      this.manifest.state = "failed";
      this.manifest.finalized = false;
      this.manifest.failure = { stage: String(stage || "unknown").slice(0, 80), code: String(code || "recovery_failed").slice(0, 120) };
    });
  }

  async complete() {
    return this.enqueue(() => {
      this.manifest.state = "completed";
      this.manifest.finalized = true;
      this.manifest.completedAt = new Date().toISOString();
      delete this.manifest.failure;
    });
  }
}
