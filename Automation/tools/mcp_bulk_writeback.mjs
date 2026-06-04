import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  attachItemsByCollectionBatched,
  buildWritebackItemRecord,
  cleanupSignatureTags,
  groupItemKeysByCollection,
  nextWritebackDowngrade,
  parseToolText,
  resolveConcurrencySource,
  resolveWritebackConcurrency,
  shouldStopWritebackByRisk,
} from "./lib/writeback_support.mjs";
import { LABELS } from "./lib/triage_policy.mjs";
import { ensureZoteroMcpReady } from "./lib/ensure_zotero_mcp_ready.mjs";
import { buildRuntimeConfig } from "./lib/runtime_config.mjs";
import {
  buildZoteroCollectionGuard,
  recordCollectionScopeBlock,
  summarizeCollectionScopeBlocks,
} from "./lib/zotero_collection_guard.mjs";

const RUNTIME = buildRuntimeConfig();
const ROOT = RUNTIME.projectRoot;
const RESEARCH_ROOT = RUNTIME.researchRoot;
const MCP_URL = process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp";
const TODAY = RUNTIME.now;
const mcpCallCounters = new Map();

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function yyMd(d) {
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
}
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

const SOURCE_COLLECTIONS = {
  rss: "RSS订阅",
  database: "数据库检索",
};

const GRADE_COLLECTIONS = {
  [LABELS.A]: LABELS.A,
  [LABELS.B]: LABELS.B,
  [LABELS.C]: LABELS.C,
};
const HISTORY_COLLECTION_MODIFICATION_FORBIDDEN = false;
const STAR_MIGRATION_DISABLED_VALUES = new Set(["disabled", "off", "0", "false", "no"]);
const STAR_MIGRATION_LEGACY_VALUES = new Set(["legacy", "default", "safe", "ab_only", "ab-only", "ab"]);
const STAR_MIGRATION_EXPAND_VALUES = new Set(["expand", "all_grades", "all-grades", "full", "broad"]);

export function parseStarMigrationConfig(env = process.env) {
  const rawMode = String(env.ZOTERO_STAR_MIGRATION_MODE || "").trim().toLowerCase();
  const rawWindow = Number(env.ZOTERO_STAR_MIGRATION_WINDOW_DAYS || 7);
  const rawThreshold = Number(env.ZOTERO_STAR_MIGRATION_MIN_STARS || 4);
  const windowDays = Number.isFinite(rawWindow) && rawWindow > 0 ? Math.floor(rawWindow) : 7;
  const starThreshold = Number.isFinite(rawThreshold) && rawThreshold > 0 ? Math.min(5, Math.max(1, Math.floor(rawThreshold))) : 4;

  if (STAR_MIGRATION_DISABLED_VALUES.has(rawMode)) {
    return { enabled: false, mode: rawMode || "disabled", expandAllGrades: false, windowDays, starThreshold };
  }
  if (STAR_MIGRATION_EXPAND_VALUES.has(rawMode)) {
    return { enabled: true, mode: rawMode || "expand", expandAllGrades: true, windowDays: Math.max(windowDays, 14), starThreshold: Math.min(starThreshold, 2) };
  }

  return { enabled: true, mode: rawMode || "legacy", expandAllGrades: STAR_MIGRATION_LEGACY_VALUES.has(rawMode) ? false : true, windowDays, starThreshold };
}

