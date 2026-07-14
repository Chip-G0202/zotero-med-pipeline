import { parseToolText, readSubcollections } from "../lib/writeback_support.mjs";
import {
  buildZoteroCollectionGuard,
  recordCollectionScopeBlock,
} from "../lib/zotero_collection_guard.mjs";

// Cache for collection guard to avoid repeated API calls
let _cachedCollections = null;
let _cachedGuard = null;
let _cacheRootKey = null;
let _cachedCollectionsSource = "";

export function invalidateCollectionGuardCache() {
  _cachedCollections = null;
  _cachedGuard = null;
  _cacheRootKey = null;
  _cachedCollectionsSource = "";
}

async function readCollections({ mcpToolCall, callId = 3, forceRefresh = false } = {}) {
  if (!forceRefresh && Array.isArray(_cachedCollections)) return _cachedCollections;
  const result = await mcpToolCall("get_collections", { mode: "complete", limit: 1000 }, callId);
  const list = parseToolText(result);
  _cachedCollections = Array.isArray(list) ? [...list] : [];
  _cachedCollectionsSource = mcpToolCall?.backendType || "";
  return _cachedCollections;
}

function rememberCollection(collection, parentCollection = false) {
  if (!collection || !collection.key || !Array.isArray(_cachedCollections)) return;
  const existing = _cachedCollections.find((entry) => entry?.key === collection.key);
  if (existing) return;
  _cachedCollections.push({
    ...collection,
    parentCollection: collection.parentCollection ?? collection.parent ?? parentCollection,
  });
  _cachedGuard = null;
  _cacheRootKey = null;
}

export async function ensureTopCollectionByName(name, { mcpToolCall, callIdBase = 20 }) {
  const list = await readCollections({ mcpToolCall, callId: callIdBase });
  const exact = (Array.isArray(list) ? list : []).filter((entry) => entry.name === name && !(entry.parentCollection || entry.parent));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const signal = name === "文献池" ? "pool_collection_ambiguous" : "top_collection_ambiguous";
    const error = new Error(`TOP_COLLECTION_AMBIGUOUS: 存在多个同名顶层集合 ${name}`);
    error.details = { signal, name, keys: exact.map((entry) => entry.key) };
    throw error;
  }
  const created = parseToolText(await mcpToolCall("create_collection", { name }, callIdBase + 1));
  rememberCollection(created, false);
  return created;
}

export async function findTopCollectionByName(name, { mcpToolCall, callId = 2 }) {
  const list = await readCollections({ mcpToolCall, callId });
  const exact = (Array.isArray(list) ? list : []).filter((entry) => entry.name === name && !(entry.parentCollection || entry.parent));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const error = new Error(`TOP_COLLECTION_AMBIGUOUS: 存在多个同名顶层集合 ${name}`);
    error.details = { signal: "top_collection_ambiguous", name, keys: exact.map((entry) => entry.key) };
    throw error;
  }
  return null;
}

export async function buildCollectionGuard(rootKey, { mcpToolCall, forceRefresh = false, localCollections = null } = {}) {
  // Use local collections if provided (for incremental updates)
  if (localCollections && !forceRefresh) {
    return buildZoteroCollectionGuard(localCollections);
  }

  // Use cache if available and rootKey matches
  if (!forceRefresh && _cachedGuard && _cacheRootKey === rootKey) {
    return _cachedGuard;
  }

  const top = await readCollections({ mcpToolCall, callId: 3, forceRefresh });
  const collections = Array.isArray(top) ? [...top] : [];
  if (rootKey && _cachedCollectionsSource !== "cli") {
    try {
      // Use getAllCollections for API backend to avoid N recursive API calls
      const adapter = mcpToolCall?.adapter?.backend || mcpToolCall?.adapter;
      if (adapter && typeof adapter.getAllCollections === "function") {
        const allCols = await adapter.getAllCollections();
        if (Array.isArray(allCols)) collections.push(...allCols);
      } else {
        const descendants = await readSubcollections(rootKey, { mcpToolCall, recursive: true, id: 4, stage: "stage2_collection_guard_tree" });
        if (Array.isArray(descendants)) collections.push(...descendants);
      }
    } catch {
      // Guard still fails closed if required collections cannot be resolved.
    }
  }

  const guard = buildZoteroCollectionGuard(collections);
  _cachedCollections = collections;
  _cachedGuard = guard;
  _cacheRootKey = rootKey;
  return guard;
}

export async function ensureChildCollection(parentKey, name, callIdBase, { mcpToolCall, collectionGuard = null, collectionScopeBlocks = null } = {}) {
  if (collectionGuard) {
    const check = collectionGuard.checkCollectionKey(parentKey, { action: "create_collection", role: "parent" });
    if (!check.ok) {
      recordCollectionScopeBlock(collectionScopeBlocks, check, { target_name: name });
      throw new Error(`collection_scope_blocked:create_collection:${check.reason}`);
    }
  }
  const cachedChildren = Array.isArray(_cachedCollections)
    ? _cachedCollections.filter((entry) => (entry.parentCollection || entry.parent || false) === parentKey)
    : null;
  const cachedExisting = cachedChildren?.find((entry) => entry.name === name);
  if (cachedExisting) return cachedExisting.key;

  const children = _cachedCollectionsSource === "cli"
    ? cachedChildren || []
    : await readSubcollections(parentKey, { mcpToolCall, recursive: false, id: callIdBase, stage: "stage2_collection_child_lookup" });
  const existing = children.find((entry) => entry.name === name);
  if (existing) return existing.key;
  const created = parseToolText(await mcpToolCall("create_collection", { name, parentCollection: parentKey }, callIdBase + 1));
  rememberCollection(created, parentKey);
  return created.key;
}
