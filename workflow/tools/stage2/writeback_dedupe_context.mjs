import {
  mergeDeletedTrashTombstones,
  normalizeLiveIndexItem,
  readZoteroLibraryIndex,
} from "../lib/zotero_library_index_store.mjs";
import {
  addDuplicateIndexItem,
  addTombstonesToDuplicateIndex,
} from "./duplicate_fingerprints.mjs";
import {
  buildCollectionDuplicateIndex,
  buildPoolIndex,
} from "./duplicate_scan.mjs";

function emptyDuplicateIndex() {
  return {
    byDoi: new Map(),
    byPmid: new Map(),
    byPmcid: new Map(),
    byArxiv: new Map(),
    byOpenalex: new Map(),
    byUrl: new Map(),
    byTitle: new Map(),
    meta: new Map(),
  };
}

function collectionKeyOf(collection) {
  return String(collection?.key || collection || "").trim();
}

function collectionNameOf(collection) {
  return String(collection?.name || collection?.path || collection || "").trim();
}

function localItemHasCollection(item, collectionKey, collectionNames = []) {
  const key = String(collectionKey || "").trim();
  const names = new Set(collectionNames.filter(Boolean));
  return (item.collections || []).some((collection) => {
    const collectionKeyValue = collectionKeyOf(collection);
    const collectionNameValue = collectionNameOf(collection);
    return (key && collectionKeyValue === key) || names.has(collectionNameValue);
  });
}

function localItemHasRole(item, role, collectionKey, collectionNames = []) {
  const roles = new Set(item.collection_roles || []);
  if (roles.has(role)) return true;
  if (role === "pool" && (roles.has("source") || roles.has("grade"))) return true;
  return localItemHasCollection(item, collectionKey, collectionNames);
}

function buildDuplicateIndexFromLocalLibrary(localLibraryIndex, { role, collectionKey = "", collectionNames = [], source }) {
  const index = emptyDuplicateIndex();
  let itemCount = 0;
  for (const item of Object.values(localLibraryIndex?.live_items || {})) {
    const normalized = normalizeLiveIndexItem(item);
    if (!normalized.itemKey || !localItemHasRole(normalized, role, collectionKey, collectionNames)) continue;
    addDuplicateIndexItem(index, normalized, normalized.itemKey, { source, fromCache: true });
    itemCount += 1;
  }
  return { index, itemCount };
}

function shouldSkipFullCollectionScan(env = process.env) {
  return !/^(1|true|yes)$/i.test(String(env.ZOTERO_DEDUP_RECONCILE_COLLECTIONS || "").trim());
}

