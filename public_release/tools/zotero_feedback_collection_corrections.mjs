import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildRuntimeConfig } from "./lib/runtime_config.mjs";
import { parseToolText } from "./lib/writeback_support.mjs";
import { ensureZoteroMcpReady } from "./lib/ensure_zotero_mcp_ready.mjs";
import {
  buildMovePlan,
  scanFeedbackRows,
  scanLiteratureRecords,
} from "./archive_history_by_feedback.mjs";

const MCP_URL = process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp";
const ZOTERO_WEB_API_BASE = process.env.ZOTERO_WEB_API_BASE || "https://api.zotero.org";
const ROOT_COLLECTION = "文献池";
const OLD_ARCHIVE_COLLECTION = "历史反馈归档";
const DELETE_REVIEW_COLLECTION = "待删除";
const LEVELS = ["A课题相关", "B专题相关", "C领域相关", "D无关"];

function cleanText(value) {
  return String(value || "").trim();
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function writeCsv(filePath, rows, headers) {
  const text = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${text}\n`, "utf8");
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
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

function getZoteroWebDeleteConfig(env = process.env) {
  const apiKey = cleanText(env.ZOTERO_API_KEY || env.ZOTERO_WEB_API_KEY);
  const libraryType = cleanText(env.ZOTERO_LIBRARY_TYPE || "user").toLowerCase();
  const libraryId = cleanText(env.ZOTERO_LIBRARY_ID || env.ZOTERO_USER_ID);
  if (!apiKey || !libraryId) {
    return {
      ok: false,
      provider: "zotero_web_api",
      reason: "missing_ZOTERO_API_KEY_or_ZOTERO_USER_ID",
      hasApiKey: Boolean(apiKey),
      hasLibraryId: Boolean(libraryId),
    };
  }
  if (!["user", "group"].includes(libraryType)) {
    return { ok: false, provider: "zotero_web_api", reason: "invalid_ZOTERO_LIBRARY_TYPE" };
  }
  return {
    ok: true,
    provider: "zotero_web_api",
    apiKey,
    libraryType,
    libraryId,
    baseUrl: cleanText(env.ZOTERO_WEB_API_BASE) || ZOTERO_WEB_API_BASE,
  };
}

async function zoteroWebApiRequest(pathname, { method = "GET", headers = {}, config, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}${pathname}`, {
    method,
    headers: {
      "Zotero-API-Version": "3",
      "Zotero-API-Key": config.apiKey,
      ...headers,
    },
  });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    headers: res.headers,
    text,
  };
}

export async function deleteZoteroItemViaWebApi(itemKey, { config = getZoteroWebDeleteConfig(), fetchImpl = fetch } = {}) {
  if (!config.ok) return { ok: false, status: "blocked", provider: config.provider, error: config.reason };
  const prefix = config.libraryType === "group" ? `/groups/${encodeURIComponent(config.libraryId)}` : `/users/${encodeURIComponent(config.libraryId)}`;
  const itemPath = `${prefix}/items/${encodeURIComponent(itemKey)}`;
  const current = await zoteroWebApiRequest(itemPath, { config, fetchImpl });
  if (!current.ok) {
    return { ok: false, status: current.status, provider: config.provider, phase: "read_current_item", error: current.text.slice(0, 500) };
  }
  let version = current.headers.get?.("last-modified-version") || "";
  if (!version) {
    try {
      const parsed = JSON.parse(current.text || "{}");
      version = String(parsed?.data?.version || parsed?.version || "");
    } catch {
      version = "";
    }
  }
  if (!version) return { ok: false, status: "blocked", provider: config.provider, phase: "read_current_item", error: "missing_item_version" };
  const deleted = await zoteroWebApiRequest(itemPath, {
    method: "DELETE",
    headers: { "If-Unmodified-Since-Version": version },
    config,
    fetchImpl,
  });
  if (!deleted.ok) {
    return { ok: false, status: deleted.status, provider: config.provider, phase: "delete_item", version, error: deleted.text.slice(0, 500) };
  }
  return { ok: true, status: deleted.status, provider: config.provider, version };
}

