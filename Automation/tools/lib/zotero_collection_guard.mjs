export const DEFAULT_MANAGED_ROOT_NAME = "文献池";
export const DEFAULT_ROOT_CHILD_SPECIAL_COLLECTION_NAMES = ["待删除"];
export const DEFAULT_TOP_LEVEL_SPECIAL_COLLECTION_NAMES = ["值得精读"];

export function collectionKey(collection) {
  return String(collection?.key || collection?.collectionKey || "").trim();
}

export function collectionName(collection) {
  return String(collection?.name || "").trim();
}

export function parentCollectionKey(collection) {
  const raw = collection?.__guardParentKey
    ?? collection?.parentCollection
    ?? collection?.parent
    ?? "";
  if (raw === false || raw === null || raw === undefined) return "";
  return String(raw || "").trim();
}

export function flattenCollections(collections = []) {
  const out = [];
  const seen = new Set();

  function visit(collection, inheritedParentKey = "") {
    if (!collection) return;
    const key = collectionKey(collection);
    const normalized = {
      ...collection,
      __guardParentKey: parentCollectionKey(collection) || inheritedParentKey,
    };
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(normalized);
    }
    for (const child of Array.isArray(collection?.subcollections) ? collection.subcollections : []) {
      visit(child, key || inheritedParentKey);
    }
  }

  for (const collection of Array.isArray(collections) ? collections : []) visit(collection);
  return out;
}

function descendantKeysByParent(collections, rootKey) {
  const children = new Map();
  for (const collection of collections) {
    const parentKey = parentCollectionKey(collection);
    if (!parentKey) continue;
    if (!children.has(parentKey)) children.set(parentKey, []);
    children.get(parentKey).push(collectionKey(collection));
  }

  const allowed = new Set();
  const queue = [rootKey];
  while (queue.length) {
    const key = queue.shift();
    if (!key || allowed.has(key)) continue;
    allowed.add(key);
    for (const childKey of children.get(key) || []) queue.push(childKey);
  }
  return allowed;
}