async function mcpToolCall(name, args, id) {
  mcpCallCounters.set(name, (mcpCallCounters.get(name) || 0) + 1);
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`MCP ${name} failed: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureMcpReady() {
  return ensureZoteroMcpReady({
    mcpProbe: async (attempt) => {
      await mcpToolCall("get_collections", { mode: "minimal", limit: 1 }, 900000 + attempt);
    },
  });
}

async function ensureTopCollectionByName(name, callIdBase = 20) {
  const result = await mcpToolCall("get_collections", { mode: "complete", limit: 1000 }, callIdBase);
  const list = parseToolText(result);
  const exact = (Array.isArray(list) ? list : []).filter((x) => x.name === name && !(x.parentCollection || x.parent));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const signal = name === "文献池" ? "pool_collection_ambiguous" : "top_collection_ambiguous";
    const err = new Error(`TOP_COLLECTION_AMBIGUOUS: 存在多个同名顶层集合 ${name}`);
    err.details = { signal, name, keys: exact.map((x) => x.key) };
    throw err;
  }
  const created = parseToolText(await mcpToolCall("create_collection", { name }, callIdBase + 1));
  return created;
}

async function findTopCollectionByName(name) {
  const result = await mcpToolCall("get_collections", { mode: "complete", limit: 1000 }, 2);
  const list = parseToolText(result);
  const exact = (Array.isArray(list) ? list : []).filter((x) => x.name === name && !(x.parentCollection || x.parent));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const err = new Error(`TOP_COLLECTION_AMBIGUOUS: 存在多个同名顶层集合 ${name}`);
    err.details = { signal: "top_collection_ambiguous", name, keys: exact.map((x) => x.key) };
    throw err;
  }
  return null;
}

async function findCollectionByName(name) {
  const result = await mcpToolCall("get_collections", { mode: "complete", limit: 500 }, 2);
  const list = parseToolText(result);
  return list.find((x) => x.name === name) || null;
}

async function buildCollectionGuard(rootKey) {
  const top = parseToolText(await mcpToolCall("get_collections", { mode: "complete", limit: 1000 }, 3));
  const collections = Array.isArray(top) ? [...top] : [];
  if (rootKey) {
    try {
      const descendants = parseToolText(await mcpToolCall("get_subcollections", { collectionKey: rootKey, recursive: true }, 4));
      if (Array.isArray(descendants)) collections.push(...descendants);
    } catch {
      // Guard still fails closed if required collections cannot be resolved.
    }
  }
  return buildZoteroCollectionGuard(collections);
}

async function ensureChildCollection(parentKey, name, callIdBase, { collectionGuard = null, collectionScopeBlocks = null } = {}) {
  if (collectionGuard) {
    const check = collectionGuard.checkCollectionKey(parentKey, { action: "create_collection", role: "parent" });
    if (!check.ok) {
      recordCollectionScopeBlock(collectionScopeBlocks, check, { target_name: name });
      throw new Error(`collection_scope_blocked:create_collection:${check.reason}`);
    }
  }
  const children = parseToolText(await mcpToolCall("get_subcollections", { collectionKey: parentKey, recursive: false }, callIdBase));
  const existing = children.find((x) => x.name === name);
  if (existing) return existing.key;
  const created = parseToolText(await mcpToolCall("create_collection", { name, parentCollection: parentKey }, callIdBase + 1));
  return created.key;
}

function buildExtra(it) {
  return safeStr([
    it.pmid ? `PMID: ${it.pmid}` : "",
    it.pmcid ? `PMCID: ${it.pmcid}` : "",
    it.doi ? `DOI: ${it.doi}` : "",
    `source_channel: ${it.source_channel || ""}`,
    `source_platform: ${it.source_platform || ""}`,
    `grade: ${it.grade || ""}`,
    `grade_label: ${it.grade_label || it["推荐等级"] || ""}`,
  ].filter(Boolean).join("\n"));
}

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

function normDoi(s) {
  return norm(s)
    .replace(/^https?:\/\/doi\.org\//, "")
    .replace(/^doi:\s*/, "")
    .trim();
}

function normalizeTitleForMatch(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[\u2010-\u2015\u2212\uff0d]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B\u02BC\u2032\uff07]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\uff02]/g, '"')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/[\uFE30\uFE31\uFE32\uFE33\uFE34\uFE58\uFE63\uff0d]/g, "-")
    .replace(/\.{3}/g, " ")
    .replace(/…/g, " ")
    .replace(/~/g, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\uff10-\uff19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 48))
    .replace(/[\uff21-\uff3a]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF21 + 97))
    .replace(/[\uff41-\uff5a]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF41 + 97))
    .replace(/[\u00bc-\u00be]/g, (ch) => ({ "\u00bc": "1/4", "\u00bd": "1/2", "\u00be": "3/4" }[ch] || ch))
    .replace(/[\u2150-\u215f]/g, (ch) => ({
      "\u2150": "1/7", "\u2151": "1/9", "\u2152": "1/10", "\u2153": "1/3", "\u2154": "2/3", "\u2155": "1/5", "\u2156": "2/5", "\u2157": "3/5", "\u2158": "4/5", "\u2159": "1/6", "\u215a": "5/6", "\u215b": "1/8", "\u215c": "3/8", "\u215d": "5/8", "\u215e": "7/8", "\u215f": "1"
    }[ch] || ch))
    .replace(/[\u2460-\u2473\u2474-\u2487\u2488-\u249b\u3251-\u325f\u3260-\u327e\u3280-\u32bf\u32d0-\u32fe]/g, (ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 0x2460 && code <= 0x2473) return String(code - 0x2460 + 1);
      if (code >= 0x2474 && code <= 0x2487) return String(code - 0x2474 + 1);
      if (code >= 0x2488 && code <= 0x249b) return String(code - 0x2488 + 1);
      if (code >= 0x3251 && code <= 0x325f) return String(code - 0x3251 + 21);
      if (code >= 0x3260 && code <= 0x327e) return String(code - 0x3260 + 1);
      if (code >= 0x3280 && code <= 0x32bf) return String(code - 0x3280 + 1);
      if (code >= 0x32d0 && code <= 0x32fe) return String(code - 0x32d0 + 1);
      return " ";
    })
    .replace(/[\u2460-\u2473\u2474-\u2487\u2488-\u249b\u3251-\u325f\u3260-\u327e\u3280-\u32bf\u32d0-\u32fe]/g, " ")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
}


function getFingerprints(it) {
  const doi = normDoi(it?.doi || it?.DOI || "");
  const pmid = norm(it?.pmid || "");
  const pmcid = norm(it?.pmcid || "");
  const arxiv = norm(it?.arxiv || it?.arxiv_id || "");
  const title = normalizeTitleForMatch(it?.title || "");
  return { doi, pmid, pmcid, arxiv, title };
}

function pushIndex(map, key, itemKey) {
  if (!key) return;
  if (!map.has(key)) map.set(key, itemKey);
}

async function getCollectionItemKeys(collectionKey, idBase, overrideMcpToolCall) {
  const call = overrideMcpToolCall || mcpToolCall;
  const keys = [];
  let offset = 0;
  const limit = 500;
  while (true) {
    const items = parseToolText(await call("get_collection_items", { collectionKey, limit, offset }, idBase + offset));
    if (!Array.isArray(items) || !items.length) break;
    for (const it of items) {
      if (it?.key) keys.push(it.key);
    }
    if (items.length < limit) break;
    offset += limit;
  }
  return keys;
}

async function buildPoolIndex(rootKey) {
  const allKeys = new Set();
  const keys = await getCollectionItemKeys(rootKey, 510000);
  for (const k of keys) allKeys.add(k);

  const idx = { byDoi: new Map(), byPmid: new Map(), byPmcid: new Map(), byArxiv: new Map(), byTitle: new Map(), meta: new Map() };
  const keyArr = [...allKeys];
  for (let i = 0; i < keyArr.length; i++) {
    const itemKey = keyArr[i];
    try {
      const det = parseToolText(await mcpToolCall("get_item_details", { itemKey, mode: "preview" }, 530000 + i));
      const d = det?.data || det || {};
      const fp = getFingerprints({
        doi: d.DOI || d.doi || "",
        pmid: d.extra && String(d.extra).match(/PMID:\s*([^\s]+)/i)?.[1],
        pmcid: d.extra && String(d.extra).match(/PMCID:\s*([^\s]+)/i)?.[1],
        arxiv: d.extra && String(d.extra).match(/arXiv:\s*([^\s]+)/i)?.[1],
        title: d.title || det?.title || "",
      });
      pushIndex(idx.byDoi, fp.doi, itemKey);
      pushIndex(idx.byPmid, fp.pmid, itemKey);
      pushIndex(idx.byPmcid, fp.pmcid, itemKey);
      pushIndex(idx.byArxiv, fp.arxiv, itemKey);
      pushIndex(idx.byTitle, fp.title, itemKey);
      idx.meta.set(itemKey, { title: d.title || det?.title || "" });
    } catch {
      // ignore broken item read
    }
  }
  return idx;
}

function findByIndex(it, idx) {
  const fp = getFingerprints(it);
  if (fp.doi && idx.byDoi.has(fp.doi)) return { itemKey: idx.byDoi.get(fp.doi), reason: "duplicate_by_doi", type: "doi", value: fp.doi };
  if (fp.pmid && idx.byPmid.has(fp.pmid)) return { itemKey: idx.byPmid.get(fp.pmid), reason: "duplicate_by_pmid", type: "pmid", value: fp.pmid };
  if (fp.pmcid && idx.byPmcid.has(fp.pmcid)) return { itemKey: idx.byPmcid.get(fp.pmcid), reason: "duplicate_by_pmcid", type: "pmcid", value: fp.pmcid };
  if (fp.arxiv && idx.byArxiv.has(fp.arxiv)) return { itemKey: idx.byArxiv.get(fp.arxiv), reason: "duplicate_by_arxiv", type: "arxiv", value: fp.arxiv };
  if (fp.title && idx.byTitle.has(fp.title)) return { itemKey: idx.byTitle.get(fp.title), reason: "duplicate_by_title_exact", type: "title", value: fp.title };
  return null;
}

async function findExistingByExactFields(it, idBase) {
  const queries = [it.doi, it.pmid, it.pmcid, it.arxiv, it.title].filter(Boolean);
  for (let qi = 0; qi < queries.length; qi++) {
    const q = String(queries[qi]).trim();
    if (!q) continue;
    const res = parseToolText(await mcpToolCall("search_library", { q, limit: 8, mode: "preview", relevanceScoring: true }, idBase + qi));
    if (!Array.isArray(res) || !res.length) continue;
    const target = getFingerprints(it);
    for (const hit of res) {
      const h = getFingerprints({
        doi: hit?.DOI || hit?.doi || "",
        arxiv: String(hit?.extra || "").match(/arXiv:\s*([^\s]+)/i)?.[1] || "",
        title: hit?.title || "",
      });
      if (target.doi && h.doi && target.doi === h.doi) return hit?.key || null;
      if (target.pmid && h.pmid && target.pmid === h.pmid) return hit?.key || null;
      if (target.pmcid && h.pmcid && target.pmcid === h.pmcid) return hit?.key || null;
      if (target.arxiv && h.arxiv && target.arxiv === h.arxiv) return hit?.key || null;
      if (target.title && h.title && target.title === h.title) return hit?.key || null;
    }
  }
  return null;
}

function safeStr(v) {
  return String(v || "")
    // Remove control chars except \t \n \r
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .normalize("NFC");
}

async function createItem(it, i) {
  const fields = {
    title: safeStr(it.title),
    url: safeStr(it.url),
    DOI: safeStr(it.doi),
    date: safeStr(it.pubdate),
    publicationTitle: safeStr(it.journal),
    abstractNote: safeStr(it.abstract),
    extra: buildExtra(it),
  };
  const itemType = "journalArticle";
  const tags = ["research-os", "自动入库", it.grade_label || it["推荐等级"] || "", it.source_channel || ""]
    .filter((t) => String(t || "").trim());
  try {
    const created = await mcpToolCall("write_item", {
      action: "create",
      itemType,
      fields,
      tags,
    }, 10000 + i * 3);
    return parseToolText(created)?.data?.itemKey;
  } catch (e) {
    const safe = { title: fields.title?.slice(0, 80), doi: fields.DOI, idx: i };
    console.error(`[createItem] MCP write_item failed for item #${i}:`, JSON.stringify(safe), String(e?.message || e).slice(0, 200));
    throw e;
  }
}

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