async function ensureMcpReady(mcpToolCall) {
  return ensureZoteroMcpReady({
    mcpProbe: async (attempt) => {
      await mcpToolCall("get_collections", { mode: "minimal", limit: 1 }, 860000 + attempt);
    },
  });
}

function collectionKey(collection) {
  return collection?.key || collection?.collectionKey || "";
}

function parentKey(collection) {
  return collection?.parentCollection || collection?.parent || false;
}

function collectionName(collection) {
  return cleanText(collection?.name);
}

function childrenOf(collections, parent) {
  return collections.filter((collection) => parentKey(collection) === parent);
}

function findTopCollection(collections, name) {
  return collections.find((collection) => collectionName(collection) === name && !parentKey(collection)) || null;
}

function findChild(collections, parent, name) {
  const key = collectionKey(parent);
  return collections.find((collection) => parentKey(collection) === key && collectionName(collection) === name) || null;
}

function findGradeCollection(collections, date, level, rootName = ROOT_COLLECTION) {
  const root = findTopCollection(collections, rootName);
  if (!root) return null;
  const dateCollection = findChild(collections, root, date);
  if (!dateCollection) return null;
  return findChild(collections, dateCollection, level);
}

function findDeleteReviewCollection(collections, rootName = ROOT_COLLECTION) {
  const root = findTopCollection(collections, rootName);
  if (!root) return null;
  return findChild(collections, root, DELETE_REVIEW_COLLECTION);
}

function descendantsDepthFirst(collections, root) {
  const out = [];
  function visit(node, depth) {
    for (const child of childrenOf(collections, collectionKey(node))) visit(child, depth + 1);
    out.push({ collection: node, depth });
  }
  visit(root, 0);
  return out.sort((a, b) => b.depth - a.depth).map((x) => x.collection);
}

function flattenCollections(collections) {
  const out = [];
  function visit(collection) {
    out.push(collection);
    for (const child of Array.isArray(collection?.subcollections) ? collection.subcollections : []) visit(child);
  }
  for (const collection of Array.isArray(collections) ? collections : []) visit(collection);
  return out;
}

function normalizeItemKey(value) {
  return cleanText(value).toUpperCase();
}

function feedbackAction(entry) {
  return cleanText(entry.feedback?.feedback).toLowerCase();
}

function normalizeLevel(value) {
  const text = cleanText(value);
  if (!text) return "";
  if (LEVELS.includes(text)) return text;
  const upper = text.toUpperCase();
  if (upper === "A") return "A课题相关";
  if (upper === "B") return "B专题相关";
  if (upper === "C") return "C领域相关";
  if (upper === "D") return "D无关";
  if (text.includes("课题")) return "A课题相关";
  if (text.includes("专题")) return "B专题相关";
  if (text.includes("领域")) return "C领域相关";
  if (text.includes("无关")) return "D无关";
  return "";
}

function levelFromFeedbackAction(action, currentLevel) {
  const current = normalizeLevel(currentLevel);
  const idx = LEVELS.indexOf(current);
  if (action === "keep") return current;
  if (action === "drop") return "D无关";
  if (action === "upgrade") return idx > 0 ? LEVELS[idx - 1] : current || "";
  if (action === "downgrade") return idx >= 0 && idx < LEVELS.length - 1 ? LEVELS[idx + 1] : "";
  return "";
}

function isDropAction(entry) {
  return feedbackAction(entry) === "drop" || entry.assigned_level === "D无关";
}

function baseAction(entry) {
  return {
    itemKey: normalizeItemKey(entry.record?.itemKey),
    title: entry.record?.title || entry.feedback?.title || "",
    date: entry.date || "",
    feedback_action: feedbackAction(entry),
    original_level: entry.original_level || "",
    assigned_level: entry.assigned_level || "",
    feedback_source: entry.feedback_source || "",
    feedback_row: entry.feedback_row || "",
    match_method: entry.match_method || "",
    match_key: entry.match_key || "",
    source_path: entry.source_path || "",
  };
}

