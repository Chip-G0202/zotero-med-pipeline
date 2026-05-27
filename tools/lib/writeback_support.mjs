import { LABELS } from "./triage_policy.mjs";

export const MIGRATION_SOURCE_NAMES = ["RSS订阅", "数据库检索", LABELS.A, LABELS.B, LABELS.C];
export const BAD_TAG_RE = /^(doi|pmid|pmcid|url|title):/i;

export function normalizeDoi(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/doi\.org\//, "")
    .replace(/^doi:\s*/, "");
}

export function normalizeIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeTitleExact(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?。，；：！？]+$/g, "")
    .trim()
    .toLowerCase();
}

export function buildPoolDuplicateIndex(items = []) {
  const idx = { doi: new Map(), pmid: new Map(), pmcid: new Map(), arxiv: new Map(), title: new Map() };
  for (const item of items) {
    const key = item.itemKey || item.key || "";
    const doi = normalizeDoi(item.doi || item.DOI || "");
    const pmid = normalizeIdentifier(item.pmid || "");
    const pmcid = normalizeIdentifier(item.pmcid || "");
    const arxiv = normalizeIdentifier(item.arxiv || item.arxiv_id || "");
    const title = normalizeTitleExact(item.title || "");
    if (doi && !idx.doi.has(doi)) idx.doi.set(doi, key);
    if (pmid && !idx.pmid.has(pmid)) idx.pmid.set(pmid, key);
    if (pmcid && !idx.pmcid.has(pmcid)) idx.pmcid.set(pmcid, key);
    if (arxiv && !idx.arxiv.has(arxiv)) idx.arxiv.set(arxiv, key);
    if (title && !idx.title.has(title)) idx.title.set(title, key);
  }
  return idx;
}

export function matchPoolDuplicate(candidate, idx) {
  const doi = normalizeDoi(candidate.doi || candidate.DOI || "");
  if (doi && idx.doi.has(doi)) return { matched: true, type: "doi", value: doi, itemKey: idx.doi.get(doi) };
  const pmid = normalizeIdentifier(candidate.pmid || "");
  if (pmid && idx.pmid.has(pmid)) return { matched: true, type: "pmid", value: pmid, itemKey: idx.pmid.get(pmid) };
  const pmcid = normalizeIdentifier(candidate.pmcid || "");
  if (pmcid && idx.pmcid.has(pmcid)) return { matched: true, type: "pmcid", value: pmcid, itemKey: idx.pmcid.get(pmcid) };
  const arxiv = normalizeIdentifier(candidate.arxiv || candidate.arxiv_id || "");
  if (arxiv && idx.arxiv.has(arxiv)) return { matched: true, type: "arxiv", value: arxiv, itemKey: idx.arxiv.get(arxiv) };
  const title = normalizeTitleExact(candidate.title || "");
  if (title && idx.title.has(title)) return { matched: true, type: "title", value: title, itemKey: idx.title.get(title) };
  return { matched: false };
}

export function resolveWritebackConcurrency(rawValue, defaultConcurrency = 10) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return { value: defaultConcurrency, clamped: false, warning: "" };
  }
  const n = Number(rawValue);
  if (!Number.isFinite(n) || n < 1) {
    return { value: defaultConcurrency, clamped: true, warning: "invalid_writeback_concurrency_fallback_to_default" };
  }
  const value = Math.max(1, Math.floor(n));
  const warning = value > 10 ? "writeback_concurrency_gt_10_high_risk_experiment" : "";
  return { value, clamped: value !== n, warning };
}

export function resolveConcurrencySource(rawValue) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return "default";
  }
  return "env";
}

export function nextWritebackDowngrade(current) {
  const c = Number(current || 1);
  if (c > 10) return 10;
  if (c > 6) return 6;
  if (c > 3) return 3;
  if (c > 1) return 1;
  return 1;
}

export function shouldStopWritebackByRisk({
  failureRate = 0,
  uncertainCreateStateCount = 0,
  fallbackToSerial = false,
  duplicateDetectedCount = 0,
  wrongCollectionDetectedCount = 0,
  mcpErrors = [],
}) {
  if (duplicateDetectedCount > 0 || wrongCollectionDetectedCount > 0) {
    return { stop: true, downgrade: false, reason: "high_risk_data_integrity" };
  }
  if (uncertainCreateStateCount > 0) {
    return { stop: false, downgrade: true, reason: "uncertain_create_state" };
  }
  if (failureRate > 0.05) {
    return { stop: false, downgrade: true, reason: "failure_rate_gt_5pct" };
  }
  if (fallbackToSerial) {
    return { stop: false, downgrade: true, reason: "collection_attach_fallback" };
  }
  const joined = (mcpErrors || []).join(" | ").toLowerCase();
  if (/(database busy|transaction failed|timeout|lock conflict|writeback_failed|429|rate limit)/i.test(joined)) {
    return { stop: false, downgrade: true, reason: "mcp_runtime_error" };
  }
  return { stop: false, downgrade: false, reason: "" };
}

export function parseToolText(result) {
  const txt = result?.content?.[0]?.text || "{}";
  return JSON.parse(txt);
}