function parseDateNameToDate(name) {
  const m = String(name || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function inLastNDays(d, now, days) {
  if (!d) return false;
  const n = Number(days || 7);
  const windowDays = Number.isFinite(n) && n > 0 ? Math.floor(n) : 7;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - windowDays);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d >= start && d <= end;
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

export async function migrateRatedItems({ rootKey, worthyKey, now, mcpToolCall, starMigrationConfig, collectionGuard = null, collectionScopeBlocks = null }) {
  const migrationConfig = starMigrationConfig || { enabled: true, mode: "legacy", expandAllGrades: false, windowDays: 7, starThreshold: 4 };
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
    worthy_collection_key: worthyKey || "",
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

  const tree = parseToolText(await mcpToolCall("get_subcollections", { collectionKey: rootKey, recursive: true }, 660000));
  const dateNodes = (tree || []).filter((node) => inLastNDays(parseDateNameToDate(node?.name), now, stats.window_days));
  const worthyItems = new Set(await getCollectionItemKeys(worthyKey, 670000, mcpToolCall));
  const processedEligibleKeys = new Set();

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
      const keys = await getCollectionItemKeys(gradeCollection.key, 680000 + candidateItemKeys.size, mcpToolCall);
      for (const key of keys) candidateItemKeys.add(key);
    }

    stats.scanned_date_collections += 1;
    stats.date_collections.push({ name: node?.name || "", key: node?.key || "", candidate_items: candidateItemKeys.size });

    for (const itemKey of candidateItemKeys) {
      stats.scanned_candidates += 1;
      let detail;
      try {
        detail = parseToolText(await mcpToolCall("get_item_details", { itemKey, mode: "preview" }, 690000 + stats.scanned_candidates));
      } catch (error) {
        stats.errors.push({ itemKey, error: String(error?.message || error), phase: "read_item_details" });
        stats.removal_failures.push({ itemKey, error: String(error?.message || error), phase: "read_item_details" });
        continue;
      }
      const data = detail?.data || detail || {};
      const tags = Array.isArray(data.tags) ? data.tags : Array.isArray(detail?.tags) ? detail.tags : [];
      if (!hasStrongStarMark(data, tags)) continue;

      if (!isItemValidForMigration(data)) {
        stats.skipped_invalid += 1;
        continue;
      }

      if (processedEligibleKeys.has(itemKey)) {
        stats.duplicate_candidates_skipped += 1;
        continue;
      }

      processedEligibleKeys.add(itemKey);
      stats.eligible_items += 1;

      if (worthyItems.has(itemKey)) {
        stats.already_in_worthy += 1;
        stats.skipped_already_exists += 1;
        continue;
      }

      try {
        if (collectionGuard) {
          const check = collectionGuard.checkCollectionKey(worthyKey, { action: "add_items_to_collection", role: "worthy_target" });
          if (!check.ok) {
            const block = recordCollectionScopeBlock(collectionScopeBlocks, check, { itemKey, phase: "add_to_worthy" });
            stats.errors.push(block);
            stats.add_failures.push(block);
            continue;
          }
        }
        await mcpToolCall("add_items_to_collection", { collectionKey: worthyKey, itemKeys: [itemKey] }, 700000 + stats.eligible_items);
        worthyItems.add(itemKey);
        stats.moved_to_worthy += 1;
      } catch (error) {
        stats.errors.push({ itemKey, error: String(error?.message || error), phase: "add_to_worthy" });
        stats.add_failures.push({ itemKey, error: String(error?.message || error), phase: "add_to_worthy" });
        continue;
      }

      const collectionsToRemove = new Set();
      for (const collection of sourceCollections) {
        if (collection?.key) collectionsToRemove.add(collection.key);
      }
      for (const collection of gradeCollections) {
        if (collection?.key) collectionsToRemove.add(collection.key);
      }

      for (const collectionKey of collectionsToRemove) {
        try {
          if (collectionGuard) {
            const check = collectionGuard.checkCollectionKey(collectionKey, { action: "remove_items_from_collection", role: collectionRoleByKey.get(collectionKey) || "date_subcollection" });
            if (!check.ok) {
              const block = recordCollectionScopeBlock(collectionScopeBlocks, check, { itemKey, phase: "remove_from_day_collections" });
              stats.errors.push(block);
              stats.removal_failures.push(block);
              continue;
            }
          }
          await mcpToolCall("remove_items_from_collection", { collectionKey, itemKeys: [itemKey] }, 710000 + stats.removed_from_source_collections + stats.removed_from_grade_collections);
          if (collectionRoleByKey.get(collectionKey) === "source") {
            stats.removed_from_source_collections += 1;
          } else {
            stats.removed_from_grade_collections += 1;
          }
        } catch (error) {
          stats.errors.push({ itemKey, collectionKey, error: String(error?.message || error), phase: "remove_from_day_collections" });
          stats.removal_failures.push({ itemKey, collectionKey, error: String(error?.message || error), phase: "remove_from_day_collections" });
        }
      }

      // Also remove from root pool to keep root and date subcollections in sync
      try {
        if (collectionGuard) {
          const check = collectionGuard.checkCollectionKey(rootKey, { action: "remove_items_from_collection", role: "root_pool" });
          if (!check.ok) {
            const block = recordCollectionScopeBlock(collectionScopeBlocks, check, { itemKey, phase: "remove_from_root_pool" });
            stats.errors.push(block);
            stats.removal_failures.push(block);
            continue;
          }
        }
        await mcpToolCall("remove_items_from_collection", { collectionKey: rootKey, itemKeys: [itemKey] }, 720000 + stats.removed_from_root_pool);
        stats.removed_from_root_pool += 1;
      } catch (error) {
        stats.errors.push({ itemKey, collectionKey: rootKey, error: String(error?.message || error), phase: "remove_from_root_pool" });
        stats.removal_failures.push({ itemKey, collectionKey: rootKey, error: String(error?.message || error), phase: "remove_from_root_pool" });
      }
    }
  }

  return stats;
}