function correctionActionForEntry(entry, collections) {
  const base = baseAction(entry);
  if (entry.status !== "planned") return { ...base, status: entry.status || "needs_review", action: "manual_review", reason: entry.reason || entry.conflict_category || "not_auto_plannable" };
  if (!base.itemKey) return { ...base, status: "needs_review", action: "manual_review", reason: "item_key_missing" };
  if (feedbackAction(entry) === "keep" || entry.assigned_level === entry.original_level) {
    return { ...base, status: "no_op", action: "keep_no_change", reason: "" };
  }
  const source = findGradeCollection(collections, entry.date, entry.original_level);
  if (isDropAction(entry)) {
    return {
      ...base,
      status: "drop_manual_delete_required",
      action: "manual_delete_zotero_item",
      reason: "zotero_item_delete_tool_unverified",
      source_collection_key: collectionKey(source),
      target_collection_key: "",
      source_collection_role: "grade",
    };
  }
  if (!source) return { ...base, status: "needs_review", action: "manual_review", reason: "source_grade_collection_missing" };
  const target = findGradeCollection(collections, entry.date, entry.assigned_level);
  if (!target) return { ...base, status: "needs_review", action: "manual_review", reason: "target_grade_collection_missing", source_collection_key: collectionKey(source) };
  return {
    ...base,
    status: "planned",
    action: "move_between_grade_collections",
    source_collection_key: collectionKey(source),
    target_collection_key: collectionKey(target),
    source_collection_role: "grade",
  };
}

export function buildCorrectionPlan({
  archivePlan = [],
  collections = [],
  includeArchiveCleanup = true,
  dropMode = "manual",
} = {}) {
  const actions = archivePlan.map((entry) => {
    const action = correctionActionForEntry(entry, collections);
    if (dropMode === "quarantine" && action.status === "drop_manual_delete_required") {
      const target = findDeleteReviewCollection(collections);
      return {
        ...action,
        status: "planned",
        action: "move_drop_to_delete_review_collection",
        reason: "drop_quarantine_before_manual_delete",
        target_collection_key: collectionKey(target),
        target_collection_name: DELETE_REVIEW_COLLECTION,
      };
    }
    return action;
  });
  const oldRoot = findTopCollection(collections, OLD_ARCHIVE_COLLECTION);
  const cleanupActions = oldRoot && includeArchiveCleanup
    ? descendantsDepthFirst(collections, oldRoot).map((collection) => ({
      status: "planned",
      action: "delete_old_archive_collection",
      collection_key: collectionKey(collection),
      collection_name: collectionName(collection),
      deleteItems: false,
    }))
    : [];
  return { actions, cleanup_actions: cleanupActions };
}

function levelFromZoteroDetails(details = {}) {
  for (const tag of Array.isArray(details.tags) ? details.tags : []) {
    const value = typeof tag === "string" ? tag : tag?.tag;
    const level = normalizeLevel(value);
    if (level) return level;
  }
  return "";
}

async function resolveZoteroTitleMatch(feedback, mcpToolCall, id) {
  const title = cleanText(feedback?.english_title || feedback?.title || feedback?.translated_title);
  if (!title) return null;
  const result = parseToolText(await mcpToolCall("search_library", { title, titleOperator: "exact", limit: 5, mode: "preview" }, id));
  const hits = Array.isArray(result?.results) ? result.results : Array.isArray(result) ? result : [];
  if (hits.length !== 1) return { status: hits.length > 1 ? "ambiguous" : "missing", title, hits: hits.length, hitItems: hits };
  const itemKey = normalizeItemKey(hits[0].key || hits[0].itemKey);
  if (!itemKey) return { status: "missing", title, hits: hits.length };
  const details = parseToolText(await mcpToolCall("get_item_details", { itemKey, mode: "complete" }, id + 1));
  return { status: "matched", title, itemKey, details };
}

