import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { buildRuntimeConfig } from "./lib/runtime_config.mjs";
import { LABELS } from "./lib/triage_policy.mjs";

const LEVELS = [LABELS.A, LABELS.B, LABELS.C, LABELS.D];
const NEEDS_REVIEW = "needs_review";
const SUPPORTED_FEEDBACK = new Set(["keep", "upgrade", "drop", "downgrade"]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeIdentifier(value) {
  return cleanText(value).toLowerCase();
}

function normalizeDoi(value) {
  return normalizeIdentifier(value)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "");
}

function normalizePmcid(value) {
  const v = normalizeIdentifier(value);
  if (!v) return "";
  return v.startsWith("pmc") ? v : `pmc${v}`;
}

function normalizeTitle(value) {
  return cleanText(value)
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


function normalizeLevel(value) {
  const text = cleanText(value);
  if (!text) return "";
  if (LEVELS.includes(text)) return text;
  const upper = text.toUpperCase();
  if (upper === "A") return LABELS.A;
  if (upper === "B") return LABELS.B;
  if (upper === "C") return LABELS.C;
  if (upper === "D") return LABELS.D;
  if (text.includes("课题")) return LABELS.A;
  if (text.includes("专题")) return LABELS.B;
  if (text.includes("领域")) return LABELS.C;
  if (text.includes("无关")) return LABELS.D;
  return "";
}

function levelFromFeedback(feedback, currentLevel) {
  const current = normalizeLevel(currentLevel);
  const idx = LEVELS.indexOf(current);
  const fb = String(feedback || "").trim().toLowerCase();
  if (fb === "keep") return current || "";
  if (fb === "drop") return LABELS.D;
  if (fb === "upgrade") return idx > 0 ? LEVELS[idx - 1] : current || LABELS.A;
  if (fb === "downgrade") return idx >= 0 && idx < LEVELS.length - 1 ? LEVELS[idx + 1] : current || "";
  return "";
}

function levelDecisionFromFeedback(feedback, currentLevel) {
  const current = normalizeLevel(currentLevel);
  const fb = String(feedback?.feedback || "").trim().toLowerCase();
  if ((fb === "upgrade" || fb === "downgrade") && feedback?.explicit_level) {
    return { level: feedback.explicit_level, source: "explicit_recommended_level" };
  }
  if (fb === "keep") {
    return current
      ? { level: current, source: "keep_original_level" }
      : { level: "", source: "insufficient_level_evidence" };
  }
  if (fb === "drop") return { level: LABELS.D, source: "feedback_drop_to_D" };
  if ((fb === "upgrade" || fb === "downgrade") && !current) {
    return { level: "", source: "insufficient_level_evidence" };
  }
  const inferred = levelFromFeedback(fb, current);
  return inferred
    ? { level: inferred, source: "workflow_rules_adjacent_level" }
    : { level: "", source: "insufficient_level_evidence" };
}

function stableRecordKey(rec = {}) {
  return rec.document_id || rec.stable_id || rec.doi && `doi:${rec.doi}` || rec.pmid && `pmid:${rec.pmid}` || rec.pmcid && `pmcid:${rec.pmcid}` || rec.itemKey && `zotero:${rec.itemKey}` || rec.title_key && `title:${rec.title_key}` || rec.source_path || "";
}

function parseDateLabel(label) {
  const match = String(label || "").match(/^(\d{2,4})\.(\d{1,2})\.(\d{1,2})$/);
  if (!match) return "";
  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
  return `${year}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function dateFromPath(filePath) {
  const parts = String(filePath || "").split(/[\\/]+/);
  for (const part of parts) {
    const parsed = parseDateLabel(part);
    if (parsed) return parsed;
  }
  return "";
}

function parseIsoDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return 0;
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) ? time : 0;
}

function colRefToIndex(ref = "") {
  const letters = String(ref).match(/[A-Z]+/i)?.[0] || "";
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function escapeXml(s) {
  return String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
}

function parseZipEntries(buffer) {
  const entries = new Map();
  let pos = 0;
  while (pos + 30 <= buffer.length) {
    if (buffer.readUInt32LE(pos) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(pos + 8);
    const compSize = buffer.readUInt32LE(pos + 18);
    const nameLen = buffer.readUInt16LE(pos + 26);
    const extraLen = buffer.readUInt16LE(pos + 28);
    const name = buffer.slice(pos + 30, pos + 30 + nameLen).toString("utf8");
    const dataStart = pos + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    const comp = buffer.slice(dataStart, dataEnd);
    const data = method === 0 ? comp : method === 8 ? inflateRawSync(comp) : Buffer.alloc(0);
    entries.set(name, data.toString("utf8"));
    pos = dataEnd;
  }
  return entries;
}

function parseRelationshipTargets(relsXml) {
  const relMap = new Map();
  for (const match of String(relsXml || "").matchAll(/<Relationship([^>]*)\/?>/g)) {
    const attrs = match[1] || "";
    const id = (attrs.match(/\bId="([^"]+)"/) || [])[1] || "";
    const target = (attrs.match(/\bTarget="([^"]+)"/) || [])[1] || "";
    if (id && target) relMap.set(id, target.replace(/^\//, ""));
  }
  return relMap;
}

export function readXlsxSheets(filePath) {
  const entries = parseZipEntries(fsSync.readFileSync(filePath));
  const workbook = entries.get("xl/workbook.xml");
  if (!workbook) throw new Error("workbook_xml_missing");
  const rels = entries.get("xl/_rels/workbook.xml.rels") || "";
  const shared = Array.from(String(entries.get("xl/sharedStrings.xml") || "").matchAll(/<[^: <>\s]*:?si[^>]*>([\s\S]*?)<\/[^: <>\s]*:?si>/g)).map((si) => {
    return Array.from(String(si[1] || "").matchAll(/<[^: <>\s]*:?t[^>]*>([\s\S]*?)<\/[^: <>\s]*:?t>/g)).map((m) => escapeXml(m[1])).join("");
  });
  const sheetDefs = Array.from(workbook.matchAll(/<[^: <>\s]*:?sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/?>/g)).map((m) => ({ name: m[1], rid: m[2] }));
  const relMap = new Map(Array.from(parseRelationshipTargets(rels).entries()).map(([id, target]) => [id, target.startsWith("xl/") ? target : `xl/${target}`]));
  const sheets = new Map();
  for (const sheet of sheetDefs) {
    const target = relMap.get(sheet.rid);
    const xml = target ? entries.get(target) : "";
    if (!xml) continue;
    const rows = [];
    for (const rowMatch of xml.matchAll(/<[^: <>\s]*:?row[^>]*>([\s\S]*?)<\/[^: <>\s]*:?row>/g)) {
      const cells = [];
      for (const c of rowMatch[1].matchAll(/<[^: <>\s]*:?c([^>]*)>([\s\S]*?)<\/[^: <>\s]*:?c>|<[^: <>\s]*:?c([^>]*)\/>/g)) {
        const attrs = c[1] || c[3] || "";
        const inner = c[2] || "";
        const ref = (attrs.match(/\br="([^"]+)"/) || [])[1] || "";
        const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || "";
        const colIdx = colRefToIndex(ref);
        if (colIdx < 0) continue;
        const raw = (inner.match(/<[^: <>\s]*:?v[^>]*>([\s\S]*?)<\/[^: <>\s]*:?v>/) || [])[1] || "";
        if (type === "s") cells[colIdx] = shared[Number(raw) || 0] || "";
        else if (type === "inlineStr") cells[colIdx] = Array.from(inner.matchAll(/<[^: <>\s]*:?t[^>]*>([\s\S]*?)<\/[^: <>\s]*:?t>/g)).map((m) => escapeXml(m[1])).join("");
        else cells[colIdx] = escapeXml(raw || (inner.match(/<[^: <>\s]*:?t[^>]*>([\s\S]*?)<\/[^: <>\s]*:?t>/) || [])[1] || "");
      }
      rows.push(cells.map((x) => x == null ? "" : String(x)));
    }
    sheets.set(sheet.name, rows);
  }
  return sheets;
}

function rowsToObjects(rows = []) {
  if (!rows.length) return [];
  const headerIndex = rows.findIndex((row) => row.some((cell) => ["feedback", "反馈", "用户反馈"].includes(cleanText(cell).toLowerCase())));
  const idx = headerIndex >= 0 ? headerIndex : 0;
  const headers = (rows[idx] || []).map(cleanText);
  return rows.slice(idx + 1)
    .filter((row) => row.some((cell) => cleanText(cell)))
    .map((row, rowOffset) => ({ row_number: idx + rowOffset + 2, data: Object.fromEntries(headers.map((header, col) => [header, row[col] ?? ""])) }));
}

function pick(row, aliases) {
  const pairs = Object.entries(row || {});
  for (const alias of aliases) {
    const found = pairs.find(([key]) => cleanText(key).toLowerCase() === String(alias).toLowerCase());
    if (found) return cleanText(found[1]);
  }
  return "";
}

function pickIdFields(row) {
  return {
    stable_id: pick(row, ["stable_id", "stable ID", "record_id", "记录ID"]),
    doi: normalizeDoi(pick(row, ["DOI", "doi"])),
    pmid: normalizeIdentifier(pick(row, ["PMID", "pmid"])),
    pmcid: normalizePmcid(pick(row, ["PMCID", "pmcid"])),
    itemKey: normalizeIdentifier(pick(row, ["Zotero条目Key", "Zotero Key", "itemKey", "zotero_item_key"])),
    document_id: pick(row, ["document_id", "Document ID", "内部document_id", "内部文档ID"]),
  };
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

export async function scanLiteratureRecords(researchRoot) {
  const triagedFiles = await walkFiles(researchRoot, (_full, name) => name === "triaged_items.json");
  const files = [];
  for (const triagedFile of triagedFiles) {
    const reviewSource = path.join(path.dirname(triagedFile), "desktop_daily_review_source.json");
    files.push(fsSync.existsSync(reviewSource) ? reviewSource : triagedFile);
  }
  const records = [];
  for (const file of files) {
    let payload;
    try { payload = JSON.parse(await fs.readFile(file, "utf8")); } catch { continue; }
    const items = Array.isArray(payload) ? payload : Array.isArray(payload?.triaged) ? payload.triaged : [];
    if (!Array.isArray(items)) continue;
    const date = dateFromPath(file);
    items.forEach((item, index) => {
      const title = cleanText(item.title || item["英文标题"] || item["标题翻译"] || item["中文标题"]);
      const translatedTitle = cleanText(item["标题翻译"] || item["中文标题"]);
      records.push({
        source_path: `${file}#${index}`,
        source_file: file,
        source_index: index,
        date,
        title,
        title_key: normalizeTitle(title),
        translated_title: translatedTitle,
        translated_title_key: normalizeTitle(translatedTitle),
        doi: cleanText(item.doi || item.DOI),
        pmid: normalizeIdentifier(item.pmid),
        pmcid: normalizePmcid(item.pmcid),
        itemKey: normalizeIdentifier(item.itemKey || item.zotero_item_key),
        document_id: cleanText(item.document_id || item.documentId || item.id),
        stable_id: cleanText(item.stable_id || item.record_id),
        current_level: normalizeLevel(item.grade_label || item["推荐等级"] || item.grade),
        item,
      });
    });
  }
  return records;
}

