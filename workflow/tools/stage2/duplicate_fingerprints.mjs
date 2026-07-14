import { normalizeTombstone } from "../lib/zotero_library_index_store.mjs";
import { getLiteratureDedupeFingerprints, normalizeTitleForExistingDedupe } from "../lib/literature_identity.mjs";

function norm(value) {
  return String(value || "").toLowerCase().trim();
}

function normDoi(value) {
  return norm(value)
    .replace(/^https?:\/\/doi\.org\//, "")
    .replace(/^doi:\s*/, "")
    .trim();
}

export function normalizeTitleForMatch(value) {
  return normalizeTitleForExistingDedupe(value);
}

export function getFingerprints(item) {
  return getLiteratureDedupeFingerprints(item);
}

export function pushIndex(map, key, itemKey) {
  if (!key) return;
  if (!map.has(key)) map.set(key, itemKey);
}

export function addDuplicateIndexItem(index, item, itemKey, meta = {}) {
  const fp = getFingerprints(item);
  pushIndex(index.byDoi, fp.doi, itemKey);
  pushIndex(index.byPmid, fp.pmid, itemKey);
  pushIndex(index.byPmcid, fp.pmcid, itemKey);
  pushIndex(index.byArxiv, fp.arxiv, itemKey);
  if (index.byOpenalex) pushIndex(index.byOpenalex, fp.openalex, itemKey);
  if (index.byUrl) pushIndex(index.byUrl, fp.url, itemKey);
  pushIndex(index.byTitle, fp.title, itemKey);
  if (index.meta) index.meta.set(itemKey, { title: item.title || "", ...meta });
}

export function addTombstonesToDuplicateIndex(index, tombstones = {}) {
  let count = 0;
  for (const tombstone of Object.values(tombstones || {})) {
    const normalized = normalizeTombstone(tombstone);
    const itemKey = normalized.tombstoneId;
    if (!itemKey) continue;
    addDuplicateIndexItem(index, normalized, itemKey, {
      isTombstone: true,
      tombstone_source: normalized.tombstone_source || "deleted_trash",
      tombstone_reason: normalized.tombstone_reason || "deleted_trash_tombstone",
    });
    count++;
  }
  return count;
}

function mapMatch(index, map, type, value, defaultReason) {
  if (!value || !map.has(value)) return null;
  const itemKey = map.get(value);
  const meta = index.meta?.get(itemKey) || {};
  return {
    itemKey,
    reason: meta.tombstone_reason || defaultReason,
    type,
    value,
    isTombstone: Boolean(meta.isTombstone),
    tombstone_source: meta.tombstone_source || "",
    fromCache: Boolean(meta.fromCache),
  };
}

export function findByIndex(item, index) {
  const fp = getFingerprints(item);
  return mapMatch(index, index.byDoi, "doi", fp.doi, "duplicate_by_doi")
    || mapMatch(index, index.byPmid, "pmid", fp.pmid, "duplicate_by_pmid")
    || mapMatch(index, index.byPmcid, "pmcid", fp.pmcid, "duplicate_by_pmcid")
    || mapMatch(index, index.byArxiv, "arxiv", fp.arxiv, "duplicate_by_arxiv")
    || (index.byOpenalex && mapMatch(index, index.byOpenalex, "openalex", fp.openalex, "duplicate_by_openalex"))
    || (index.byUrl && mapMatch(index, index.byUrl, "url", fp.url, "duplicate_by_url"))
    || mapMatch(index, index.byTitle, "title", fp.title, "duplicate_by_title_exact");
}
