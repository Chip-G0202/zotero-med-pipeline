import { readItemDetails, readSubcollections } from "../lib/writeback_support.mjs";
import { LABELS } from "../lib/grade_primitives.mjs";
import { recordCollectionScopeBlock } from "../lib/zotero_collection_guard.mjs";
import {
  collectRecentDateCollectionNodes,
  parseDateNameToDate,
  parseMonthDayCollectionDate,
} from "../lib/zotero_date_collections.mjs";

const SOURCE_COLLECTIONS = {
  rss: "RSS订阅",
  database: "数据库检索",
};

function parseStarLevel(tags) {
  let maxStar = 0;
  for (const t of tags || []) {
    const v = typeof t === "string" ? t : t?.tag || "";
    if (!v) continue;
    const starCount = (v.match(/⭐/g) || []).length;
    if (starCount > maxStar) maxStar = starCount;
  }
  return maxStar;
}

function hasStrongStarMark(data, tags) {
  if (parseStarLevel(tags) > 0) return true;
  if (data?.starred === true || data?.starred === 1) return true;
  if (data?.favorite === true || data?.favorite === 1) return true;
  return false;
}

function isItemValidForMigration(data) {
  const title = String(data?.title || "").trim();
  const hasIdentifier = Boolean(
    data?.key ||
    data?.itemKey ||
    data?.DOI ||
    data?.url ||
    data?.linkMode ||
    title
  );
  return Boolean(title && hasIdentifier);
}

function collectionPathParts(collection = {}) {
  return String(collection?.path || collection?.name || collection || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function collectionDate(collection = {}) {
  const parts = collectionPathParts(collection);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const dt = parseDateNameToDate(parts[i]) || parseMonthDayCollectionDate(parts[i], parts.slice(0, i));
    if (dt) return dt;
  }
  return null;
}

function inMigrationWindow(date, now, windowDays) {
  if (!date) return false;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - windowDays);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date >= start && date <= end;
}

function collectionRole(collection = {}) {
  const last = collectionPathParts(collection).at(-1) || String(collection?.name || collection || "");
  if (last === SOURCE_COLLECTIONS.rss || last === SOURCE_COLLECTIONS.database) return "source";
  if (last === LABELS.A || last === LABELS.B || last === LABELS.C) return "grade";
  if (last === "值得精读") return "worthy";
  if (last === "文献池") return "pool";
  return "";
}

function eligibleGradeCollection(collection = {}, expandAllGrades = false) {
  const last = collectionPathParts(collection).at(-1) || String(collection?.name || collection || "");
  if (last === LABELS.A || last === LABELS.B) return true;
  return expandAllGrades && last === LABELS.C;
}

