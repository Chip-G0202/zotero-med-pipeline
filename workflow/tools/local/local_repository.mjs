import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { registerEphemeral } from "../lib/ephemeral_registry.mjs";

import { getLiteratureIdentityKeys } from "../lib/literature_identity.mjs";
import {
  findLiteratureRecord,
  getDefaultZoteroLibraryIndexPath,
  readZoteroLibraryIndex,
  updateLocalLiteratureIndexItems,
} from "../lib/zotero_library_index_store.mjs";

const SNAPSHOT_VERSION = 1;
const FEEDBACK_VERSION = 1;

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`LOCAL_PATH_OUTSIDE_ROOT:${target}`);
  return target;
}

export async function atomicWriteJson(filePath, value, { fsApi = fs } = {}) {
  await fsApi.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const temporaryRegistration = registerEphemeral({ path: temporary, ownerStage: "local_state", cleanupWhen: "always_after_close" });
  let handle = null;
  try {
    handle = await fsApi.open(temporary, "wx");
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fsApi.rename(temporary, filePath);
    temporaryRegistration.forget();
  } catch (error) {
    if (handle) {
      try { await handle.close(); } catch {}
    }
    temporaryRegistration.markClosed();
    try { await fsApi.unlink(temporary); temporaryRegistration.forget(); } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") error.atomic_cleanup_error = String(cleanupError?.message || cleanupError);
    }
    throw error;
  }
}

export function localDedupeKeys(item = {}) {
  return getLiteratureIdentityKeys(item);
}

export function createLocalPaperId(item = {}) {
  const seed = localDedupeKeys(item)[0];
  if (!seed) throw new Error("LOCAL_PAPER_IDENTIFIER_MISSING");
  return `lp_${createHash("sha256").update(seed).digest("hex").slice(0, 20)}`;
}