async function zoteroItemExists(itemKey, mcpToolCall, id) {
  if (!itemKey) return false;
  const result = parseToolText(await mcpToolCall("get_item_details", { itemKey, mode: "preview" }, id));
  return !String(result?.error || "").match(/not found/i);
}

export async function enrichArchivePlanWithZoteroTitleMatches(archivePlan, { mcpToolCall = defaultMcpToolCall } = {}) {
  let seq = 0;
  const additions = [];
  for (const entry of archivePlan || []) {
    if (entry._zotero_title_expanded) continue;
    const currentItemKey = normalizeItemKey(entry.record?.itemKey);
    let staleItemKey = false;
    if (entry.status === "planned" && currentItemKey) {
      try {
        staleItemKey = !(await zoteroItemExists(currentItemKey, mcpToolCall, 894000 + seq * 5));
      } catch {
        staleItemKey = true;
      }
    }
    const missingItemKey = entry.status === "planned" && !entry.record?.itemKey;
    const unmatched = entry.status === "needs_review" && entry.reason === "no_matching_literature_record";
    const duplicateLocalMatches = entry.status === "conflict" && entry.conflict_category === "one_feedback_multiple_literature";
    if (!missingItemKey && !staleItemKey && !unmatched && !duplicateLocalMatches) continue;
    const resolved = await resolveZoteroTitleMatch(entry.feedback, mcpToolCall, 895000 + seq * 5);
    seq += 1;
    if (!resolved || resolved.status !== "matched") {
      if (resolved?.status === "ambiguous" && feedbackAction(entry) === "drop") {
        const expanded = [];
        for (const hit of resolved.hitItems || []) {
          const itemKey = normalizeItemKey(hit.key || hit.itemKey);
          if (!itemKey) continue;
          const details = parseToolText(await mcpToolCall("get_item_details", { itemKey, mode: "complete" }, 895000 + seq * 5 + expanded.length + 1));
          const originalLevel = entry.original_level || levelFromZoteroDetails(details);
          expanded.push({
            ...entry,
            _zotero_title_expanded: true,
            status: "planned",
            reason: "ambiguous_drop_title_expanded_to_all_exact_zotero_matches",
            match_method: "zotero_title_exact_multi_drop",
            match_key: resolved.title,
            confidence: 0.9,
            original_level: originalLevel,
            assigned_level: "D无关",
            source_path: `zotero:${itemKey}`,
            record: {
              ...(entry.record || {}),
              title: details?.title || hit.title || resolved.title,
              itemKey,
              record_key: `zotero:${itemKey}`,
              source_kind: "zotero_mcp_search_library_multi_drop",
            },
          });
        }
        if (expanded.length) {
          Object.assign(entry, expanded[0]);
          additions.push(...expanded.slice(1));
          continue;
        }
      }
      if (resolved?.status === "ambiguous") {
        entry.status = "conflict";
        entry.reason = "ambiguous_zotero_title_match";
        entry.conflict_category = "ambiguous_title_match";
        entry.unresolved_reason = "ambiguous_title_match";
      }
      continue;
    }
    const originalLevel = entry.original_level || levelFromZoteroDetails(resolved.details);
    const action = feedbackAction(entry);
    const assignedLevel = entry.assigned_level && entry.assigned_level !== "needs_review"
      ? entry.assigned_level
      : levelFromFeedbackAction(action, originalLevel);
    if (!originalLevel || !assignedLevel) {
      entry.reason = "zotero_title_match_without_level";
      entry.unresolved_reason = "insufficient_level_evidence";
      entry.record = { ...(entry.record || {}), itemKey: resolved.itemKey, title: resolved.details?.title || resolved.title };
      continue;
    }
    entry.status = "planned";
    entry.reason = staleItemKey ? "stale_item_key_replaced_by_english_title" : "zotero_item_resolved_by_english_title";
    entry.match_method = "zotero_title_exact";
    entry.match_key = resolved.title;
    entry.confidence = 0.95;
    entry.original_level = originalLevel;
    entry.assigned_level = assignedLevel;
    entry.source_path = entry.source_path || `zotero:${resolved.itemKey}`;
    entry.record = {
      ...(entry.record || {}),
      title: resolved.details?.title || resolved.title,
      itemKey: resolved.itemKey,
      record_key: `zotero:${resolved.itemKey}`,
      source_kind: "zotero_mcp_search_library",
    };
  }
  archivePlan.push(...additions);
  return archivePlan;
}