export async function migrateRatedItems({
  rootKey,
  worthyKey,
  now,
  zoteroBackendCall,
  mcpToolCall,
  starMigrationConfig,
  collectionGuard = null,
  collectionScopeBlocks = null,
  localLibraryIndex = null,
  getCollectionItemKeys,
  addItemToWorthyCollectionWithGuard,
  removeItemFromCollectionWithGuard,
}) {
  const callZotero = zoteroBackendCall || mcpToolCall;
  const migrationConfig = starMigrationConfig || { enabled: true, mode: "legacy", expandAllGrades: false, windowDays: 10, starThreshold: 4 };
  const localStarDataAvailable = Object.values(localLibraryIndex?.live_items || {}).some((item) =>
    item?.starred || item?.favorite || (Array.isArray(item?.tags) && item.tags.length > 0)
  );
  const stats = {
    skipped: !migrationConfig.enabled,
    reason: migrationConfig.enabled ? "" : "star_migration_disabled",
    enabled: migrationConfig.enabled,
    mode: migrationConfig.mode,
    scanned_date_collections: 0,
    scanned_candidates: 0,
    star_threshold: migrationConfig.starThreshold,
    window_days: migrationConfig.windowDays,
    expand_all_grades: migrationConfig.expandAllGrades,
    eligible_items: 0,
    moved_to_worthy: 0,
    already_in_worthy: 0,
    duplicate_candidates_skipped: 0,
    skipped_invalid: 0,
    skipped_already_exists: 0,
    removed_from_source_collections: 0,
    removed_from_grade_collections: 0,
    removed_from_root_pool: 0,
    removal_failures: [],
    add_failures: [],
    errors: [],
    date_collections: [],
    migrated_items: [],
    worthy_collection_key: worthyKey || "",
    local_zotero_index_used: Boolean(localLibraryIndex?.live_items && localStarDataAvailable),
    local_zotero_index_skip_reason: localLibraryIndex?.live_items && !localStarDataAvailable ? "local_index_missing_tag_or_star_fields" : "",
  };

  if (stats.skipped) {
    return stats;
  }

  if (!worthyKey) {
    stats.skipped = true;
    stats.reason = "worthy_collection_missing";
    return stats;
  }

  if (collectionGuard) {
    const worthyCheck = collectionGuard.checkCollectionKey(worthyKey, { action: "add_items_to_collection", role: "worthy_target" });
    const rootCheck = collectionGuard.checkCollectionKey(rootKey, { action: "remove_items_from_collection", role: "root_pool" });
    for (const check of [worthyCheck, rootCheck]) {
      if (check.ok) continue;
      stats.skipped = true;
      stats.reason = `collection_scope_blocked:${check.reason}`;
      const block = recordCollectionScopeBlock(collectionScopeBlocks, check, { phase: "star_migration" });
      stats.errors.push(block);
    }
    if (stats.skipped) return stats;
  }

  const processedEligibleKeys = new Set();
  const localCandidates = [];
  let dateNodes = [];
  let worthyItems = new Set();
  if (localLibraryIndex?.live_items && localStarDataAvailable) {
    const dateKeys = new Set();
    for (const item of Object.values(localLibraryIndex.live_items || {})) {
      if (!item?.itemKey) continue;
      const collections = item.collections || [];
      if (collections.some((collection) => (collectionRole(collection) === "worthy") || String(collection?.key || "") === worthyKey)) {
        worthyItems.add(item.itemKey);
      }
      const candidateCollections = collections.filter((collection) =>
        eligibleGradeCollection(collection, stats.expand_all_grades)
        && inMigrationWindow(collectionDate(collection), now, stats.window_days)
      );
      if (!candidateCollections.length) continue;
      const sourceCollections = collections.filter((collection) => collectionRole(collection) === "source" && inMigrationWindow(collectionDate(collection), now, stats.window_days));
      const gradeCollections = collections.filter((collection) => collectionRole(collection) === "grade" && inMigrationWindow(collectionDate(collection), now, stats.window_days));
      for (const collection of [...sourceCollections, ...gradeCollections]) {
        const key = String(collection?.key || collection?.path || collection?.name || "");
        if (key) dateKeys.add(key);
      }
      localCandidates.push({ itemKey: item.itemKey, item, sourceCollections, gradeCollections });
    }
    stats.scanned_date_collections = dateKeys.size;
    stats.date_collections.push({ name: "local_zotero_index", key: "", candidate_items: localCandidates.length });
  } else {
    const tree = await readSubcollections(rootKey, { mcpToolCall: callZotero, recursive: true, id: 660000, stage: "stage2_star_migration_tree" });
    dateNodes = collectRecentDateCollectionNodes(tree, now, stats.window_days);
    worthyItems = new Set(await getCollectionItemKeys(worthyKey, 670000, callZotero));
  }

  const processCandidate = async ({ itemKey, item = null, sourceCollections = [], gradeCollections = [] }) => {
    stats.scanned_candidates += 1;
    let detail = item ? { data: item } : null;
    if (!detail) {
      try {
        detail = await readItemDetails(itemKey, { mcpToolCall: callZotero, mode: "preview", id: 690000 + stats.scanned_candidates, stage: "stage2_star_migration" });
      } catch (error) {
        stats.errors.push({ itemKey, error: String(error?.message || error), phase: "read_item_details" });
        stats.removal_failures.push({ itemKey, error: String(error?.message || error), phase: "read_item_details" });
        return;
      }
    }
    const data = detail?.data || detail || {};
    const tags = Array.isArray(data.tags) ? data.tags : Array.isArray(detail?.tags) ? detail.tags : [];
    if (!hasStrongStarMark(data, tags)) return;

    if (!isItemValidForMigration(data)) {
      stats.skipped_invalid += 1;
      return;
    }

    if (processedEligibleKeys.has(itemKey)) {
      stats.duplicate_candidates_skipped += 1;
      return;
    }

    processedEligibleKeys.add(itemKey);
    stats.eligible_items += 1;

    if (worthyItems.has(itemKey)) {
      stats.already_in_worthy += 1;
      stats.skipped_already_exists += 1;
      return;
    }

    const addResult = await addItemToWorthyCollectionWithGuard({
      itemKey,
      worthyKey,
      zoteroBackendCall: callZotero,
      id: 700000 + stats.eligible_items,
      collectionGuard,
      collectionScopeBlocks,
      apply: true,
      dryRun: false,
    });
    if (!addResult.ok) {
      stats.errors.push(...addResult.write_failures);
      stats.add_failures.push(...addResult.write_failures);
      return;
    }
    worthyItems.add(itemKey);
    stats.moved_to_worthy += 1;
    const migrationRecord = {
      itemKey,
      title: data.title || detail?.title || "",
      worthy_collection_key: worthyKey,
      removed_from_root_pool: false,
      removed_source_collection_keys: [],
      removed_grade_collection_keys: [],
    };
    stats.migrated_items.push(migrationRecord);

    const collectionRoleByKey = new Map();
    for (const collection of sourceCollections) collectionRoleByKey.set(collection.key, "source");
    for (const collection of gradeCollections) collectionRoleByKey.set(collection.key, "grade");
    const collectionsToRemove = new Set();
    for (const collection of sourceCollections) if (collection?.key) collectionsToRemove.add(collection.key);
    for (const collection of gradeCollections) if (collection?.key) collectionsToRemove.add(collection.key);

    for (const collectionKey of collectionsToRemove) {
      try {
        const role = collectionRoleByKey.get(collectionKey) || "date_subcollection";
        const result = await removeItemFromCollectionWithGuard({
          itemKey,
          collectionKey,
          role,
          phase: "remove_from_day_collections",
          zoteroBackendCall: callZotero,
          id: 710000 + stats.removed_from_source_collections + stats.removed_from_grade_collections,
          collectionGuard,
          collectionScopeBlocks,
          apply: true,
          dryRun: false,
        });
        if (!result.ok) {
          stats.errors.push(...result.write_failures);
          stats.removal_failures.push(...result.write_failures);
        } else if (role === "source") {
          stats.removed_from_source_collections += 1;
          migrationRecord.removed_source_collection_keys.push(collectionKey);
        } else {
          stats.removed_from_grade_collections += 1;
          migrationRecord.removed_grade_collection_keys.push(collectionKey);
        }
      } catch (error) {
        stats.errors.push({ itemKey, collectionKey, error: String(error?.message || error), phase: "remove_from_day_collections" });
        stats.removal_failures.push({ itemKey, collectionKey, error: String(error?.message || error), phase: "remove_from_day_collections" });
      }
    }

    const rootRemovalResult = await removeItemFromCollectionWithGuard({
      itemKey,
      collectionKey: rootKey,
      role: "root_pool",
      phase: "remove_from_root_pool",
      zoteroBackendCall: callZotero,
      id: 720000 + stats.removed_from_root_pool,
      collectionGuard,
      collectionScopeBlocks,
      apply: true,
      dryRun: false,
    });
    if (!rootRemovalResult.ok) {
      stats.errors.push(...rootRemovalResult.write_failures);
      stats.removal_failures.push(...rootRemovalResult.write_failures);
    } else {
      stats.removed_from_root_pool += 1;
      migrationRecord.removed_from_root_pool = true;
    }
  };

  for (const candidate of localCandidates) {
    await processCandidate(candidate);
  }

  for (const node of dateNodes) {
    const childMap = new Map((node.subcollections || []).map((c) => [c.name, c]));
    const sourceCollections = [childMap.get(SOURCE_COLLECTIONS.rss), childMap.get(SOURCE_COLLECTIONS.database)].filter(Boolean);
    const gradeCollections = [childMap.get(LABELS.A), childMap.get(LABELS.B), childMap.get(LABELS.C)].filter(Boolean);
    const collectionRoleByKey = new Map();
    for (const collection of sourceCollections) collectionRoleByKey.set(collection.key, "source");
    for (const collection of gradeCollections) collectionRoleByKey.set(collection.key, "grade");
    const candidateItemKeys = new Set();
    const candidateGradeCollections = stats.expand_all_grades
      ? [childMap.get(LABELS.A), childMap.get(LABELS.B), childMap.get(LABELS.C)]
      : [childMap.get(LABELS.A), childMap.get(LABELS.B)];
    for (const gradeCollection of candidateGradeCollections) {
      if (!gradeCollection?.key) continue;
      const keys = await getCollectionItemKeys(gradeCollection.key, 680000 + candidateItemKeys.size, callZotero);
      for (const key of keys) candidateItemKeys.add(key);
    }

    stats.scanned_date_collections += 1;
    stats.date_collections.push({ name: node?.name || "", key: node?.key || "", candidate_items: candidateItemKeys.size });

    for (const itemKey of candidateItemKeys) {
      await processCandidate({ itemKey, sourceCollections, gradeCollections });
    }
  }

  return stats;
}