export function buildZoteroCollectionGuard(collections = [], {
  rootName = DEFAULT_MANAGED_ROOT_NAME,
  rootChildSpecialNames = DEFAULT_ROOT_CHILD_SPECIAL_COLLECTION_NAMES,
  topLevelSpecialNames = DEFAULT_TOP_LEVEL_SPECIAL_COLLECTION_NAMES,
} = {}) {
  const flat = flattenCollections(collections);
  const byKey = new Map(flat.map((collection) => [collectionKey(collection), collection]).filter(([key]) => key));
  const rootCandidates = flat.filter((collection) => collectionName(collection) === rootName && !parentCollectionKey(collection));
  const ambiguousSpecialNames = new Set();
  const rootKey = rootCandidates.length === 1 ? collectionKey(rootCandidates[0]) : "";
  const rootChildSpecialNameToKeys = {};
  const topLevelSpecialNameToKeys = {};
  const invalidPositionSpecialNameToKeys = {};
  const topLevelSpecialKeys = new Set();
  const excludedRootSubtreeKeys = new Set();

  for (const name of rootChildSpecialNames) {
    const validMatches = flat.filter((collection) => collectionName(collection) === name && parentCollectionKey(collection) === rootKey);
    const invalidMatches = flat.filter((collection) => collectionName(collection) === name && parentCollectionKey(collection) !== rootKey);
    rootChildSpecialNameToKeys[name] = validMatches.map((collection) => collectionKey(collection)).filter(Boolean);
    invalidPositionSpecialNameToKeys[name] = invalidMatches.map((collection) => collectionKey(collection)).filter(Boolean);
    if (validMatches.length > 1) ambiguousSpecialNames.add(name);
  }

  for (const name of topLevelSpecialNames) {
    const validMatches = flat.filter((collection) => collectionName(collection) === name && !parentCollectionKey(collection));
    const invalidMatches = flat.filter((collection) => collectionName(collection) === name && parentCollectionKey(collection));
    topLevelSpecialNameToKeys[name] = validMatches.map((collection) => collectionKey(collection)).filter(Boolean);
    invalidPositionSpecialNameToKeys[name] = invalidMatches.map((collection) => collectionKey(collection)).filter(Boolean);
    if (validMatches.length > 1) ambiguousSpecialNames.add(name);
    if (validMatches.length === 1) topLevelSpecialKeys.add(collectionKey(validMatches[0]));
    for (const match of invalidMatches) {
      for (const key of descendantKeysByParent(flat, collectionKey(match))) excludedRootSubtreeKeys.add(key);
    }
  }

  const rootSubtreeKeys = rootKey ? descendantKeysByParent(flat, rootKey) : new Set();
  const allowedKeys = new Set([...rootSubtreeKeys, ...topLevelSpecialKeys]);
  for (const key of excludedRootSubtreeKeys) allowedKeys.delete(key);
  const ready = rootCandidates.length === 1;
  const rootIssue = rootCandidates.length === 0
    ? "managed_root_missing"
    : rootCandidates.length > 1
      ? "managed_root_ambiguous"
      : "";

  function checkCollectionKey(key, { action = "", role = "" } = {}) {
    const normalizedKey = String(key || "").trim();
    const collection = byKey.get(normalizedKey);
    const name = collectionName(collection);
    if (!ready) {
      return { ok: false, reason: rootIssue || "managed_root_unavailable", action, role, collectionKey: normalizedKey, collectionName: name };
    }
    if (!normalizedKey) {
      return { ok: false, reason: "collection_key_missing", action, role, collectionKey: "", collectionName: "" };
    }
    if (!collection) {
      return { ok: false, reason: "collection_unknown", action, role, collectionKey: normalizedKey, collectionName: "" };
    }
    if (ambiguousSpecialNames.has(name)) {
      return { ok: false, reason: "special_collection_ambiguous", action, role, collectionKey: normalizedKey, collectionName: name };
    }
    if (
      rootChildSpecialNames.includes(name)
      && parentCollectionKey(collection) !== rootKey
    ) {
      return { ok: false, reason: "special_collection_wrong_position", action, role, collectionKey: normalizedKey, collectionName: name };
    }
    if (
      topLevelSpecialNames.includes(name)
      && parentCollectionKey(collection)
    ) {
      return { ok: false, reason: "special_collection_wrong_position", action, role, collectionKey: normalizedKey, collectionName: name };
    }
    if (!allowedKeys.has(normalizedKey)) {
      return { ok: false, reason: "collection_out_of_allowed_scope", action, role, collectionKey: normalizedKey, collectionName: name };
    }
    return { ok: true, reason: "", action, role, collectionKey: normalizedKey, collectionName: name };
  }

  return {
    enabled: true,
    ready,
    rootName,
    rootKey,
    rootIssue,
    rootChildSpecialNames,
    topLevelSpecialNames,
    rootChildSpecialNameToKeys,
    topLevelSpecialNameToKeys,
    invalidPositionSpecialNameToKeys,
    specialNameToKeys: {
      ...rootChildSpecialNameToKeys,
      ...topLevelSpecialNameToKeys,
    },
    ambiguousSpecialNames: [...ambiguousSpecialNames],
    allowedKeys,
    byKey,
    checkCollectionKey,
    isAllowedCollectionKey(key) {
      return checkCollectionKey(key).ok;
    },
    audit: {
      collection_scope_guard_enabled: true,
      collection_scope_guard_ready: ready,
      allowed_root_name: rootName,
      allowed_root_collection_key: rootKey,
      allowed_root_child_special_collection_names: rootChildSpecialNames,
      allowed_top_level_special_collection_names: topLevelSpecialNames,
      ambiguous_special_collection_names: [...ambiguousSpecialNames],
      invalid_position_special_collection_keys: invalidPositionSpecialNameToKeys,
      collection_scope_root_issue: rootIssue,
    },
  };
}

export function recordCollectionScopeBlock(blocks, check, extra = {}) {
  const record = {
    status: "collection_scope_blocked",
    action: check?.action || extra.action || "",
    role: check?.role || extra.role || "",
    collection_key: check?.collectionKey || extra.collection_key || "",
    collection_name: check?.collectionName || extra.collection_name || "",
    reason: check?.reason || extra.reason || "collection_scope_blocked",
    ...extra,
  };
  if (Array.isArray(blocks)) blocks.push(record);
  return record;
}

export function summarizeCollectionScopeBlocks(blocks = [], limit = 20) {
  const list = Array.isArray(blocks) ? blocks : [];
  return {
    collection_scope_blocked_count: list.length,
    collection_scope_blocked_samples: list.slice(0, limit).map((entry) => ({
      action: entry.action || "",
      role: entry.role || "",
      collection_key: entry.collection_key || entry.collectionKey || "",
      collection_name: entry.collection_name || entry.collectionName || "",
      itemKey: entry.itemKey || "",
      reason: entry.reason || "",
    })),
  };
}