export async function applyCorrectionPlan(plan, {
  mcpToolCall = defaultMcpToolCall,
  applyMovesAndCleanup = true,
  applyDropQuarantine = false,
  deleteDropItems = false,
  deleteItem = deleteZoteroItemViaWebApi,
  deleteConfig = getZoteroWebDeleteConfig(),
} = {}) {
  if (applyMovesAndCleanup) {
    for (const action of plan.actions || []) {
      if (action.status !== "planned" || action.action !== "move_between_grade_collections") continue;
      try {
        await mcpToolCall("add_items_to_collection", { collectionKey: action.target_collection_key, itemKeys: [action.itemKey] }, 870000);
        await mcpToolCall("remove_items_from_collection", { collectionKey: action.source_collection_key, itemKeys: [action.itemKey] }, 870001);
        action.status = "moved";
      } catch (error) {
        action.status = "error";
        action.error = String(error?.message || error);
      }
    }
    for (const action of plan.cleanup_actions || []) {
      if (action.status !== "planned" || action.action !== "delete_old_archive_collection") continue;
      try {
        await mcpToolCall("delete_collection", { collectionKey: action.collection_key, deleteItems: false }, 880000);
        action.status = "deleted_collection_only";
      } catch (error) {
        action.status = "collection_cleanup_required";
        action.error = String(error?.message || error);
      }
    }
  }
  if (applyDropQuarantine) {
    let deleteReviewCollectionKey = "";
    for (const action of plan.actions || []) {
      if (action.status === "planned" && action.action === "move_drop_to_delete_review_collection" && action.target_collection_key) {
        deleteReviewCollectionKey = action.target_collection_key;
        break;
      }
    }
    if (!deleteReviewCollectionKey) {
      const created = parseToolText(await mcpToolCall("create_collection", { name: DELETE_REVIEW_COLLECTION, parentCollection: plan.root_collection_key }, 890000));
      deleteReviewCollectionKey = collectionKey(created);
      for (const action of plan.actions || []) {
        if (action.action === "move_drop_to_delete_review_collection") action.target_collection_key = deleteReviewCollectionKey;
      }
    }
    for (const action of plan.actions || []) {
      if (action.status !== "planned" || action.action !== "move_drop_to_delete_review_collection") continue;
      try {
        await mcpToolCall("add_items_to_collection", { collectionKey: action.target_collection_key, itemKeys: [action.itemKey] }, 890100);
        if (action.source_collection_key) {
          await mcpToolCall("remove_items_from_collection", { collectionKey: action.source_collection_key, itemKeys: [action.itemKey] }, 890101);
        }
        action.status = "moved_to_delete_review";
      } catch (error) {
        action.status = "error";
        action.error = String(error?.message || error);
      }
    }
  }
  if (deleteDropItems) {
    for (const action of plan.actions || []) {
      if (action.status !== "drop_manual_delete_required" || action.action !== "manual_delete_zotero_item") continue;
      try {
        const result = await deleteItem(action.itemKey, { config: deleteConfig });
        action.delete_provider = result.provider || deleteConfig.provider || "";
        action.delete_http_status = result.status || "";
        action.delete_version = result.version || "";
        if (!result.ok) {
          action.status = "drop_delete_blocked";
          action.error = result.error || "delete_failed";
          action.delete_phase = result.phase || "";
        } else {
          action.status = "deleted_zotero_item";
          action.reason = "moved_to_zotero_trash_by_web_api";
        }
      } catch (error) {
        action.status = "error";
        action.error = String(error?.message || error);
      }
    }
  }
  return plan;
}