export async function scanFeedbackRows(reviewRoot) {
  const files = await walkFiles(reviewRoot, (_full, name) => name === "隔日报.xlsx" || name === "daily_review.xlsx");
  const rows = [];
  for (const file of files) {
    let sheets;
    try { sheets = readXlsxSheets(file); } catch (error) {
      rows.push({ feedback_source: file, status: "unreadable", error: String(error.message || error) });
      continue;
    }
    const sheetRows = sheets.get("每日反馈") || sheets.values().next().value || [];
    for (const row of rowsToObjects(sheetRows)) {
      const data = row.data;
      const feedback = pick(data, ["feedback", "Feedback", "反馈", "用户反馈"]).toLowerCase();
      if (!SUPPORTED_FEEDBACK.has(feedback)) continue;
      const englishTitle = pick(data, ["英文标题", "title", "Title", "English Title"]);
      const translatedTitle = pick(data, ["标题翻译", "中文标题", "translated_title", "title_translation"]);
      const explicitLevel = normalizeLevel(pick(data, ["推荐等级", "等级", "grade", "Grade"]));
      const ids = pickIdFields(data);
      rows.push({
        feedback_source: file,
        row_number: row.row_number,
        date: dateFromPath(file),
        feedback,
        explicit_level: explicitLevel,
        title: translatedTitle || englishTitle,
        title_key: normalizeTitle(translatedTitle || englishTitle),
        english_title_key: normalizeTitle(englishTitle),
        translated_title_key: normalizeTitle(translatedTitle),
        english_title: englishTitle,
        translated_title: translatedTitle,
        ...ids,
        comment: pick(data, ["comment", "Comment", "备注", "评价备注"]),
        raw: data,
      });
    }
  }
  return rows;
}