export function buildWritebackItemRecord(itemKey, item, sourceCollection, gradeCollection) {
  return {
    itemKey,
    title: item.title || "",
    中文标题: item["中文标题"] || item.title || "",
    grade: item.grade || "",
    grade_label: item.grade_label || item["推荐等级"] || "",
    source_channel: item.source_channel || "",
    source_collection: sourceCollection,
    grade_collection: gradeCollection,
    backfill_short_title: true,
  };
}

export function groupItemKeysByCollection(records = []) {
  const grouped = new Map();
  for (const rec of records) {
    if (!rec?.itemKey) continue;
    for (const key of [rec.pool_collection_key, rec.source_collection_key, rec.grade_collection_key]) {
      if (!key) continue;
      if (!grouped.has(key)) grouped.set(key, new Set());
      grouped.get(key).add(rec.itemKey);
    }
  }
  return grouped;
}

export async function attachItemsByCollectionBatched({
  groupedItemKeys,
  batchSize = 50,
  mcpToolCall,
  idBase = 800000,
}) {
  const attachStats = {
    collection_attach_mode: "batch",
    collection_attach_batch_size: batchSize,
    collection_attach_calls: 0,
    collection_attach_failures: [],
    fallback_to_per_item_count: 0,
  };

  let callOffset = 0;
  for (const [collectionKey, keySet] of (groupedItemKeys || new Map()).entries()) {
    const keys = [...keySet];
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      try {
        attachStats.collection_attach_calls += 1;
        await mcpToolCall("add_items_to_collection", { collectionKey, itemKeys: batch }, idBase + callOffset++);
      } catch (error) {
        attachStats.collection_attach_failures.push({
          collectionKey,
          itemKeys: batch,
          error: String(error?.message || error),
        });
        for (const itemKey of batch) {
          try {
            attachStats.fallback_to_per_item_count += 1;
            attachStats.collection_attach_calls += 1;
            await mcpToolCall("add_items_to_collection", { collectionKey, itemKeys: [itemKey] }, idBase + callOffset++);
          } catch (perItemError) {
            attachStats.collection_attach_failures.push({
              collectionKey,
              itemKeys: [itemKey],
              error: String(perItemError?.message || perItemError),
              fallback: true,
            });
          }
        }
      }
    }
  }
  return attachStats;
}

export function parseDateNameToDate(name) {
  const m = String(name || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function inLast7Days(d, now) {
  if (!d) return false;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d >= start && d <= end;
}

function normalizeTags(rawTags) {
  return (rawTags || [])
    .map((t) => (typeof t === "string" ? { tag: t } : t))
    .filter((x) => x && x.tag);
}

async function getCollectionItemKeys(collectionKey, idBase, mcpToolCall) {
  const keys = [];
  let offset = 0;
  const limit = 500;
  while (true) {
    const items = parseToolText(await mcpToolCall("get_collection_items", { collectionKey, limit, offset }, idBase + offset));
    if (!Array.isArray(items) || !items.length) break;
    for (const it of items) {
      if (it?.key) keys.push(it.key);
    }
    if (items.length < limit) break;
    offset += limit;
  }
  return keys;
}

export async function cleanupSignatureTags(rootKey, worthyKey, { now = new Date(), mcpToolCall }) {
  const tree = parseToolText(await mcpToolCall("get_subcollections", { collectionKey: rootKey, recursive: true }, 600000));
  const collections = new Set([worthyKey]);
  for (const node of tree) {
    const dt = parseDateNameToDate(node.name);
    if (!inLast7Days(dt, now)) continue;
    for (const c of (node.subcollections || [])) {
      if (MIGRATION_SOURCE_NAMES.includes(c.name)) collections.add(c.key);
    }
  }
  const itemKeys = new Set();
  let base = 610000;
  for (const ck of collections) {
    const keys = await getCollectionItemKeys(ck, base, mcpToolCall);
    base += 2000;
    for (const k of keys) itemKeys.add(k);
  }
  const stats = { scanned: 0, cleaned_items: 0, removed_tag_count: 0, failures: [] };
  const keys = [...itemKeys];
  for (let i = 0; i < keys.length; i++) {
    const itemKey = keys[i];
    stats.scanned++;
    try {
      const det = parseToolText(await mcpToolCall("get_item_details", { itemKey, mode: "preview" }, 630000 + i));
      const data = det?.data || {};
      const tags = Array.isArray(data.tags) ? data.tags : (Array.isArray(det?.tags) ? det.tags : []);
      const normalized = normalizeTags(tags);
      const keep = normalized.filter((t) => !BAD_TAG_RE.test(String(t.tag)));
      const removed = normalized.length - keep.length;
      if (removed <= 0) continue;
      await mcpToolCall("write_tag", { action: "set", itemKey, tags: keep.map((t) => String(t.tag)) }, 650000 + i);
      stats.cleaned_items++;
      stats.removed_tag_count += removed;
    } catch (e) {
      if (stats.failures.length < 80) stats.failures.push({ itemKey, error: String(e.message || e) });
    }
  }
  return stats;
}
