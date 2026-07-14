import { readCollectionItems, readItemDetails, readSubcollections } from "../lib/writeback_support.mjs";
import {
  getDefaultZoteroLibraryIndexPath,
  readZoteroLibraryIndex,
} from "../lib/zotero_library_index_store.mjs";
import {
  collectRecentDateCollectionNodes,
  parseDateNameToDate,
  parseMonthDayCollectionDate,
} from "../lib/zotero_date_collections.mjs";

export {
  collectRecentDateCollectionNodes,
  parseDateNameToDate,
  parseMonthDayCollectionDate,
} from "../lib/zotero_date_collections.mjs";

const GRADE_NAMES = ["A课题相关", "B专题相关", "C领域相关"];

function collectionPathParts(collection = {}) {
  return String(collection?.path || collection?.name || collection || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function localCollectionGrade(collection = {}) {
  const last = collectionPathParts(collection).at(-1) || "";
  if (last === "A课题相关") return "A";
  if (last === "B专题相关") return "B";
  if (last === "C领域相关") return "C";
  return "";
}

function localCollectionDate(collection = {}) {
  const parts = collectionPathParts(collection);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const direct = parseDateNameToDate(parts[i]);
    if (direct) return direct;
    const monthDay = parseMonthDayCollectionDate(parts[i], parts.slice(0, i));
    if (monthDay) return monthDay;
  }
  return null;
}

function inWindow(date, now, windowDays) {
  if (!date) return false;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - windowDays);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date >= start && date <= end;
}

async function collectMissingShortTitleFromLocalIndex(existingKeys, {
  now,
  windowDays,
  maxScan,
  localIndexPath,
} = {}) {
  const read = await readZoteroLibraryIndex(localIndexPath);
  const scanStats = {
    date_collections_scanned: 0,
    items_scanned: 0,
    items_missing_shorttitle: 0,
    errors: 0,
    scan_limited: false,
    local_zotero_index_used: read.usable,
    local_zotero_index_path: localIndexPath,
    local_zotero_index_fallback_reason: read.usable ? "" : read.reason,
  };
  if (!read.usable) return { candidates: [], scanStats, usable: false };

  const candidates = [];
  const scannedDateCollections = new Set();
  for (const item of Object.values(read.index.live_items || {})) {
    if (scanStats.items_scanned >= maxScan) {
      scanStats.scan_limited = true;
      break;
    }
    if (!item?.itemKey || existingKeys.has(item.itemKey)) continue;
    const gradeCollections = (item.collections || [])
      .map((collection) => ({ collection, grade: localCollectionGrade(collection), date: localCollectionDate(collection) }))
      .filter((entry) => entry.grade && inWindow(entry.date, now, windowDays));
    if (!gradeCollections.length) continue;
    existingKeys.add(item.itemKey);
    scanStats.items_scanned += 1;
    for (const entry of gradeCollections) {
      const key = String(entry.collection?.key || entry.collection?.path || entry.collection?.name || "");
      if (key) scannedDateCollections.add(key);
    }
    if (!String(item.shortTitle || "").trim()) {
      scanStats.items_missing_shorttitle += 1;
      candidates.push({
        itemKey: item.itemKey,
        title: item.title || "",
        grade: gradeCollections[0].grade || "C",
        source_channel: "pool_scan",
      });
    }
  }
  scanStats.date_collections_scanned = scannedDateCollections.size;
  return { candidates, scanStats, usable: true };
}

export async function collectExistingItemsMissingShortTitle(
  rootKey,
  existingKeys,
  {
    now = new Date(),
    windowDays = 14,
    idBase = 1100000,
    maxScan = 100,
    localIndexPath = getDefaultZoteroLibraryIndexPath(process.env.ZOTERO_PROJECT_ROOT || process.cwd()),
    zoteroBackend = null,
    zoteroBackendCall,
    mcpToolCall,
    logger = console,
  } = {},
) {
  const callZotero = zoteroBackendCall || mcpToolCall;
  const scannedKeys = [];
  const localResult = await collectMissingShortTitleFromLocalIndex(existingKeys, {
    now,
    windowDays,
    maxScan,
    localIndexPath,
  });
  if (localResult.usable) return { candidates: localResult.candidates, scanStats: localResult.scanStats };

  const scanStats = {
    ...localResult.scanStats,
    date_collections_scanned: 0,
    items_scanned: 0,
    items_missing_shorttitle: 0,
    errors: 0,
    scan_limited: false,
  };

  try {
    const tree = await readSubcollections(rootKey, {
      zoteroBackend,
      zoteroBackendCall: callZotero,
      recursive: true,
      id: idBase,
      stage: "stage3_translation_pool_scan_tree",
    });
    const dateNodes = collectRecentDateCollectionNodes(tree, now, windowDays);

    for (const node of dateNodes) {
      if (scanStats.items_scanned >= maxScan) break;
      const childMap = new Map((node.subcollections || []).map((c) => [c.name, c]));
      const gradeCollections = GRADE_NAMES.map((name) => childMap.get(name)).filter(Boolean);
      if (!gradeCollections.length) continue;
      scanStats.date_collections_scanned += 1;

      for (const gc of gradeCollections) {
        if (scanStats.items_scanned >= maxScan) break;
        let offset = 0;
        const limit = 200;
        while (true) {
          if (scanStats.items_scanned >= maxScan) break;
          const items = await readCollectionItems(gc.key, {
            zoteroBackend,
            zoteroBackendCall: callZotero,
            limit,
            offset,
            id: idBase + 100 + offset,
            stage: "stage3_translation_pool_scan_items",
          });
          if (!Array.isArray(items) || !items.length) break;

          for (const item of items) {
            if (scanStats.items_scanned >= maxScan) { scanStats.scan_limited = true; break; }
            if (!item?.key || existingKeys.has(item.key)) continue;
            existingKeys.add(item.key);
            scanStats.items_scanned += 1;

            try {
              const detail = await readItemDetails(item.key, {
                zoteroBackend,
                zoteroBackendCall: callZotero,
                mode: "preview",
                id: idBase + 200 + scanStats.items_scanned,
                stage: "stage3_translation_pool_scan_detail",
              });
              const data = detail?.data || detail || {};
              const shortTitle = String(data.shortTitle || "").trim();
              if (!shortTitle) {
                scanStats.items_missing_shorttitle += 1;
                scannedKeys.push({
                  itemKey: item.key,
                  title: data.title || "",
                  grade: gc.name.replace(/[课题专题领域相关]/g, "").charAt(0) || "C",
                  source_channel: "pool_scan",
                });
              }
            } catch {
              scanStats.errors += 1;
            }
          }
          if (items.length < limit) break;
          offset += limit;
        }
      }
    }
  } catch (e) {
    logger.error?.(`[translation_backfill] pool scan error: ${String(e?.message || e).slice(0, 200)}`);
  }

  return { candidates: scannedKeys, scanStats };
}