export async function buildWritebackDedupeContext({
  indexPath,
  root,
  trashKey,
  worthy,
  zoteroBackendCall,
  mcpToolCall,
}) {
  const callZotero = zoteroBackendCall || mcpToolCall;
  const localIndexRead = await readZoteroLibraryIndex(indexPath);
  const localLibraryIndex = localIndexRead.usable ? localIndexRead.index : null;
  const completeSnapshot = localLibraryIndex?.coverage?.zotero?.complete === true;
  const skipFullCollectionScan = shouldSkipFullCollectionScan();
  const localIndexStats = {
    local_zotero_index_path: indexPath,
    local_zotero_index_used: Boolean(localLibraryIndex),
    local_zotero_index_fallback_reason: localIndexRead.usable ? "" : localIndexRead.reason,
    fingerprint_cache_hit_count: 0,
    fingerprint_cache_miss_count: 0,
    live_get_item_details_count: 0,
    tombstone_count_loaded: localLibraryIndex ? Object.keys(localLibraryIndex.tombstones || {}).length : 0,
    deleted_trash_tombstone_count_added: 0,
    skipped_duplicate_in_deleted_trash_index: 0,
    refreshed_live_item_count: 0,
    local_zotero_index_written: false,
    local_zotero_index_write_error: "",
    full_collection_scan_skipped: skipFullCollectionScan,
    full_collection_scan_skip_reason: skipFullCollectionScan ? "local_index_primary_with_exact_lookup_fallback" : "",
    local_index_direct_duplicate_index_used: skipFullCollectionScan && Boolean(localLibraryIndex),
    backend_exact_dedupe_skipped: skipFullCollectionScan && completeSnapshot,
    backend_exact_dedupe_skip_reason: skipFullCollectionScan && completeSnapshot ? "complete_shared_literature_index" : "",
  };
  const currentLiveItems = skipFullCollectionScan && localLibraryIndex
    ? { ...localLibraryIndex.live_items }
    : {};
  const poolIndex = skipFullCollectionScan
    ? buildDuplicateIndexFromLocalLibrary(localLibraryIndex, {
      role: "pool",
      collectionKey: root.key,
      collectionNames: ["文献池"],
      source: "pool",
    }).index
    : await buildPoolIndex(root.key, {
      mcpToolCall: callZotero,
      localIndex: localLibraryIndex,
      cacheStats: localIndexStats,
      currentLiveItems,
    });

  let trashIndex = emptyDuplicateIndex();
  let trashItemCount = 0;
  try {
    if (trashKey && skipFullCollectionScan && localLibraryIndex) {
      const builtTrash = buildDuplicateIndexFromLocalLibrary(localLibraryIndex, {
        role: "trash",
        collectionKey: trashKey,
        collectionNames: ["待删除", "文献池/待删除"],
        source: "trash",
      });
      trashIndex = builtTrash.index;
      trashItemCount = builtTrash.itemCount;
    } else if (trashKey && !skipFullCollectionScan) {
      const builtTrash = await buildCollectionDuplicateIndex({
        collectionKey: trashKey,
        collectionName: "待删除",
        collectionRole: "trash",
        idBase: 535000,
        mcpToolCall: callZotero,
        localIndex: localLibraryIndex,
        cacheStats: localIndexStats,
        currentLiveItems,
      });
      trashIndex = builtTrash.index;
      trashItemCount = builtTrash.itemCount;
    }
  } catch {
    // 待删除集合不存在或无法访问时忽略
  }

  const mergedTombstones = localLibraryIndex
    ? mergeDeletedTrashTombstones(localLibraryIndex, currentLiveItems, { generatedAt: new Date().toISOString() })
    : {};
  localIndexStats.deleted_trash_tombstone_count_added = Math.max(
    0,
    Object.keys(mergedTombstones).length - Object.keys(localLibraryIndex?.tombstones || {}).length,
  );
  const tombstoneIndexCount = addTombstonesToDuplicateIndex(trashIndex, mergedTombstones);
  localIndexStats.tombstone_count_loaded = tombstoneIndexCount;

  let worthyIndex = emptyDuplicateIndex();
  let worthyItemCount = 0;
  try {
    if (worthy?.key && skipFullCollectionScan && localLibraryIndex) {
      const builtWorthy = buildDuplicateIndexFromLocalLibrary(localLibraryIndex, {
        role: "worthy",
        collectionKey: worthy.key,
        collectionNames: ["值得精读"],
        source: "worthy",
      });
      worthyIndex = builtWorthy.index;
      worthyItemCount = builtWorthy.itemCount;
    } else if (worthy?.key && !skipFullCollectionScan) {
      const builtWorthy = await buildCollectionDuplicateIndex({
        collectionKey: worthy.key,
        collectionName: "值得精读",
        collectionRole: "worthy",
        idBase: 538000,
        mcpToolCall: callZotero,
        localIndex: localLibraryIndex,
        cacheStats: localIndexStats,
        currentLiveItems,
      });
      worthyIndex = builtWorthy.index;
      worthyItemCount = builtWorthy.itemCount;
    }
  } catch {
    // 值得精读集合不存在或无法访问时忽略
  }

  return {
    localIndexStats,
    currentLiveItems,
    poolIndex,
    trashIndex,
    trashItemCount,
    mergedTombstones,
    tombstoneIndexCount,
    worthyIndex,
    worthyItemCount,
    skipBackendExactDedupe: localIndexStats.backend_exact_dedupe_skipped,
    localLibraryIndex,
  };
}
