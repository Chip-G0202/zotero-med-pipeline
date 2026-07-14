import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const CLEANUP_WHEN = new Set(["after_use", "after_success", "always_after_close"]);
let activeRegistry = null;

function isStrictChild(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function inactiveRegistration() {
  return { accepted: false, markClosed() {}, markConsumed() {}, forget() {}, async cleanup() { return false; } };
}

export class EphemeralRegistry {
  constructor({ allowedRoots = [], formalArtifacts = [], fsApi = fs } = {}) {
    this.allowedRoots = allowedRoots.map((root) => path.resolve(String(root || ""))).filter(Boolean);
    this.formalArtifacts = new Set(formalArtifacts.map((item) => path.resolve(String(item || ""))));
    this.fsApi = fsApi;
    this.entries = new Map();
    this.stats = { immediateDeletedFiles: 0, immediateDeletedBytes: 0, immediateFailedCount: 0, warnings: [], samples: [] };
  }

  register({ path: filePath, ownerStage, cleanupWhen, preserveOnFailure = false } = {}) {
    const resolved = path.resolve(String(filePath || ""));
    const allowedRoot = this.allowedRoots.find((root) => isStrictChild(root, resolved));
    if (!filePath || !ownerStage || !CLEANUP_WHEN.has(cleanupWhen) || !allowedRoot || this.formalArtifacts.has(resolved)) {
      this.#warn("EPHEMERAL_REGISTRATION_REJECTED");
      return inactiveRegistration();
    }
    const id = randomUUID();
    this.entries.set(id, { id, path: resolved, allowedRoot, ownerStage: String(ownerStage), cleanupWhen, preserveOnFailure: Boolean(preserveOnFailure), closed: false, consumed: false });
    return {
      accepted: true,
      markClosed: () => { const entry = this.entries.get(id); if (entry) entry.closed = true; },
      markConsumed: () => { const entry = this.entries.get(id); if (entry) entry.consumed = true; },
      forget: () => this.entries.delete(id),
      cleanup: (options = {}) => this.#cleanupEntry(id, options),
    };
  }

  async cleanup({ success = false } = {}) {
    for (const id of [...this.entries.keys()]) await this.#cleanupEntry(id, { success });
    return this.summary();
  }

  summary() {
    return { ...this.stats, warnings: [...this.stats.warnings], samples: [...this.stats.samples], registeredRemaining: this.entries.size };
  }

  #warn(code) {
    if (this.stats.warnings.length < 10) this.stats.warnings.push(code);
  }

  async #cleanupEntry(id, { success = false } = {}) {
    const entry = this.entries.get(id);
    if (!entry || !entry.closed) return false;
    if (entry.cleanupWhen === "after_use" && !entry.consumed) return false;
    if (entry.cleanupWhen === "after_success" && !success) return false;
    if (entry.preserveOnFailure && !success) return false;
    try {
      const stat = await this.fsApi.lstat(entry.path);
      if (stat.isSymbolicLink() || !stat.isFile() || !isStrictChild(entry.allowedRoot, entry.path) || this.formalArtifacts.has(entry.path)) throw new Error("EPHEMERAL_PATH_BLOCKED");
      await this.fsApi.unlink(entry.path);
      this.entries.delete(id);
      this.stats.immediateDeletedFiles += 1;
      this.stats.immediateDeletedBytes += stat.size;
      if (this.stats.samples.length < 8) this.stats.samples.push(path.relative(entry.allowedRoot, entry.path));
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") { this.entries.delete(id); return false; }
      this.stats.immediateFailedCount += 1;
      this.#warn(String(error?.message || error).slice(0, 100));
      return false;
    }
  }
}

export function activateEphemeralRegistry(registry) {
  const previous = activeRegistry;
  activeRegistry = registry;
  return () => { if (activeRegistry === registry) activeRegistry = previous; };
}

export function getActiveEphemeralRegistry() { return activeRegistry; }

export function registerEphemeral(options, registry = activeRegistry) {
  return registry ? registry.register(options) : inactiveRegistration();
}