function summarize(plan, mode) {
  const all = [...(plan.actions || []), ...(plan.cleanup_actions || [])];
  const count = (status) => all.filter((entry) => entry.status === status).length;
  return {
    generated_at: new Date().toISOString(),
    mode,
    total_actions: all.length,
    moved: count("moved"),
    planned: count("planned"),
    no_op: count("no_op"),
    drop_manual_delete_required: count("drop_manual_delete_required"),
    drop_delete_blocked: count("drop_delete_blocked"),
    deleted_zotero_item: count("deleted_zotero_item"),
    moved_to_delete_review: count("moved_to_delete_review"),
    needs_review: count("needs_review"),
    errors: count("error"),
    collection_cleanup_required: count("collection_cleanup_required"),
    deleted_collection_only: count("deleted_collection_only"),
  };
}

function actionRows(plan) {
  return [...(plan.actions || []), ...(plan.cleanup_actions || [])].map((entry) => ({
    status: entry.status,
    action: entry.action,
    itemKey: entry.itemKey || "",
    date: entry.date || "",
    original_level: entry.original_level || "",
    assigned_level: entry.assigned_level || "",
    source_collection_key: entry.source_collection_key || "",
    target_collection_key: entry.target_collection_key || "",
    collection_key: entry.collection_key || "",
    collection_name: entry.collection_name || "",
    deleteItems: entry.deleteItems === false ? "false" : entry.deleteItems || "",
    feedback_action: entry.feedback_action || "",
    feedback_source: entry.feedback_source || "",
    feedback_row: entry.feedback_row || "",
    title: entry.title || "",
    reason: entry.reason || "",
    error: entry.error || "",
    delete_provider: entry.delete_provider || "",
    delete_http_status: entry.delete_http_status || "",
    delete_version: entry.delete_version || "",
    delete_phase: entry.delete_phase || "",
  }));
}

async function writeReports(manifestRoot, plan, summary) {
  const suffix = summary.mode === "dry-run" ? "dry_run" : `${summary.mode}_${summary.generated_at.replace(/[:.]/g, "-")}`;
  const manifestPath = path.join(manifestRoot, `zotero_feedback_collection_corrections_${suffix}.json`);
  const csvPath = path.join(manifestRoot, `zotero_feedback_collection_corrections_${suffix}.csv`);
  const dropCsvPath = path.join(manifestRoot, `drop_manual_delete_required_${suffix}.csv`);
  const deleteReviewCsvPath = path.join(manifestRoot, `drop_delete_review_${suffix}.csv`);
  const cleanupCsvPath = path.join(manifestRoot, `old_archive_collection_cleanup_${suffix}.csv`);
  const headers = ["status", "action", "itemKey", "date", "original_level", "assigned_level", "source_collection_key", "target_collection_key", "collection_key", "collection_name", "deleteItems", "feedback_action", "feedback_source", "feedback_row", "title", "reason", "error", "delete_provider", "delete_http_status", "delete_version", "delete_phase"];
  await writeCsv(csvPath, actionRows(plan), headers);
  await writeCsv(dropCsvPath, actionRows({ actions: plan.actions.filter((x) => x.status === "drop_manual_delete_required") }), headers);
  await writeCsv(deleteReviewCsvPath, actionRows({ actions: plan.actions.filter((x) => x.action === "move_drop_to_delete_review_collection") }), headers);
  await writeCsv(cleanupCsvPath, actionRows({ cleanup_actions: plan.cleanup_actions }), headers);
  await writeJson(manifestPath, {
    summary,
    csv_path: csvPath,
    drop_manual_delete_required_csv_path: dropCsvPath,
    drop_delete_review_csv_path: deleteReviewCsvPath,
    old_archive_collection_cleanup_csv_path: cleanupCsvPath,
    safety: {
      removes_from_old_grade_collections_only_after_add: true,
      removes_source_collections: false,
      deletes_zotero_items: summary.deleted_zotero_item > 0,
      deletes_zotero_items_only_when_apply_delete_drops: summary.mode === "apply-delete-drops",
      moves_drop_items_to_delete_review_only_when_apply_quarantine_drops: summary.mode === "apply-quarantine-drops",
      deletes_attachments: false,
      moves_pdf_files: false,
      accesses_zotero_sqlite: false,
      triggers_rss_pubmed_fetch: false,
      old_archive_delete_items: false,
    },
    ...plan,
  });
  return { manifestPath, csvPath, dropCsvPath, deleteReviewCsvPath, cleanupCsvPath };
}

