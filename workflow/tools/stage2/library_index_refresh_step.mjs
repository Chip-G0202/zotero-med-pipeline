import {
  buildFingerprintMaps,
  emptyZoteroLibraryIndex,
  normalizeLiveIndexItem,
  writeZoteroLibraryIndex,
} from "../lib/zotero_library_index_store.mjs";

export function applyStarMigrationToLiveIndex(currentLiveItems, migrationStats, { rootKey = "", worthyKey = "" } = {}) {
  let updated = 0;
  for (const record of migrationStats?.migrated_items || []) {
    const itemKey = record?.itemKey || "";
    if (!itemKey || !currentLiveItems[itemKey]) continue;
    const removedKeys = new Set([
      ...(record.removed_source_collection_keys || []),
      ...(record.removed_grade_collection_keys || []),
    ]);
    if (record.removed_from_root_pool && rootKey) removedKeys.add(rootKey);
    const previous = currentLiveItems[itemKey];
    const collections = (previous.collections || []).filter((collection) => !removedKeys.has(collection?.key || collection));
    if (worthyKey && !collections.some((collection) => (collection?.key || collection) === worthyKey)) {
      collections.push({ key: worthyKey, name: "值得精读" });
    }
    const roles = new Set(previous.collection_roles || []);
    if (record.removed_from_root_pool) roles.delete("pool");
    if ((record.removed_source_collection_keys || []).length) roles.delete("source");
    if ((record.removed_grade_collection_keys || []).length) roles.delete("grade");
    roles.add("worthy");
    currentLiveItems[itemKey] = normalizeLiveIndexItem({
      ...previous,
      title: previous.title || record.title || "",
      collections,
      collection_roles: [...roles],
    });
    updated++;
  }
  return updated;
}

export async function refreshStage2LibraryIndex({
  indexPath,
  currentLiveItems,
  currentCollections,
  mergedTombstones,
  localIndexStats,
  workflowDay,
  mcpUrl,
}) {
  try {
    localIndexStats.refreshed_live_item_count = Object.keys(currentLiveItems).length;
    const refreshedIndex = emptyZoteroLibraryIndex({
      generatedAt: new Date().toISOString(),
      workflowDay,
      mcpUrl,
    });
    refreshedIndex.live_items = currentLiveItems;
    refreshedIndex.tombstones = mergedTombstones;
    refreshedIndex.collections = currentCollections;
    refreshedIndex.stats = {
      source: "stage2_writeback_refresh",
      live_item_count: Object.keys(currentLiveItems).length,
      tombstone_count: Object.keys(mergedTombstones).length,
      collection_count: Object.keys(currentCollections).length,
      fingerprint_cache_hit_count: localIndexStats.fingerprint_cache_hit_count,
      fingerprint_cache_miss_count: localIndexStats.fingerprint_cache_miss_count,
      live_get_item_details_count: localIndexStats.live_get_item_details_count,
    };
    refreshedIndex.coverage = {
      zotero: {
        complete: false,
        scope: "managed_collections_and_writeback_items",
        backend_identity: mcpUrl || "",
        refreshed_at: refreshedIndex.generated_at,
        status: "partial",
      },
    };
    refreshedIndex.fingerprints = buildFingerprintMaps(refreshedIndex);
    await writeZoteroLibraryIndex(indexPath, refreshedIndex);
    localIndexStats.local_zotero_index_written = true;
  } catch (error) {
    localIndexStats.local_zotero_index_write_error = String(error?.message || error).slice(0, 300);
  }
  return localIndexStats;
}