export async function readFeedbackJsonl(filePath, { tolerateIncompleteTail = true } = {}) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    const events = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch (error) {
        const isTail = index === lines.length - 1 && !text.endsWith("\n");
        if (isTail && tolerateIncompleteTail) break;
        throw new Error(`LOCAL_FEEDBACK_CORRUPT_LINE:${index + 1}:${error.message}`);
      }
    }
    return events;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export class LocalRepository {
  constructor(outputRoot, { sharedIndexPath = getDefaultZoteroLibraryIndexPath(process.env.ZOTERO_PROJECT_ROOT || process.cwd()) } = {}) {
    this.root = path.resolve(outputRoot);
    this.stateDir = assertInside(this.root, path.join(this.root, "state"));
    this.feedbackDir = assertInside(this.root, path.join(this.root, "feedback"));
    this.runsDir = assertInside(this.root, path.join(this.root, "runs"));
    this.exportsDir = assertInside(this.root, path.join(this.root, "exports"));
    this.papersPath = path.join(this.stateDir, "papers.json");
    this.indexPath = path.join(this.stateDir, "dedupe-index.json");
    this.sharedIndexPath = path.resolve(sharedIndexPath);
    this.learningPath = path.join(this.stateDir, "learning-state.json");
    this.feedbackPath = path.join(this.feedbackDir, "events.jsonl");
    this.papers = [];
    this.index = {};
    this.sharedIndex = null;
  }

  async load() {
    await fs.mkdir(this.stateDir, { recursive: true });
    await fs.mkdir(this.feedbackDir, { recursive: true });
    await fs.mkdir(this.runsDir, { recursive: true });
    await fs.mkdir(this.exportsDir, { recursive: true });
    try {
      const snapshot = JSON.parse(await fs.readFile(this.papersPath, "utf8"));
      if (snapshot.schema_version !== SNAPSHOT_VERSION || !Array.isArray(snapshot.papers)) throw new Error("LOCAL_PAPERS_SCHEMA_UNSUPPORTED");
      this.papers = snapshot.papers;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    this.rebuildIndex();
    const shared = await readZoteroLibraryIndex(this.sharedIndexPath);
    this.sharedIndex = shared.usable ? shared.index : null;
    return this;
  }

  rebuildIndex() {
    this.index = {};
    for (const paper of this.papers) for (const key of localDedupeKeys(paper)) this.index[key] ||= paper.local_id;
  }

  findExisting(item) {
    const shared = this.sharedIndex ? findLiteratureRecord(this.sharedIndex, item, "local") : null;
    if (shared?.presence?.local?.output_root === this.root) {
      return { exists: true, local_id: shared.presence.local.local_paper_id, matched_by: shared.canonical_id.split(":", 1)[0] };
    }
    for (const key of localDedupeKeys(item)) {
      const localId = this.index[key];
      if (localId) return { exists: true, local_id: localId, matched_by: key.split(":", 1)[0] };
    }
    return { exists: false };
  }

  upsertPapers(items = [], { runId = "" } = {}) {
    const byId = new Map(this.papers.map((paper) => [paper.local_id, paper]));
    let created = 0;
    let updated = 0;
    for (const raw of items) {
      const existing = this.findExisting(raw);
      const localId = existing.local_id || createLocalPaperId(raw);
      const previous = byId.get(localId);
      const paper = {
        ...(previous || {}),
        ...raw,
        local_id: localId,
        schema_version: SNAPSHOT_VERSION,
        first_seen_at: previous?.first_seen_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_run_id: runId,
      };
      delete paper.itemKey;
      delete paper.item_key;
      delete paper.collections;
      delete paper.attachments;
      delete paper.rating;
      byId.set(localId, paper);
      if (previous) updated += 1; else created += 1;
      for (const key of localDedupeKeys(paper)) this.index[key] ||= localId;
    }
    this.papers = [...byId.values()];
    return { created, updated, total: this.papers.length };
  }

  async save() {
    await atomicWriteJson(this.papersPath, { schema_version: SNAPSHOT_VERSION, generated_at: new Date().toISOString(), papers: this.papers });
    await updateLocalLiteratureIndexItems(this.sharedIndexPath, this.papers, { outputRoot: this.root });
    const shared = await readZoteroLibraryIndex(this.sharedIndexPath);
    this.sharedIndex = shared.usable ? shared.index : this.sharedIndex;
  }

  async appendFeedback(input = {}, { runId = "", source = "local_cli" } = {}) {
    const event = {
      schema_version: FEEDBACK_VERSION,
      event_id: String(input.event_id || randomUUID()),
      timestamp: String(input.timestamp || new Date().toISOString()),
      local_paper_id: String(input.local_paper_id || input.local_id || "").trim(),
      action: String(input.action || input.type || input.feedback || "").trim().toLowerCase(),
      payload: input.payload && typeof input.payload === "object" ? input.payload : {},
      source: String(input.source || source),
      run_id: String(input.run_id || runId),
    };
    if (!event.local_paper_id || !["keep", "drop", "upgrade", "downgrade"].includes(event.action)) throw new Error("LOCAL_FEEDBACK_INVALID");
    await fs.mkdir(this.feedbackDir, { recursive: true });
    await fs.appendFile(this.feedbackPath, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }

  async saveLearningState(value = {}) {
    await atomicWriteJson(this.learningPath, { schema_version: SNAPSHOT_VERSION, updated_at: new Date().toISOString(), ...value });
  }

  async loadLearningState() {
    try {
      const state = JSON.parse(await fs.readFile(this.learningPath, "utf8"));
      if (state.schema_version !== SNAPSHOT_VERSION) throw new Error("LOCAL_LEARNING_SCHEMA_UNSUPPORTED");
      return state;
    } catch (error) {
      if (error.code === "ENOENT") return { schema_version: SNAPSHOT_VERSION, consumed_feedback_event_ids: [] };
      throw error;
    }
  }
}