function uniqueTargetPath(targetDir, title, ext = ".json") {
  const base = normalizeTitle(title).slice(0, 80).replace(/\s+/g, "-") || "untitled";
  return path.join(targetDir, `${base}${ext}`);
}

function shortHash(value) {
  return createHash("sha1").update(String(value || "")).digest("hex").slice(0, 8);
}

function addSuffixToPath(filePath, suffix) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}-${suffix}${parsed.ext || ".json"}`);
}

function addIndex(map, key, rec) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  if (!map.get(key).includes(rec)) map.get(key).push(rec);
}

function buildIndexes(records = []) {
  const indexes = {
    stable_id_exact: new Map(),
    doi_exact: new Map(),
    pmid_exact: new Map(),
    pmcid_exact: new Map(),
    zotero_key_exact: new Map(),
    internal_document_id_exact: new Map(),
    title_exact_normalized: new Map(),
  };
  for (const rec of records) {
    addIndex(indexes.stable_id_exact, rec.stable_id, rec);
    addIndex(indexes.doi_exact, normalizeDoi(rec.doi), rec);
    addIndex(indexes.pmid_exact, normalizeIdentifier(rec.pmid), rec);
    addIndex(indexes.pmcid_exact, normalizePmcid(rec.pmcid), rec);
    addIndex(indexes.zotero_key_exact, normalizeIdentifier(rec.itemKey), rec);
    addIndex(indexes.internal_document_id_exact, rec.document_id, rec);
    for (const key of [rec.title_key, rec.translated_title_key].filter(Boolean)) addIndex(indexes.title_exact_normalized, key, rec);
  }
  return indexes;
}

function matchFeedbackToRecords(feedback, indexes) {
  const attempts = [
    ["stable_id_exact", feedback.stable_id],
    ["doi_exact", feedback.doi],
    ["pmid_exact", feedback.pmid],
    ["pmcid_exact", feedback.pmcid],
    ["zotero_key_exact", feedback.itemKey],
    ["internal_document_id_exact", feedback.document_id],
    ["title_exact_normalized", feedback.translated_title_key],
    ["title_exact_normalized", feedback.english_title_key],
    ["title_exact_normalized", feedback.title_key],
  ];
  for (const [method, key] of attempts) {
    if (!key) continue;
    const matches = indexes[method]?.get(key) || [];
    if (matches.length) {
      return { method, key, matches, confidence: method === "title_exact_normalized" ? 0.95 : 1 };
    }
  }
  return { method: "title_exact_normalized", key: feedback.title_key || "", matches: [], confidence: 0 };
}

function feedbackSourceRef(entry = {}) {
  return `${entry.feedback_source || ""}#${entry.feedback_row || ""}`;
}

