import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildRuntimeConfig } from "./lib/runtime_config.mjs";
import { ensureZoteroMcpReady } from "./lib/ensure_zotero_mcp_ready.mjs";
import {
  attachItemsByCollectionBatched,
  normalizeDoi,
  normalizeIdentifier,
  normalizeTitleExact,
  parseToolText,
} from "./lib/writeback_support.mjs";

const DEFAULT_ROOT_COLLECTION = "历史反馈归档";
const DEFAULT_MATCH_CONCURRENCY = 12;
const MCP_URL = process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isValidDoi(value) {
  const doi = normalizeDoi(value);
  if (!doi || !/^10\.\S+\/\S+$/i.test(doi)) return false;
  if (/\/asset\/|\/assets\/|\.(gif|png|jpe?g|svg|webp)(\?|$)/i.test(doi)) return false;
  return true;
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function writeCsv(filePath, rows, headers) {
  const text = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${text}\n`, "utf8");
}

async function walkFiles(root, predicate, out = []) {
  if (!fsSync.existsSync(root)) return out;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walkFiles(full, predicate, out);
    else if (predicate(full, entry.name)) out.push(full);
  }
  return out;
}

export async function readArchiveRecords(archiveRoot) {
  const files = await walkFiles(archiveRoot, (_full, name) => name.endsWith(".json"));
  const rows = [];
  for (const file of files.sort()) {
    let payload;
    try {
      payload = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      rows.push({ status: "unreadable", archive_file: file, error: String(error?.message || error) });
      continue;
    }
    const record = payload.record || {};
    rows.push({
      status: "readable",
      archive_file: file,
      date: cleanText(payload.date),
      assigned_level: cleanText(payload.assigned_level),
      archived_from: cleanText(payload.archived_from),
      feedback_source: cleanText(payload.feedback_source),
      feedback_row: payload.feedback_row || "",
      title: cleanText(record.title),
      itemKey: cleanText(record.itemKey),
      doi: isValidDoi(record.doi) ? normalizeDoi(record.doi) : "",
      raw_doi: cleanText(record.doi),
      pmid: normalizeIdentifier(record.pmid),
      pmcid: normalizeIdentifier(record.pmcid),
      title_key: normalizeTitleExact(record.title),
      source_file: cleanText(record.source_file),
      source_index: record.source_index,
      record,
    });
  }
  return rows;
}

async function defaultMcpToolCall(name, args, id) {
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

async function ensureMcpReady(mcpToolCall) {
  return ensureZoteroMcpReady({
    mcpProbe: async (attempt) => {
      await mcpToolCall("get_collections", { mode: "minimal", limit: 1 }, 880000 + attempt);
    },
  });
}

function zoteroItemFields(item = {}) {
  const data = item.data || item;
  const extra = String(data.extra || item.extra || "");
  return {
    itemKey: cleanText(item.key || item.itemKey || data.key || data.itemKey).toUpperCase(),
    title: cleanText(data.title || item.title),
    doi: isValidDoi(data.DOI || data.doi) ? normalizeDoi(data.DOI || data.doi) : "",
    pmid: normalizeIdentifier(data.pmid || item.pmid || (extra.match(/PMID:\s*([^\s]+)/i) || [])[1]),
    pmcid: normalizeIdentifier(data.pmcid || item.pmcid || (extra.match(/PMCID:\s*([^\s]+)/i) || [])[1]),
    title_key: normalizeTitleExact(data.title || item.title),
  };
}

function exactMatchReason(archive, zotero) {
  if (archive.itemKey && zotero.itemKey && archive.itemKey.toUpperCase() === zotero.itemKey) return { ok: true, method: "zotero_item_key_exact", key: zotero.itemKey, confidence: 1 };
  if (archive.pmid && archive.pmid === zotero.pmid) return { ok: true, method: "pmid_exact", key: archive.pmid, confidence: 1 };
  if (archive.pmcid && archive.pmcid === zotero.pmcid) return { ok: true, method: "pmcid_exact", key: archive.pmcid, confidence: 1 };
  if (archive.doi && archive.doi === zotero.doi) return { ok: true, method: "doi_exact", key: archive.doi, confidence: 1 };
  if (archive.title_key && archive.title_key === zotero.title_key) return { ok: true, method: "title_exact_normalized", key: archive.title_key, confidence: 0.95 };
  return { ok: false };
}

async function getItemDetails(itemKey, mcpToolCall, id) {
  const result = await mcpToolCall("get_item_details", { itemKey, mode: "preview" }, id);
  return parseToolText(result);
}

export async function resolveZoteroItem(archive, { mcpToolCall = defaultMcpToolCall, idBase = 900000, verifyItemKey = false } = {}) {
  if (archive.itemKey && !verifyItemKey) {
    return {
      status: "matched",
      itemKey: archive.itemKey.toUpperCase(),
      method: "zotero_item_key_from_archive",
      key: archive.itemKey.toUpperCase(),
      confidence: 0.99,
      title: archive.title,
    };
  }
  const candidates = [];
  if (archive.itemKey) candidates.push(archive.itemKey, archive.itemKey.toUpperCase());
  let seq = 0;
  for (const key of [...new Set(candidates)]) {
    try {
      const detail = await getItemDetails(key, mcpToolCall, idBase + seq++);
      const z = zoteroItemFields(detail);
      const reason = exactMatchReason(archive, z);
      if (reason.ok) return { status: "matched", itemKey: z.itemKey || key.toUpperCase(), ...reason, title: z.title };
    } catch {
      // Fall through to search fallback.
    }
  }

  const queries = [
    archive.pmid && { q: archive.pmid, type: "pmid" },
    archive.pmcid && { q: archive.pmcid, type: "pmcid" },
    archive.doi && { q: archive.doi, type: "doi" },
    archive.title && { q: archive.title, type: "title" },
  ].filter(Boolean);
  for (const query of queries) {
    const result = await mcpToolCall("search_library", { q: query.q, limit: 8, mode: "preview", relevanceScoring: true }, idBase + 100 + seq++);
    const hits = parseToolText(result);
    const exact = (Array.isArray(hits) ? hits : []).map(zoteroItemFields).filter((hit) => exactMatchReason(archive, hit).ok);
    if (exact.length === 1) {
      const reason = exactMatchReason(archive, exact[0]);
      return { status: "matched", itemKey: exact[0].itemKey, ...reason, title: exact[0].title };
    }
    if (exact.length > 1) {
      return { status: "conflict", reason: "multiple_zotero_items_matched", match_method: `${query.type}_search`, match_key: query.q, candidates: exact.map((x) => x.itemKey) };
    }
  }
  return { status: "unmatched", reason: "no_zotero_item_matched" };
}

function targetCollectionPath(rootName, row) {
  return [rootName, row.date || "unknown_date", row.assigned_level || "needs_review"];
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

export async function buildSyncPlan({ archiveRoot, rootCollectionName = DEFAULT_ROOT_COLLECTION, mcpToolCall = defaultMcpToolCall, matchConcurrency = DEFAULT_MATCH_CONCURRENCY, verifyItemKeys = false }) {
  const records = await readArchiveRecords(archiveRoot);
  return mapWithConcurrency(records, matchConcurrency, async (row, idx) => {
    if (row.status !== "readable") {
      return { status: "skipped", reason: "archive_json_unreadable", archive_file: row.archive_file, error: row.error };
    }
    const resolved = await resolveZoteroItem(row, { mcpToolCall, idBase: 900000 + idx * 20, verifyItemKey: verifyItemKeys });
    const base = {
      archive_file: row.archive_file,
      date: row.date,
      assigned_level: row.assigned_level,
      target_collection_path: targetCollectionPath(rootCollectionName, row).join("/"),
      title: row.title,
      archived_from: row.archived_from,
      feedback_source: row.feedback_source,
      feedback_row: row.feedback_row,
      source_file: row.source_file,
      source_index: row.source_index,
      archive_itemKey: row.itemKey,
      archive_pmid: row.pmid,
      archive_pmcid: row.pmcid,
      archive_doi: row.doi,
    };
    if (resolved.status === "matched") {
      return {
        ...base,
        status: "planned",
        itemKey: resolved.itemKey,
        match_method: resolved.method,
        match_key: resolved.key,
        confidence: resolved.confidence,
        zotero_title: resolved.title,
        action: "add_item_to_collection",
      };
    } else {
      return {
        ...base,
        status: resolved.status === "conflict" ? "conflict" : "needs_review",
        reason: resolved.reason,
        match_method: resolved.match_method || "",
        match_key: resolved.match_key || "",
        confidence: 0,
        candidates: resolved.candidates || [],
      };
    }
  });
}

function summarize(plan = [], mode = "dry-run") {
  const count = (status) => plan.filter((entry) => entry.status === status).length;
  const methodStats = {};
  for (const entry of plan) {
    const key = entry.match_method || "none";
    methodStats[key] = (methodStats[key] || 0) + 1;
  }
  return {
    generated_at: new Date().toISOString(),
    mode,
    total_archive_records: plan.length,
    planned: count("planned"),
    added: count("added"),
    already_in_collection: count("already_in_collection"),
    skipped: count("skipped"),
    needs_review: count("needs_review"),
    conflicts: count("conflict"),
    errors: plan.filter((entry) => entry.error).length,
    match_method_stats: methodStats,
  };
}

async function findCollectionByName(name, mcpToolCall, id) {
  const list = parseToolText(await mcpToolCall("get_collections", { mode: "complete", limit: 1000 }, id));
  return (Array.isArray(list) ? list : []).find((entry) => entry.name === name) || null;
}

async function ensureRootCollection(name, mcpToolCall, idBase) {
  const existing = await findCollectionByName(name, mcpToolCall, idBase);
  if (existing?.key) return existing;
  return parseToolText(await mcpToolCall("create_collection", { name }, idBase + 1));
}

async function ensureChildCollection(parentKey, name, mcpToolCall, idBase) {
  const children = parseToolText(await mcpToolCall("get_subcollections", { collectionKey: parentKey, recursive: false }, idBase));
  const existing = (Array.isArray(children) ? children : []).find((entry) => entry.name === name);
  if (existing?.key) return existing;
  return parseToolText(await mcpToolCall("create_collection", { name, parentCollection: parentKey }, idBase + 1));
}

async function ensureTargetCollections(plan, { rootCollectionName, mcpToolCall }) {
  const root = await ensureRootCollection(rootCollectionName, mcpToolCall, 810000);
  const byPath = new Map();
  let id = 811000;
  for (const entry of plan.filter((item) => item.status === "planned")) {
    const parts = entry.target_collection_path.split("/");
    const dateName = parts[1];
    const levelName = parts[2];
    const dateCollection = await ensureChildCollection(root.key, dateName, mcpToolCall, id);
    id += 10;
    const levelCollection = await ensureChildCollection(dateCollection.key, levelName, mcpToolCall, id);
    id += 10;
    byPath.set(entry.target_collection_path, levelCollection.key);
    entry.target_collection_key = levelCollection.key;
  }
  return { root, byPath };
}

async function applySyncPlan(plan, { rootCollectionName, mcpToolCall }) {
  await ensureTargetCollections(plan, { rootCollectionName, mcpToolCall });
  const grouped = new Map();
  for (const entry of plan.filter((item) => item.status === "planned")) {
    if (!entry.target_collection_key || !entry.itemKey) continue;
    if (!grouped.has(entry.target_collection_key)) grouped.set(entry.target_collection_key, new Set());
    grouped.get(entry.target_collection_key).add(entry.itemKey);
  }
  const attachStats = await attachItemsByCollectionBatched({ groupedItemKeys: grouped, batchSize: 50, mcpToolCall, idBase: 820000 });
  const failures = new Set();
  for (const failure of attachStats.collection_attach_failures || []) {
    for (const key of failure.itemKeys || []) failures.add(`${failure.collectionKey}:${key}`);
  }
  for (const entry of plan.filter((item) => item.status === "planned")) {
    if (failures.has(`${entry.target_collection_key}:${entry.itemKey}`)) {
      entry.status = "skipped";
      entry.error = "add_items_to_collection_failed";
    } else {
      entry.status = "added";
    }
  }
  return attachStats;
}

function manifestRows(plan = []) {
  return plan.map((entry) => ({
    status: entry.status,
    itemKey: entry.itemKey || "",
    target_collection_path: entry.target_collection_path || "",
    target_collection_key: entry.target_collection_key || "",
    date: entry.date || "",
    assigned_level: entry.assigned_level || "",
    title: entry.title || "",
    zotero_title: entry.zotero_title || "",
    match_method: entry.match_method || "",
    match_key: entry.match_key || "",
    confidence: entry.confidence ?? "",
    archive_file: entry.archive_file || "",
    archived_from: entry.archived_from || "",
    feedback_source: entry.feedback_source || "",
    feedback_row: entry.feedback_row || "",
    reason: entry.reason || "",
    error: entry.error || "",
  }));
}

export async function writeSyncReports(manifestRoot, plan, summary, extra = {}) {
  const suffix = summary.mode === "apply" ? `apply_${summary.generated_at.replace(/[:.]/g, "-")}` : "dry_run";
  const manifestPath = path.join(manifestRoot, `zotero_collection_sync_${suffix}.json`);
  const csvPath = path.join(manifestRoot, `zotero_collection_sync_${suffix}.csv`);
  const headers = ["status", "itemKey", "target_collection_path", "target_collection_key", "date", "assigned_level", "title", "zotero_title", "match_method", "match_key", "confidence", "archive_file", "archived_from", "feedback_source", "feedback_row", "reason", "error"];
  await writeCsv(csvPath, manifestRows(plan), headers);
  await writeJsonFile(manifestPath, {
    summary,
    csv_path: csvPath,
    safety: {
      dry_run_writes_zotero: false,
      removes_items_from_collections: false,
      deletes_zotero_items: false,
      deletes_attachments: false,
      moves_pdf_files: false,
      accesses_zotero_sqlite: false,
      triggers_rss_pubmed_fetch: false,
    },
    ...extra,
    plan,
  });
  return { manifestPath, csvPath };
}

export async function runSyncZoteroCollectionsFromArchive({
  argv = process.argv,
  runtime = buildRuntimeConfig(),
  mcpToolCall = defaultMcpToolCall,
} = {}) {
  const apply = argv.includes("--apply");
  const verifyItemKeys = argv.includes("--verify-item-keys");
  const concurrencyArg = argv.find((arg) => arg.startsWith("--match-concurrency="));
  const matchConcurrency = concurrencyArg ? Number(concurrencyArg.split("=")[1]) : DEFAULT_MATCH_CONCURRENCY;
  const rootArg = argv.find((arg) => arg.startsWith("--root-collection="));
  const rootCollectionName = rootArg ? rootArg.split("=").slice(1).join("=") : DEFAULT_ROOT_COLLECTION;
  const archiveRoot = path.join(runtime.researchRoot, "literature_archive");
  const manifestRoot = path.join(runtime.researchRoot, "run_manifests");
  await ensureMcpReady(mcpToolCall);
  const plan = await buildSyncPlan({ archiveRoot, rootCollectionName, mcpToolCall, matchConcurrency, verifyItemKeys });
  let attachStats = null;
  if (apply) {
    attachStats = await applySyncPlan(plan, { rootCollectionName, mcpToolCall });
  }
  const summary = summarize(plan, apply ? "apply" : "dry-run");
  const reports = await writeSyncReports(manifestRoot, plan, summary, {
    root_collection_name: rootCollectionName,
    match_concurrency: matchConcurrency,
    verify_item_keys: verifyItemKeys,
    attach_stats: attachStats,
  });
  return { ...reports, summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSyncZoteroCollectionsFromArchive().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