export async function readCollections(mcpToolCall) {
  const top = parseToolText(await mcpToolCall("get_collections", { mode: "complete", limit: 1000 }, 850000));
  const out = Array.isArray(top) ? [...top] : [];
  for (const rootName of [ROOT_COLLECTION, OLD_ARCHIVE_COLLECTION]) {
    const root = findTopCollection(out, rootName);
    if (!root?.key) continue;
    const descendants = parseToolText(await mcpToolCall("get_subcollections", { collectionKey: root.key, recursive: true }, 850100 + out.length));
    for (const item of flattenCollections(descendants)) out.push(item);
  }
  const byKey = new Map();
  for (const collection of out) byKey.set(collectionKey(collection), collection);
  return [...byKey.values()];
}

export async function runZoteroFeedbackCollectionCorrections({
  argv = process.argv,
  runtime = buildRuntimeConfig(),
  mcpToolCall = defaultMcpToolCall,
} = {}) {
  const apply = argv.includes("--apply");
  const deleteDropItems = argv.includes("--apply-delete-drops");
  const quarantineDropItems = argv.includes("--apply-quarantine-drops") || argv.includes("--dry-run-quarantine-drops");
  const weekArg = argv.find((arg) => arg.startsWith("--review-week-root="));
  const reviewWeekRoot = weekArg ? weekArg.split("=").slice(1).join("=") : path.join(runtime.reviewRoot, "26 Week21");
  await ensureMcpReady(mcpToolCall);
  const collections = await readCollections(mcpToolCall);
  const root = findTopCollection(collections, ROOT_COLLECTION);
  const records = await scanLiteratureRecords(runtime.researchRoot);
  const feedbackRows = await scanFeedbackRows(reviewWeekRoot);
  const archivePlan = buildMovePlan({ records, feedbackRows, archiveRoot: path.join(runtime.researchRoot, "literature_archive") });
  await enrichArchivePlanWithZoteroTitleMatches(archivePlan, { mcpToolCall });
  const plan = buildCorrectionPlan({ archivePlan, collections, includeArchiveCleanup: true, dropMode: quarantineDropItems ? "quarantine" : "manual" });
  plan.root_collection_key = collectionKey(root);
  if (quarantineDropItems && !plan.root_collection_key) throw new Error("root collection 文献池 not found");
  if (apply || deleteDropItems || argv.includes("--apply-quarantine-drops")) {
    await applyCorrectionPlan(plan, {
      mcpToolCall,
      applyMovesAndCleanup: apply,
      applyDropQuarantine: argv.includes("--apply-quarantine-drops"),
      deleteDropItems,
    });
  }
  const summary = summarize(plan, deleteDropItems ? "apply-delete-drops" : argv.includes("--apply-quarantine-drops") ? "apply-quarantine-drops" : quarantineDropItems ? "dry-run-quarantine-drops" : apply ? "apply" : "dry-run");
  const reports = await writeReports(path.join(runtime.researchRoot, "run_manifests"), plan, summary);
  return { ...reports, summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runZoteroFeedbackCollectionCorrections().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