function feedbackSignature(entry = {}) {
  return [
    entry.feedback?.title_key || entry.feedback?.english_title_key || "",
    entry.feedback?.feedback || "",
    entry.assigned_level || "",
    entry.date || "",
    entry.feedback_source || "",
  ].join("|");
}

function listUnique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function withResolution(entry, fields = {}) {
  const mergedSources = fields.merged_feedback_sources || [feedbackSourceRef(entry)];
  return {
    ...entry,
    duplicate_count: fields.duplicate_count ?? 1,
    merged_feedback_sources: mergedSources,
    chosen_feedback_source: fields.chosen_feedback_source || feedbackSourceRef(entry),
    superseded_feedback_sources: fields.superseded_feedback_sources || [],
    resolution_method: fields.resolution_method || "single_feedback",
    unresolved_reason: fields.unresolved_reason || entry.unresolved_reason || "",
    original_feedback_count: fields.original_feedback_count ?? 1,
    assigned_level_source: fields.assigned_level_source || entry.assigned_level_source || "",
    date_source: fields.date_source || entry.date_source || "",
  };
}

function resolveProvisionalGroup(entries = []) {
  if (entries.length === 1) return [withResolution(entries[0])];
  const originalFeedbackCount = entries.length;
  const sources = listUnique(entries.map(feedbackSourceRef));
  const duplicateCount = entries.length;
  const uniqueSignatures = new Set(entries.map(feedbackSignature));
  const assignedLevels = listUnique(entries.filter((entry) => entry.status === "planned").map((entry) => entry.assigned_level));
  const needsReviewOnly = entries.every((entry) => entry.status !== "planned");
  const recordDate = entries[0]?.date || "";
  const dateSource = entries[0]?.date_source || "";

  if (needsReviewOnly) {
    const chosen = entries[0];
    return [withResolution({
      ...chosen,
      status: "needs_review",
      reason: "feedback_level_unresolved",
      unresolved_reason: "insufficient_level_evidence",
      confidence: Math.min(chosen.confidence ?? 0, 0.8),
    }, {
      duplicate_count: duplicateCount,
      merged_feedback_sources: sources,
      resolution_method: "insufficient_level_evidence",
      unresolved_reason: "insufficient_level_evidence",
      original_feedback_count: originalFeedbackCount,
      date_source: dateSource,
    })];
  }

  if (!recordDate && listUnique(entries.map((entry) => entry.feedback?.date)).length > 1) {
    return entries.map((entry) => withResolution({
      ...entry,
      status: "conflict",
      reason: "true_date_conflict",
      conflict_category: "true_date_conflict",
      unresolved_reason: "true_date_conflict",
      confidence: Math.min(entry.confidence ?? 0, 0.5),
    }, {
      duplicate_count: duplicateCount,
      merged_feedback_sources: sources,
      resolution_method: "unresolved_conflict",
      unresolved_reason: "true_date_conflict",
      original_feedback_count: originalFeedbackCount,
      date_source: dateSource,
    }));
  }

  if (assignedLevels.length === 1) {
    const chosen = entries.find((entry) => entry.status === "planned") || entries[0];
    return [withResolution(chosen, {
      duplicate_count: duplicateCount,
      merged_feedback_sources: sources,
      resolution_method: uniqueSignatures.size === 1 ? "duplicate_feedback_merged" : "consistent_multi_feedback_merged",
      original_feedback_count: originalFeedbackCount,
      date_source: dateSource,
    })];
  }

  const datedEntries = entries
    .map((entry) => ({ entry, time: parseIsoDate(entry.feedback?.date) }))
    .filter((item) => item.time && item.entry.status === "planned");
  const latestTime = datedEntries.length ? Math.max(...datedEntries.map((item) => item.time)) : 0;
  const latest = datedEntries.filter((item) => item.time === latestTime);
  if (latest.length === 1 && datedEntries.every((item) => item.time === latestTime || item.time < latestTime)) {
    const chosen = latest[0].entry;
    return [withResolution(chosen, {
      duplicate_count: duplicateCount,
      merged_feedback_sources: sources,
      chosen_feedback_source: feedbackSourceRef(chosen),
      superseded_feedback_sources: sources.filter((source) => source !== feedbackSourceRef(chosen)),
      resolution_method: "superseded_by_newer_feedback",
      original_feedback_count: originalFeedbackCount,
      date_source: dateSource,
    })];
  }

  return entries.map((entry) => withResolution({
    ...entry,
    status: "conflict",
    reason: "true_level_conflict",
    conflict_category: "true_level_conflict",
    unresolved_reason: "true_level_conflict",
    confidence: Math.min(entry.confidence ?? 0, 0.5),
  }, {
    duplicate_count: duplicateCount,
    merged_feedback_sources: sources,
    resolution_method: "unresolved_conflict",
    unresolved_reason: "true_level_conflict",
    original_feedback_count: originalFeedbackCount,
    date_source: dateSource,
  }));
}