export async function runMcpBulkWriteback({ argv = process.argv } = {}) {
  const stageStarted = Date.now();
  const collectionSetupStarted = Date.now();
  await ensureMcpReady();
  const dateStr = fmtDate(TODAY);
  const week = isoWeek(TODAY);
  const day = yyMd(TODAY);
  const pipelineDir = path.join(RESEARCH_ROOT, "pipeline", day);
  const triagedPath = path.join(pipelineDir, "writeback_ready_items.json");
  const summaryPath = path.join(pipelineDir, "mcp_writeback_summary.json");
  const runReportPath = path.join(pipelineDir, "run_report.json");

  const limitArg = argv.find((x) => x.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : null;
  const offsetArg = argv.find((x) => x.startsWith("--offset="));
  const offset = offsetArg ? Number(offsetArg.split("=")[1]) : 0;
  const inputFileArg = argv.find((x) => x.startsWith("--input-file="));
  const inputFile = inputFileArg ? inputFileArg.split("=")[1] : null;
  const starMigrationConfig = parseStarMigrationConfig();
  const collectionScopeBlocks = [];

  const triaged = inputFile
    ? JSON.parse(await fs.readFile(inputFile, "utf8"))
    : JSON.parse(await fs.readFile(triagedPath, "utf8"));
  const itemsAll = (limit ? triaged.slice(offset, offset + limit) : triaged.slice(offset));
  const items = itemsAll.filter((x) => x.grade !== "D");

  const root = await ensureTopCollectionByName("文献池", 20);
  let collectionGuard = await buildCollectionGuard(root.key);
  if (!collectionGuard.ready) {
    const err = new Error(`collection_scope_blocked:${collectionGuard.rootIssue || "guard_not_ready"}`);
    err.details = collectionGuard.audit;
    throw err;
  }
  const trashKey = await ensureChildCollection(root.key, "待删除", 48, { collectionGuard, collectionScopeBlocks });
  collectionGuard = await buildCollectionGuard(root.key);
  const worthy = await ensureTopCollectionByName("值得精读", 52);
  collectionGuard = await buildCollectionGuard(root.key);
  const requiredBaseChecks = [
    collectionGuard.checkCollectionKey(root.key, { action: "create_collection", role: "root_pool" }),
    collectionGuard.checkCollectionKey(trashKey, { action: "create_collection", role: "trash_collection" }),
    collectionGuard.checkCollectionKey(worthy?.key, { action: "create_collection", role: "worthy_collection" }),
  ];
  const blockedBaseChecks = requiredBaseChecks.filter((check) => !check.ok);
  for (const check of blockedBaseChecks) recordCollectionScopeBlock(collectionScopeBlocks, check, { phase: "base_collection_validation" });
  if (blockedBaseChecks.length) {
    const err = new Error(`collection_scope_blocked: base collection outside managed scope (${blockedBaseChecks[0].reason})`);
    err.details = {
      ...collectionGuard.audit,
      ...summarizeCollectionScopeBlocks(collectionScopeBlocks),
    };
    throw err;
  }
  const poolIndex = await buildPoolIndex(root.key);

  // 构建"待删除"去重索引：已在待删除集合中的条目同样不入库
  let trashIndex = { byDoi: new Map(), byPmid: new Map(), byPmcid: new Map(), byArxiv: new Map(), byTitle: new Map(), meta: new Map() };
  let trashItemCount = 0;
  try {
    const rootChildren = parseToolText(await mcpToolCall("get_subcollections", { collectionKey: root.key, recursive: false }, 534000));
    const trashCollection = (Array.isArray(rootChildren) ? rootChildren : []).find((x) => x.key === trashKey);
    if (trashCollection) {
      const trashKeys = await getCollectionItemKeys(trashCollection.key, 535000);
      for (let ti = 0; ti < trashKeys.length; ti++) {
        const itemKey = trashKeys[ti];
        try {
          const det = parseToolText(await mcpToolCall("get_item_details", { itemKey, mode: "preview" }, 537000 + ti));
          const d = det?.data || det || {};
          const fp = getFingerprints({
            doi: d.DOI || d.doi || "",
            pmid: d.extra && String(d.extra).match(/PMID:\s*([^\s]+)/i)?.[1],
            pmcid: d.extra && String(d.extra).match(/PMCID:\s*([^\s]+)/i)?.[1],
            arxiv: d.extra && String(d.extra).match(/arXiv:\s*([^\s]+)/i)?.[1],
            title: d.title || det?.title || "",
          });
          pushIndex(trashIndex.byDoi, fp.doi, itemKey);
          pushIndex(trashIndex.byPmid, fp.pmid, itemKey);
          pushIndex(trashIndex.byPmcid, fp.pmcid, itemKey);
          pushIndex(trashIndex.byArxiv, fp.arxiv, itemKey);
          pushIndex(trashIndex.byTitle, fp.title, itemKey);
          trashIndex.meta.set(itemKey, { title: d.title || det?.title || "" });
          trashItemCount++;
        } catch {
          // ignore broken item read
        }
      }
    }
  } catch {
    // 待删除集合不存在或无法访问时忽略
  }

  // 构建"值得精读"去重索引：已进入值得精读集合的条目不再重复入库
  let worthyIndex = { byDoi: new Map(), byPmid: new Map(), byPmcid: new Map(), byArxiv: new Map(), byTitle: new Map(), meta: new Map() };
  let worthyItemCount = 0;
  try {
    const worthyCollection = worthy || await findTopCollectionByName("值得精读");
    if (worthyCollection?.key) {
      const worthyKeys = await getCollectionItemKeys(worthyCollection.key, 538000);
      for (let wi = 0; wi < worthyKeys.length; wi++) {
        const itemKey = worthyKeys[wi];
        try {
          const det = parseToolText(await mcpToolCall("get_item_details", { itemKey, mode: "preview" }, 539000 + wi));
          const d = det?.data || det || {};
          const fp = getFingerprints({
            doi: d.DOI || d.doi || "",
            pmid: d.extra && String(d.extra).match(/PMID:\s*([^\s]+)/i)?.[1],
            pmcid: d.extra && String(d.extra).match(/PMCID:\s*([^\s]+)/i)?.[1],
            arxiv: d.extra && String(d.extra).match(/arXiv:\s*([^\s]+)/i)?.[1],
            title: d.title || det?.title || "",
          });
          pushIndex(worthyIndex.byDoi, fp.doi, itemKey);
          pushIndex(worthyIndex.byPmid, fp.pmid, itemKey);
          pushIndex(worthyIndex.byPmcid, fp.pmcid, itemKey);
          pushIndex(worthyIndex.byArxiv, fp.arxiv, itemKey);
          pushIndex(worthyIndex.byTitle, fp.title, itemKey);
          worthyIndex.meta.set(itemKey, { title: d.title || det?.title || "" });
          worthyItemCount++;
        } catch {
          // ignore broken item read
        }
      }
    }
  } catch {
    // 值得精读集合不存在或无法访问时忽略
  }

  const dateKey = await ensureChildCollection(root.key, dateStr, 50, { collectionGuard, collectionScopeBlocks });
  collectionGuard = await buildCollectionGuard(root.key);

  const sourceKeys = {};
  const gradeKeys = {};
  for (const name of Object.values(SOURCE_COLLECTIONS)) {
    sourceKeys[name] = await ensureChildCollection(dateKey, name, 100 + Object.keys(sourceKeys).length * 2, { collectionGuard, collectionScopeBlocks });
  }
  collectionGuard = await buildCollectionGuard(root.key);
  for (const name of Object.values(GRADE_COLLECTIONS)) {
    gradeKeys[name] = await ensureChildCollection(dateKey, name, 200 + Object.keys(gradeKeys).length * 2, { collectionGuard, collectionScopeBlocks });
  }
  collectionGuard = await buildCollectionGuard(root.key);
  const requiredTargetChecks = [
    { key: root.key, action: "add_items_to_collection", role: "root_pool" },
    ...Object.values(sourceKeys).map((key) => ({ key, action: "add_items_to_collection", role: "source_collection" })),
    ...Object.values(gradeKeys).map((key) => ({ key, action: "add_items_to_collection", role: "grade_collection" })),
  ].map((entry) => collectionGuard.checkCollectionKey(entry.key, { action: entry.action, role: entry.role }));
  const blockedRequiredTargets = requiredTargetChecks.filter((check) => !check.ok);
  for (const check of blockedRequiredTargets) recordCollectionScopeBlock(collectionScopeBlocks, check, { phase: "writeback_target_validation" });
  if (blockedRequiredTargets.length) {
    const err = new Error(`collection_scope_blocked: writeback target outside managed scope (${blockedRequiredTargets[0].reason})`);
    err.details = {
      ...collectionGuard.audit,
      ...summarizeCollectionScopeBlocks(collectionScopeBlocks),
    };
    throw err;
  }
  const collectionSetupMs = Date.now() - collectionSetupStarted;

  const counters = {
    total: items.length,
    created: 0,
    added_to_pool: 0,
    added_to_daily_collection: 0,
    failed: 0,
    by_source: { rss: 0, database: 0, other: 0 },
    by_grade: { [LABELS.A]: 0, [LABELS.B]: 0, [LABELS.C]: 0, other: 0 },
    reused_existing: 0, // backward compatibility
    skipped_historical_duplicate: 0, // backward compatibility
    skipped_duplicate_in_pool: 0,
    skipped_duplicate_in_trash: 0,
    skipped_duplicate_in_worthy: 0,
  };
  const failures = [];
  const skippedDuplicatesInPool = [];
  const skippedDuplicatesInTrash = [];
  const duplicateRecords = [];
  const writebackItems = [];
  const attachBatchSize = Math.max(1, Number(process.env.ZOTERO_COLLECTION_ATTACH_BATCH_SIZE || 50));
  const writebackConcurrencyRaw = process.env.ZOTERO_WRITEBACK_CONCURRENCY;
  const configuredConcurrency = Number(writebackConcurrencyRaw || 10);
  const concurrencySource = resolveConcurrencySource(writebackConcurrencyRaw);
  const resolvedWritebackConcurrency = resolveWritebackConcurrency(writebackConcurrencyRaw, 10);
  let writebackConcurrency = resolvedWritebackConcurrency.value;
  const concurrencyWarning = resolvedWritebackConcurrency.warning;
  const concurrencyClamped = resolvedWritebackConcurrency.clamped;
  const writebackRetryLimit = Math.max(0, Number(process.env.ZOTERO_WRITEBACK_RETRY_LIMIT || 1));
  const observationMode = process.env.ZOTERO_WRITEBACK_OBSERVATION_MODE === "1";
  const writebackBatchSize = Math.max(1, Number(process.env.ZOTERO_WRITEBACK_CONCURRENCY_BATCH_SIZE || 20));
  let retryCount = 0;
  let duplicatePreventedCount = 0;
  let duplicateDetectedCount = 0;
  let wrongCollectionDetectedCount = 0;
  let uncertainCreateStateCount = 0;
  let inFlightDedupeWaitCount = 0;
  const inFlightByDedupeKey = new Map();
  const writebackRecords = [];
  const batchObservations = [];
  let autoDowngrade = {
    auto_downgrade_triggered: false,
    original_concurrency: writebackConcurrency,
    downgraded_concurrency: writebackConcurrency,
    downgrade_reason: "",
    downgrade_at_batch: null,
    downgrade_error: "",
    items_completed_before_downgrade: 0,
    items_remaining_after_downgrade: 0,
  };
  let stopForHighRisk = false;
  let stopReason = "";

  const itemWritebackStarted = Date.now();
  async function processItem(it, i) {
    const dedupeKey = String(it?.dedupe_key || normalizeTitleForMatch(it?.title || "") || `idx:${i}`);
    if (inFlightByDedupeKey.has(dedupeKey)) {
      inFlightDedupeWaitCount += 1;
      await inFlightByDedupeKey.get(dedupeKey);
    }
    const running = (async () => {
      try {
      let duplicateMatch = findByIndex(it, poolIndex);
      let itemKey = duplicateMatch?.itemKey || "";
      let duplicateInPool = Boolean(itemKey);
      let duplicateInTrash = false;
      let duplicateInWorthy = false;
      if (!duplicateInPool) {
        // 如果文献池中未找到，检查待删除集合
        duplicateMatch = findByIndex(it, trashIndex);
        itemKey = duplicateMatch?.itemKey || "";
        duplicateInTrash = Boolean(itemKey);
        if (duplicateInTrash) {
          duplicateMatch = { ...duplicateMatch, reason: (duplicateMatch.reason || "").replace("duplicate_", "duplicate_trash_") };
        }
      }
      if (!duplicateInPool && !duplicateInTrash) {
        // 如果文献池和待删除中均未找到，检查值得精读集合
        duplicateMatch = findByIndex(it, worthyIndex);
        itemKey = duplicateMatch?.itemKey || "";
        duplicateInWorthy = Boolean(itemKey);
        if (duplicateInWorthy) {
          duplicateMatch = { ...duplicateMatch, reason: (duplicateMatch.reason || "").replace("duplicate_", "duplicate_worthy_") };
        }
      }
      if (!duplicateInPool && !duplicateInTrash && !duplicateInWorthy) {
        itemKey = await findExistingByExactFields(it, 700000 + i * 5);
      }
      if (duplicateInPool) duplicatePreventedCount += 1;
      const sourceName = SOURCE_COLLECTIONS[it.source_channel] || SOURCE_COLLECTIONS.rss;
      const gradeName = GRADE_COLLECTIONS[it.grade_label] || LABELS.C;

      // Root-pool dedup policy: duplicates are fully skipped for current-day filing.
      if (duplicateInPool) {
        counters.reused_existing++;
        counters.skipped_historical_duplicate++;
        counters.skipped_duplicate_in_pool++;
        if (skippedDuplicatesInPool.length < 200) {
          skippedDuplicatesInPool.push({
            idx: i,
            title: (it.title || "").slice(0, 180),
            source_channel: it.source_channel || "",
            grade: it.grade_label || "",
            existing_itemKey: itemKey || "",
          });
        }
        if (duplicateRecords.length < 500) {
          duplicateRecords.push({
            candidate_id: i,
            title: (it.title || "").slice(0, 300),
            duplicate_reason: duplicateMatch?.reason || "duplicate_in_pool",
            matched_pool_item_key: itemKey || "",
            matched_identifier_type: duplicateMatch?.type || "unknown",
            matched_identifier_value: duplicateMatch?.value || "",
            pool_item_title: poolIndex.meta?.get(itemKey)?.title || "",
            action: "skipped_duplicate_in_pool",
          });
        }
        writebackRecords.push({ idx: i, dedupe_key: dedupeKey, itemKey, status: "skipped_duplicate_in_pool" });
        return;
      }

      // 待删除去重：已在待删除集合中的条目同样不入库
      if (duplicateInTrash) {
        counters.skipped_duplicate_in_trash++;
        if (skippedDuplicatesInTrash.length < 200) {
          skippedDuplicatesInTrash.push({
            idx: i,
            title: (it.title || "").slice(0, 180),
            source_channel: it.source_channel || "",
            grade: it.grade_label || "",
            existing_itemKey: itemKey || "",
          });
        }
        if (duplicateRecords.length < 500) {
          duplicateRecords.push({
            candidate_id: i,
            title: (it.title || "").slice(0, 300),
            duplicate_reason: duplicateMatch?.reason || "duplicate_in_trash",
            matched_pool_item_key: itemKey || "",
            matched_identifier_type: duplicateMatch?.type || "unknown",
            matched_identifier_value: duplicateMatch?.value || "",
            pool_item_title: trashIndex.meta?.get(itemKey)?.title || "",
            action: "skipped_duplicate_in_trash",
          });
        }
        writebackRecords.push({ idx: i, dedupe_key: dedupeKey, itemKey, status: "skipped_duplicate_in_trash" });
        return;
      }

      // 值得精读去重：已进入值得精读集合的条目不再重复入库
      if (duplicateInWorthy) {
        counters.skipped_duplicate_in_worthy++;
        if (duplicateRecords.length < 500) {
          duplicateRecords.push({
            candidate_id: i,
            title: (it.title || "").slice(0, 300),
            duplicate_reason: duplicateMatch?.reason || "duplicate_in_worthy",
            matched_pool_item_key: itemKey || "",
            matched_identifier_type: duplicateMatch?.type || "unknown",
            matched_identifier_value: duplicateMatch?.value || "",
            pool_item_title: worthyIndex.meta?.get(itemKey)?.title || "",
            action: "skipped_duplicate_in_worthy",
          });
        }
        writebackRecords.push({ idx: i, dedupe_key: dedupeKey, itemKey, status: "skipped_duplicate_in_worthy" });
        return;
      }

      if (!itemKey) {
        for (let attempt = 0; attempt <= writebackRetryLimit; attempt++) {
          try {
            itemKey = await createItem(it, i);
            break;
          } catch (createError) {
            if (attempt >= writebackRetryLimit) throw createError;
            retryCount += 1;
            // Retry must re-check dedupe before a second create attempt.
            const recheck = findByIndex(it, poolIndex) || findByIndex(it, trashIndex) || findByIndex(it, worthyIndex) || await findExistingByExactFields(it, 760000 + i * 5 + attempt);
            if (recheck) {
              itemKey = recheck;
              duplicatePreventedCount += 1;
              counters.skipped_duplicate_in_pool++;
              if (skippedDuplicatesInPool.length < 200) {
                skippedDuplicatesInPool.push({
                  idx: i,
                  title: (it.title || "").slice(0, 180),
                  source_channel: it.source_channel || "",
                  grade: it.grade_label || "",
                  existing_itemKey: itemKey || "",
                });
              }
              break;
            }
          }
        }
      }
      if (!itemKey) throw new Error("create_item_no_key");
      const fp = getFingerprints(it);
      pushIndex(poolIndex.byDoi, fp.doi, itemKey);
      pushIndex(poolIndex.byPmid, fp.pmid, itemKey);
      pushIndex(poolIndex.byPmcid, fp.pmcid, itemKey);
      pushIndex(poolIndex.byArxiv, fp.arxiv, itemKey);
      pushIndex(poolIndex.byTitle, fp.title, itemKey);
      if (poolIndex.meta) poolIndex.meta.set(itemKey, { title: it.title || "" });

      writebackItems.push({
        ...buildWritebackItemRecord(itemKey, it, sourceName, gradeName),
        pool_collection_key: root.key,
        source_collection_key: sourceKeys[sourceName],
        grade_collection_key: gradeKeys[gradeName],
      });

      counters.created++;
      counters.by_source[it.source_channel] = (counters.by_source[it.source_channel] || 0) + 1;
      counters.by_grade[it.grade_label] = (counters.by_grade[it.grade_label] || 0) + 1;
      writebackRecords.push({ idx: i, dedupe_key: dedupeKey, itemKey, status: "created" });
    } catch (e) {
      if (/timeout|database busy|transaction failed|lock conflict|writeback_failed|rate limit|429/i.test(String(e?.message || e))) {
        uncertainCreateStateCount += 1;
      }
      counters.failed++;
      if (failures.length < 100) {
        failures.push({
          idx: i,
          title: (it.title || "").slice(0, 180),
          source_channel: it.source_channel,
          grade: it.grade_label,
          error: String(e.message || e),
        });
      }
      writebackRecords.push({ idx: i, dedupe_key: dedupeKey, itemKey: "", status: "failed", error: String(e.message || e) });
    }
    })();
    inFlightByDedupeKey.set(dedupeKey, running);
    try {
      await running;
    } finally {
      inFlightByDedupeKey.delete(dedupeKey);
    }
  }

  let processedCount = 0;
  let batchIndex = 0;
  while (processedCount < items.length && !stopForHighRisk) {
    batchIndex += 1;
    const batchStarted = Date.now();
    const currentBatch = items.slice(processedCount, Math.min(items.length, processedCount + writebackBatchSize));
    const before = {
      created: counters.created,
      failed: counters.failed,
      retryCount,
      duplicateDetectedCount,
      uncertainCreateStateCount,
    };
    const workers = Array.from({ length: writebackConcurrency }).map(async (_, workerIndex) => {
      for (let i = workerIndex; i < currentBatch.length; i += writebackConcurrency) {
        await processItem(currentBatch[i], processedCount + i);
      }
    });
    await Promise.all(workers);
    processedCount += currentBatch.length;
    const batchFailures = counters.failed - before.failed;
    const batchFailureRate = currentBatch.length ? batchFailures / currentBatch.length : 0;
    const batchMcpErrors = failures.slice(-Math.max(1, batchFailures)).map((x) => String(x.error || ""));
    const risk = shouldStopWritebackByRisk({
      failureRate: batchFailureRate,
      uncertainCreateStateCount: uncertainCreateStateCount - before.uncertainCreateStateCount,
      fallbackToSerial: false,
      duplicateDetectedCount: duplicateDetectedCount - before.duplicateDetectedCount,
      wrongCollectionDetectedCount: 0,
      mcpErrors: batchMcpErrors,
    });
    if (observationMode) {
      batchObservations.push({
        batch_index: batchIndex,
        batch_size: currentBatch.length,
        per_batch_duration: Date.now() - batchStarted,
        per_batch_success_count: (counters.created - before.created),
        per_batch_failure_count: batchFailures,
        per_batch_retry_count: retryCount - before.retryCount,
        per_batch_avg_ms_per_item: currentBatch.length ? (Date.now() - batchStarted) / currentBatch.length : 0,
        per_batch_mcp_errors: batchMcpErrors.slice(0, 10),
        per_batch_downgrade_status: risk.downgrade ? "pending" : "none",
      });
    }
    if (risk.stop) {
      stopForHighRisk = true;
      stopReason = risk.reason;
      break;
    }
    if (risk.downgrade && writebackConcurrency > 1) {
      const downgraded = nextWritebackDowngrade(writebackConcurrency);
      if (downgraded < writebackConcurrency) {
        autoDowngrade = {
          auto_downgrade_triggered: true,
          original_concurrency: autoDowngrade.original_concurrency,
          downgraded_concurrency: downgraded,
          downgrade_reason: risk.reason,
          downgrade_at_batch: batchIndex,
          downgrade_error: batchMcpErrors[0] || "",
          items_completed_before_downgrade: processedCount,
          items_remaining_after_downgrade: Math.max(0, items.length - processedCount),
        };
        writebackConcurrency = downgraded;
      }
    }
  }

  const distinctCreated = new Set(writebackRecords.filter((x) => x.status === "created").map((x) => x.itemKey));
  duplicateDetectedCount = Math.max(0, writebackRecords.filter((x) => x.status === "created").length - distinctCreated.size);
  if (duplicateDetectedCount > 0) {
    stopForHighRisk = true;
    stopReason = "duplicate_detected";
  }
  const itemWritebackMs = Date.now() - itemWritebackStarted;
  const collectionAttachStarted = Date.now();
  const groupedAttach = stopForHighRisk ? new Map() : groupItemKeysByCollection(writebackItems);
  const groupedPoolAttach = new Map();
  const groupedDailyAttach = new Map();
  for (const [collectionKey, itemSet] of groupedAttach.entries()) {
    if (collectionKey === root.key) groupedPoolAttach.set(collectionKey, itemSet);
    else groupedDailyAttach.set(collectionKey, itemSet);
  }
  const poolAttachStats = stopForHighRisk
    ? {
      collection_attach_mode: "batch",
      collection_attach_batch_size: attachBatchSize,
      collection_attach_calls: 0,
      collection_attach_failures: [{ error: `stopped_before_attach:${stopReason}` }],
      fallback_to_per_item_count: 0,
    }
    : await attachItemsByCollectionBatched({
      groupedItemKeys: groupedPoolAttach,
      batchSize: attachBatchSize,
      mcpToolCall,
      idBase: 30000,
      collectionGuard,
      collectionScopeBlocks,
    });
  const dailyAttachStats = stopForHighRisk
    ? {
      collection_attach_mode: "batch",
      collection_attach_batch_size: attachBatchSize,
      collection_attach_calls: 0,
      collection_attach_failures: [{ error: `stopped_before_attach:${stopReason}` }],
      fallback_to_per_item_count: 0,
    }
    : await attachItemsByCollectionBatched({
      groupedItemKeys: groupedDailyAttach,
      batchSize: attachBatchSize,
      mcpToolCall,
      idBase: 33000,
      collectionGuard,
      collectionScopeBlocks,
    });
  const attachStats = {
    collection_attach_mode: "batch",
    collection_attach_batch_size: attachBatchSize,
    collection_attach_calls: poolAttachStats.collection_attach_calls + dailyAttachStats.collection_attach_calls,
    collection_attach_failures: [...poolAttachStats.collection_attach_failures, ...dailyAttachStats.collection_attach_failures],
    fallback_to_per_item_count: poolAttachStats.fallback_to_per_item_count + dailyAttachStats.fallback_to_per_item_count,
  };
  const poolAttachFailureKeys = new Set(
    (poolAttachStats.collection_attach_failures || []).flatMap((x) => Array.isArray(x.itemKeys) ? x.itemKeys : []),
  );
  counters.added_to_pool = writebackItems.filter((x) => x.itemKey && !poolAttachFailureKeys.has(x.itemKey)).length;
  counters.added_to_daily_collection = writebackItems.filter((x) => x.itemKey && !poolAttachFailureKeys.has(x.itemKey)).length;
  const poolAddFailed = Math.max(0, writebackItems.length - counters.added_to_pool);
  const currentDateAddFailed = Math.max(0, writebackItems.length - counters.added_to_daily_collection);
  const collectionAttachMs = Date.now() - collectionAttachStarted;

  const tagCleanupStarted = Date.now();
  const tagCleanupStats = await cleanupSignatureTags(root.key, worthy?.key || null, { now: TODAY, mcpToolCall });
  const tagCleanupMs = Date.now() - tagCleanupStarted;
  const migrationStarted = Date.now();
  const migrationStats = await migrateRatedItems({ rootKey: root.key, worthyKey: worthy?.key || null, now: TODAY, mcpToolCall, starMigrationConfig, collectionGuard, collectionScopeBlocks });
  const migrationMs = Date.now() - migrationStarted;
  const collectionScopeSummary = summarizeCollectionScopeBlocks(collectionScopeBlocks);
  const summary = {
    date: dateStr,
    root_collection: root,
    date_collection_key: dateKey,
    source_collections: sourceKeys,
    grade_collections: gradeKeys,
    counters,
    failures,
    pool_collection_name: "文献池",
    pool_collection_key: root.key,
    ...collectionGuard.audit,
    ...collectionScopeSummary,
    pool_items_scanned: Number(poolIndex.meta?.size || 0),
    pool_duplicate_index_counts: {
      doi: poolIndex.byDoi?.size || 0,
      pmid: poolIndex.byPmid?.size || 0,
      pmcid: poolIndex.byPmcid?.size || 0,
      arxiv: poolIndex.byArxiv?.size || 0,
      title: poolIndex.byTitle?.size || 0,
    },
    worthy_duplicate_index_counts: {
      doi: worthyIndex.byDoi?.size || 0,
      pmid: worthyIndex.byPmid?.size || 0,
      pmcid: worthyIndex.byPmcid?.size || 0,
      arxiv: worthyIndex.byArxiv?.size || 0,
      title: worthyIndex.byTitle?.size || 0,
    },
    skipped_duplicate_in_pool: skippedDuplicatesInPool,
    skipped_duplicate_in_trash: skippedDuplicatesInTrash,
    trash_index_item_count: trashItemCount,
    skipped_duplicate_in_worthy: counters.skipped_duplicate_in_worthy,
    worthy_index_item_count: worthyItemCount,
    duplicate_records: duplicateRecords,
    reused_existing_added_to_pool_and_current_date: counters.reused_existing,
    added_to_current_date_collection: counters.added_to_daily_collection,
    pool_add_failed: poolAddFailed,
    current_date_add_failed: currentDateAddFailed,
    writeback_items: writebackItems,
    med_zotero_bridge: {
      mcp_only: true,
      stage: "abc_writeback",
      tag_cleanup_interface: "write_tag:set",
      historical_dedup_enabled: true,
      star_migration_window_days: migrationStats.window_days || starMigrationConfig.windowDays || 7,
      calibration_isolated_mode: false,
      history_collection_modification_forbidden: HISTORY_COLLECTION_MODIFICATION_FORBIDDEN,
      ...collectionGuard.audit,
    },
    tag_cleanup_stats: tagCleanupStats,
    migration_stats: migrationStats,
    star_migration: {
      enabled: Boolean(migrationStats.enabled),
      mode: migrationStats.mode || starMigrationConfig.mode || "unknown",
      eligible_items: Number(migrationStats.eligible_items || 0),
      moved_to_worthy: Number(migrationStats.moved_to_worthy || 0),
      skipped_already_exists: Number(migrationStats.skipped_already_exists || migrationStats.already_in_worthy || 0),
      skipped_invalid: Number(migrationStats.skipped_invalid || 0),
      errors: Array.isArray(migrationStats.errors) ? migrationStats.errors.length : 0,
      error_samples: Array.isArray(migrationStats.errors) ? migrationStats.errors.slice(0, 5) : [],
      window_days: Number(migrationStats.window_days || starMigrationConfig.windowDays || 7),
      star_threshold: Number(migrationStats.star_threshold || starMigrationConfig.starThreshold || 4),
      expand_all_grades: Boolean(migrationStats.expand_all_grades ?? starMigrationConfig.expandAllGrades ?? true),
    },
    collection_attach_mode: attachStats.collection_attach_mode,
    collection_attach_batch_size: attachStats.collection_attach_batch_size,
    collection_attach_calls: attachStats.collection_attach_calls,
    collection_attach_duration: collectionAttachMs,
    collection_attach_failures: attachStats.collection_attach_failures,
    fallback_to_per_item_count: attachStats.fallback_to_per_item_count,
    configured_concurrency: configuredConcurrency,
    effective_concurrency: writebackConcurrency,
    concurrency_warning: concurrencyWarning,
    concurrency_clamped: concurrencyClamped,
    concurrency_default_used: concurrencySource === "default",
    concurrency_source: concurrencySource,
    ...autoDowngrade,
    stopped_for_high_risk: stopForHighRisk,
    stop_reason: stopReason || null,
    run_stats: {
      execution_mode: "serial",
      batch_write_supported: false,
      writeback_concurrency: writebackConcurrency,
      writeback_concurrency_recommended_max: 10,
      writeback_retry_limit: writebackRetryLimit,
      writeback_retry_count: retryCount,
      duplicate_prevented_count: duplicatePreventedCount,
      duplicate_detected_count: duplicateDetectedCount,
      wrong_collection_detected_count: wrongCollectionDetectedCount,
      collection_scope_blocked_count: collectionScopeSummary.collection_scope_blocked_count,
      collection_scope_blocked_samples: collectionScopeSummary.collection_scope_blocked_samples,
      uncertain_create_state_count: uncertainCreateStateCount,
      in_flight_dedupe_wait_count: inFlightDedupeWaitCount,
      collection_key_cache_enabled: true,
      collection_setup_ms: collectionSetupMs,
      item_writeback_ms: itemWritebackMs,
      collection_attach_mode: attachStats.collection_attach_mode,
      collection_attach_batch_size: attachStats.collection_attach_batch_size,
      collection_attach_calls: attachStats.collection_attach_calls,
      collection_attach_duration: collectionAttachMs,
      collection_attach_failures: attachStats.collection_attach_failures,
      fallback_to_per_item_count: attachStats.fallback_to_per_item_count,
      observation_mode: observationMode,
      per_batch_observation: observationMode ? batchObservations : [],
      tag_cleanup_ms: tagCleanupMs,
      star_migration_ms: migrationMs,
      mcp_calls_by_tool: Object.fromEntries(mcpCallCounters),
    },
  };
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  try {
    const runReport = JSON.parse(await fs.readFile(runReportPath, "utf8"));
    runReport.stage_timings = runReport.stage_timings || {};
    runReport.stage_timings.zotero_writeback = {
      status: "completed",
      ms: Date.now() - stageStarted,
      substeps: {
        collection_setup: collectionSetupMs,
        item_writeback: itemWritebackMs,
        collection_attach: collectionAttachMs,
        tag_cleanup: tagCleanupMs,
        star_migration: migrationMs,
      },
    };
    runReport.writeback_pool_dedupe_enabled = true;
    runReport.writeback_pool_collection_name = "文献池";
    runReport.writeback_pool_collection_key = root.key;
    runReport.writeback_pool_items_scanned = Number(poolIndex.meta?.size || 0);
    runReport.writeback_pool_duplicates_skipped = counters.skipped_duplicate_in_pool;
    runReport.writeback_trash_duplicates_skipped = counters.skipped_duplicate_in_trash;
    runReport.writeback_trash_index_items = trashItemCount;
    runReport.writeback_worthy_duplicates_skipped = counters.skipped_duplicate_in_worthy;
    runReport.writeback_worthy_index_items = worthyItemCount;
    runReport.writeback_added_to_pool = counters.added_to_pool;
    runReport.writeback_added_to_current_date_collection = counters.added_to_daily_collection;
    runReport.writeback_pool_add_failed = poolAddFailed;
    runReport.writeback_current_date_add_failed = currentDateAddFailed;
    runReport.collection_scope_guard_enabled = true;
    runReport.collection_scope_guard_ready = collectionGuard.ready;
    runReport.collection_scope_blocked_count = collectionScopeSummary.collection_scope_blocked_count;
    runReport.collection_scope_blocked_samples = collectionScopeSummary.collection_scope_blocked_samples;
    runReport.signals = runReport.signals || {};
    runReport.signals.pool_collection_missing = false;
    runReport.signals.pool_collection_ambiguous = false;
    runReport.signals.duplicate_in_pool = counters.skipped_duplicate_in_pool > 0;
    runReport.signals.duplicate_in_trash = counters.skipped_duplicate_in_trash > 0;
    runReport.signals.trash_index_loaded = trashItemCount > 0;
    runReport.signals.duplicate_in_worthy = counters.skipped_duplicate_in_worthy > 0;
    runReport.signals.worthy_index_loaded = worthyItemCount > 0;
    runReport.signals.pool_add_failed = poolAddFailed > 0;
    runReport.signals.current_date_add_failed = currentDateAddFailed > 0;
    runReport.signals.history_collection_modification_forbidden = HISTORY_COLLECTION_MODIFICATION_FORBIDDEN;
    runReport.signals.collection_scope_blocked = collectionScopeSummary.collection_scope_blocked_count > 0;
    await fs.writeFile(runReportPath, JSON.stringify(runReport, null, 2), "utf8");
  } catch {}
  console.log(JSON.stringify(summary, null, 2));
}

export async function markWritebackFailure(err) {
  try {
    const date = TODAY;
    const week = isoWeek(date);
    const day = yyMd(date);
    const pipelineDir = path.join(RESEARCH_ROOT, "pipeline", day);
    const runReportPath = path.join(pipelineDir, "run_report.json");
    const runReport = JSON.parse(await fs.readFile(runReportPath, "utf8"));
    runReport.failures = Array.isArray(runReport.failures) ? runReport.failures : [];
    const reason = String(err?.message || err);
    const details = err?.details || null;
    runReport.failures.push({
      stage: "stage2_med_zotero_bridge",
      reason,
      details,
      at: new Date().toISOString(),
    });
    runReport.steps = runReport.steps || {};
    runReport.signals = runReport.signals || {};
    runReport.signals.pool_collection_missing = details?.signal === "pool_collection_missing";
    runReport.signals.pool_collection_ambiguous = details?.signal === "pool_collection_ambiguous";
    runReport.signals.collection_scope_blocked = details?.signal === "collection_scope_blocked" || /collection_scope_blocked/i.test(reason);
    runReport.signals.history_collection_modification_forbidden = HISTORY_COLLECTION_MODIFICATION_FORBIDDEN;
    runReport.collection_scope_guard_enabled = true;
    runReport.collection_scope_blocked_count = Number(details?.collection_scope_blocked_count || 0);
    runReport.collection_scope_blocked_samples = details?.collection_scope_blocked_samples || [];
    runReport.steps.med_zotero_bridge = {
      ok: false,
      mcp_required: true,
      pending_writeback: true,
      connector_ok: false,
      downgrade_reason: reason,
      downgrade_details: details,
    };
    runReport.stage_timings = runReport.stage_timings || {};
    runReport.stage_timings.zotero_writeback = {
      status: "failed",
      reason,
      details,
    };
    await fs.writeFile(runReportPath, JSON.stringify(runReport, null, 2), "utf8");
  } catch {}
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runMcpBulkWriteback().catch((e) => {
    markWritebackFailure(e).finally(() => {
      console.error(e);
      process.exit(1);
    });
  });
}