export function buildMovePlan({ records = [], feedbackRows = [], archiveRoot }) {
  const indexes = buildIndexes(records);
  const plan = [];
  const provisional = [];
  for (const feedback of feedbackRows.filter((row) => row.feedback && row.status !== "unreadable")) {
    const { method, key, matches, confidence } = matchFeedbackToRecords(feedback, indexes);
    if (matches.length !== 1) {
      const unresolvedReason = matches.length > 1 ? "one_feedback_multiple_literature" : "no_matching_literature_record";
      plan.push(withResolution({
        status: matches.length > 1 ? "conflict" : "needs_review",
        reason: matches.length > 1 ? "multiple_literature_matches" : "no_matching_literature_record",
        conflict_category: matches.length > 1 ? "one_feedback_multiple_literature" : "",
        feedback_source: feedback.feedback_source,
        feedback_row: feedback.row_number,
        date: feedback.date,
        assigned_level: NEEDS_REVIEW,
        match_method: method,
        match_key: key,
        confidence: matches.length > 1 ? Math.min(confidence, 0.5) : 0,
        source_path: "",
        target_path: path.join(archiveRoot, feedback.date || "unknown_date", NEEDS_REVIEW),
        feedback,
        assigned_level_source: "unresolved",
        date_source: feedback.date ? "feedback_source_path" : "unknown",
        unresolved_reason: unresolvedReason,
      }, {
        resolution_method: matches.length > 1 ? "unresolved_conflict" : "unmatched_feedback",
        unresolved_reason: unresolvedReason,
        assigned_level_source: "unresolved",
        date_source: feedback.date ? "feedback_source_path" : "unknown",
      }));
      continue;
    }
    const rec = matches[0];
    const decision = levelDecisionFromFeedback(feedback, rec.current_level);
    const assigned = decision.level;
    const finalLevel = assigned || NEEDS_REVIEW;
    const status = assigned ? "planned" : "needs_review";
    const date = rec.date || feedback.date || "";
    const dateSource = rec.date ? "literature_day_directory" : feedback.date ? "feedback_source_path" : "unknown";
    const targetDir = path.join(archiveRoot, date || "unknown_date", finalLevel);
    provisional.push({
      status,
      reason: assigned ? "feedback_level_resolved" : "feedback_level_unresolved",
      source_path: rec.source_path,
      target_path: uniqueTargetPath(targetDir, rec.title),
      date,
      assigned_level: finalLevel,
      original_level: rec.current_level,
      feedback_source: feedback.feedback_source,
      feedback_row: feedback.row_number,
      match_key: key,
      match_method: method,
      confidence,
      feedback,
      assigned_level_source: assigned ? decision.source : "insufficient_level_evidence",
      date_source: dateSource,
      unresolved_reason: assigned ? "" : "insufficient_level_evidence",
      record: {
        title: rec.title,
        doi: rec.doi,
        pmid: rec.pmid,
        pmcid: rec.pmcid,
        itemKey: rec.itemKey,
        document_id: rec.document_id,
        stable_id: rec.stable_id,
        record_key: stableRecordKey(rec),
        source_file: rec.source_file,
        source_index: rec.source_index,
        source_kind: "pipeline_json_record",
      },
    });
  }
  const byRecord = new Map();
  for (const entry of provisional) {
    const key = entry.record?.record_key || entry.source_path;
    if (!byRecord.has(key)) byRecord.set(key, []);
    byRecord.get(key).push(entry);
  }
  for (const entries of byRecord.values()) {
    plan.push(...resolveProvisionalGroup(entries));
  }
  resolveDuplicateTargetPaths(plan);
  return plan;
}

function resolveDuplicateTargetPaths(plan = []) {
  const byTarget = new Map();
  for (const entry of plan.filter((item) => item.status === "planned")) {
    if (!byTarget.has(entry.target_path)) byTarget.set(entry.target_path, []);
    byTarget.get(entry.target_path).push(entry);
  }
  for (const [targetPath, entries] of byTarget.entries()) {
    if (entries.length <= 1) continue;
    for (const entry of entries) {
      const suffix = shortHash(entry.source_path || entry.record?.record_key || feedbackSourceRef(entry));
      entry.duplicate_target_path_original = targetPath;
      entry.duplicate_target_path_count = entries.length;
      entry.target_path_resolution = "short_hash_suffix";
      entry.target_path = addSuffixToPath(targetPath, suffix);
    }
  }
}

function groupCounts(values = []) {
  return values.reduce((acc, value) => {
    const key = value || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export function summarizePlan(plan = [], records = [], feedbackRows = []) {
  const count = (status) => plan.filter((entry) => entry.status === status).length;
  return {
    generated_at: new Date().toISOString(),
    literature_records_scanned: records.length,
    feedback_rows_scanned: feedbackRows.filter((row) => row.status !== "unreadable").length,
    feedback_files_unreadable: feedbackRows.filter((row) => row.status === "unreadable").length,
    total_planned: plan.length,
    planned: count("planned"),
    moved: count("moved"),
    skipped: count("skipped"),
    needs_review: count("needs_review"),
    conflicts: count("conflict"),
    match_method_stats: groupCounts(plan.map((entry) => entry.match_method)),
    conflict_category_stats: groupCounts(plan.filter((entry) => entry.status === "conflict").map((entry) => entry.conflict_category || entry.reason)),
    resolution_method_stats: groupCounts(plan.map((entry) => entry.resolution_method)),
    duplicate_target_paths_resolved: plan.filter((entry) => entry.target_path_resolution === "short_hash_suffix").length,
    auto_apply_candidates: plan.filter((entry) => entry.status === "planned").length,
    auto_apply_excluded_needs_review: count("needs_review"),
    auto_apply_excluded_conflicts: count("conflict"),
    resolved_duplicate_feedback: plan.filter((entry) => entry.resolution_method === "duplicate_feedback_merged").reduce((sum, entry) => sum + Math.max(0, Number(entry.duplicate_count || 0) - 1), 0),
    resolved_consistent_multi_feedback: plan.filter((entry) => entry.resolution_method === "consistent_multi_feedback_merged").reduce((sum, entry) => sum + Math.max(0, Number(entry.original_feedback_count || 0) - 1), 0),
    resolved_by_newer_feedback: plan.filter((entry) => entry.resolution_method === "superseded_by_newer_feedback").reduce((sum, entry) => sum + Math.max(0, Number(entry.superseded_feedback_sources?.length || 0)), 0),
  };
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(pathname, rows, headers) {
  const text = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  return fs.writeFile(pathname, `${text}\n`, "utf8");
}

function previewRows(plan = []) {
  return plan.map((entry) => ({
    status: entry.status,
    source_path: entry.source_path || "",
    target_path: entry.target_path || "",
    date: entry.date || "",
    assigned_level: entry.assigned_level || "",
    original_level: entry.original_level || "",
    feedback_action: entry.feedback?.feedback || "",
    recommended_level: entry.assigned_level || "",
    title: entry.record?.title || entry.feedback?.title || "",
    match_method: entry.match_method || "",
    match_key: entry.match_key || "",
    confidence: entry.confidence ?? "",
    feedback_source: entry.feedback_source || "",
    conflict_reason: entry.conflict_category || entry.reason || entry.error || "",
    error: entry.error || "",
    duplicate_count: entry.duplicate_count ?? "",
    merged_feedback_sources: Array.isArray(entry.merged_feedback_sources) ? entry.merged_feedback_sources.join("; ") : entry.merged_feedback_sources || "",
    chosen_feedback_source: entry.chosen_feedback_source || "",
    superseded_feedback_sources: Array.isArray(entry.superseded_feedback_sources) ? entry.superseded_feedback_sources.join("; ") : entry.superseded_feedback_sources || "",
    resolution_method: entry.resolution_method || "",
    unresolved_reason: entry.unresolved_reason || "",
    original_feedback_count: entry.original_feedback_count ?? "",
    assigned_level_source: entry.assigned_level_source || "",
    date_source: entry.date_source || "",
    duplicate_target_path_original: entry.duplicate_target_path_original || "",
    target_path_resolution: entry.target_path_resolution || "",
    move_object_type: entry.move_object_type || "metadata_record",
  }));
}

function conflictRows(plan = []) {
  return plan.filter((entry) => entry.status === "conflict").map((entry) => ({
    conflict_category: entry.conflict_category || entry.reason || "other",
    conflict_reason: entry.reason || "",
    feedback_source: entry.feedback_source || "",
    feedback_row: entry.feedback_row || "",
    feedback_action: entry.feedback?.feedback || "",
    title: entry.record?.title || entry.feedback?.title || "",
    source_path: entry.source_path || "",
    match_method: entry.match_method || "",
    match_key: entry.match_key || "",
    confidence: entry.confidence ?? "",
    date: entry.date || "",
    assigned_level: entry.assigned_level || "",
    original_level: entry.original_level || "",
    unresolved_reason: entry.unresolved_reason || "",
    original_feedback_count: entry.original_feedback_count ?? "",
    resolution_method: entry.resolution_method || "",
  }));
}

function resolvedRows(plan = []) {
  const resolved = new Set(["duplicate_feedback_merged", "consistent_multi_feedback_merged", "superseded_by_newer_feedback"]);
  return previewRows(plan.filter((entry) => resolved.has(entry.resolution_method)));
}

function candidateRows(plan = []) {
  return previewRows(plan.filter((entry) => entry.status === "planned"));
}

export async function writeCsvReports(manifestRoot, plan = []) {
  await fs.mkdir(manifestRoot, { recursive: true });
  const previewPath = path.join(manifestRoot, "historical_feedback_archive_dry_run_preview.csv");
  const conflictPath = path.join(manifestRoot, "historical_feedback_archive_conflicts.csv");
  const resolvedPath = path.join(manifestRoot, "historical_feedback_archive_resolved_feedback.csv");
  const candidatesPath = path.join(manifestRoot, "historical_feedback_archive_apply_candidates.csv");
  const previewHeaders = ["status", "source_path", "target_path", "date", "assigned_level", "original_level", "feedback_action", "recommended_level", "title", "match_method", "match_key", "confidence", "feedback_source", "conflict_reason", "error", "duplicate_count", "merged_feedback_sources", "chosen_feedback_source", "superseded_feedback_sources", "resolution_method", "unresolved_reason", "original_feedback_count", "assigned_level_source", "date_source", "duplicate_target_path_original", "target_path_resolution", "move_object_type"];
  const candidateHeaders = ["source_path", "target_path", "date", "assigned_level", "original_level", "feedback_action", "recommended_level", "title", "match_method", "match_key", "confidence", "resolution_method", "duplicate_count", "merged_feedback_sources", "chosen_feedback_source", "assigned_level_source", "date_source"];
  const conflictHeaders = ["conflict_category", "conflict_reason", "feedback_source", "feedback_row", "feedback_action", "title", "source_path", "match_method", "match_key", "confidence", "date", "assigned_level", "original_level", "unresolved_reason", "original_feedback_count", "resolution_method"];
  await writeCsv(previewPath, previewRows(plan), previewHeaders);
  await writeCsv(conflictPath, conflictRows(plan), conflictHeaders);
  await writeCsv(resolvedPath, resolvedRows(plan), previewHeaders);
  await writeCsv(candidatesPath, candidateRows(plan), candidateHeaders);
  return { previewPath, conflictPath, resolvedPath, candidatesPath };
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function isInsidePath(root, target) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`);
}

export async function applyArchivePlan(plan, { archiveRoot }) {
  for (const entry of plan.filter((item) => item.status === "planned")) {
    try {
      entry.move_object_type = "metadata_record";
      if (!isInsidePath(archiveRoot, entry.target_path)) {
        entry.status = "skipped";
        entry.error = "target_path_outside_archive_root";
        continue;
      }
      const sourceFile = entry.record?.source_file || String(entry.source_path || "").split("#")[0];
      if (!sourceFile || !fsSync.existsSync(sourceFile)) {
        entry.status = "skipped";
        entry.error = "source_metadata_file_missing";
        continue;
      }
      if (fsSync.existsSync(entry.target_path)) {
        entry.status = "skipped";
        entry.error = "target_exists";
        continue;
      }
      await writeJsonFile(entry.target_path, {
        archived_from: entry.source_path,
        date: entry.date,
        assigned_level: entry.assigned_level,
        feedback_source: entry.feedback_source,
        feedback_row: entry.feedback_row,
        match_method: entry.match_method,
        confidence: entry.confidence,
        move_object_type: "metadata_record",
        record: entry.record,
      });
      entry.status = "moved";
      entry.reason = "metadata_record_archived";
    } catch (error) {
      entry.status = "skipped";
      entry.error = String(error.message || error);
    }
  }
  return plan;
}

export async function runArchiveHistoryByFeedback({ argv = process.argv, runtime = buildRuntimeConfig() } = {}) {
  const plainApply = argv.includes("--apply");
  const applyAutoOnly = argv.includes("--apply-auto-only");
  if (plainApply && !applyAutoOnly) {
    throw new Error("plain_apply_disabled_use_apply_auto_only");
  }
  const archiveRoot = path.join(runtime.researchRoot, "literature_archive");
  const manifestRoot = path.join(runtime.researchRoot, "run_manifests");
  const records = await scanLiteratureRecords(runtime.researchRoot);
  const feedbackRows = await scanFeedbackRows(runtime.reviewRoot);
  const plan = buildMovePlan({ records, feedbackRows, archiveRoot });
  if (applyAutoOnly) await applyArchivePlan(plan, { archiveRoot });
  const mode = applyAutoOnly ? "apply-auto-only" : "dry-run";
  const summary = { ...summarizePlan(plan, records, feedbackRows), mode };
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const manifestPath = path.join(manifestRoot, applyAutoOnly ? `historical_feedback_archive_apply_auto_only_${timestamp}.json` : "historical_feedback_archive_dry_run.json");
  const csvReports = await writeCsvReports(manifestRoot, plan);
  await writeJsonFile(manifestPath, {
    summary,
    preview_csv_path: csvReports.previewPath,
    conflict_csv_path: csvReports.conflictPath,
    resolved_feedback_csv_path: csvReports.resolvedPath,
    apply_candidates_csv_path: csvReports.candidatesPath,
    move_object_clarification: {
      source_path_represents: "pipeline JSON record reference in the form <pipeline-json-file>#<array-index>",
      actual_pdf_or_attachment_paths_detected: false,
      apply_auto_only_moves: "metadata JSON archive records only",
      zotero_library_or_attachments_affected: false,
    },
    safety: {
      rss_pubmed_refetch_triggered: false,
      zotero_database_write_triggered: false,
      zotero_sqlite_accessed: false,
      startup_logic_changed: false,
      future_automation_default_changed: false,
      files_deleted: false,
      target_overwrite_allowed: false,
    },
    plan,
  });
  return { summary, manifestPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runArchiveHistoryByFeedback().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
