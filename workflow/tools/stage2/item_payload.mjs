import { cleanJournalName, inferJournalFromUrl } from "../lib/journal_name_cleaner.mjs";
import { LABELS, normalizeGradeLetter } from "../lib/grade_primitives.mjs";

const LEGACY_GRADE_COLLECTIONS = {
  [LABELS.A]: LABELS.A,
  [LABELS.B]: LABELS.B,
  [LABELS.C]: LABELS.C,
};

export function resolveGradeName(item) {
  const letter = normalizeGradeLetter(item?.final_grade)
    || normalizeGradeLetter(item?.grade)
    || "";
  if (letter) return LABELS[letter] || LABELS.C;
  return LEGACY_GRADE_COLLECTIONS[item?.grade_label] || LABELS.C;
}

export function safeZoteroString(value) {
  return String(value || "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .normalize("NFC");
}

export function buildZoteroExtra(item = {}) {
  const runId = safeZoteroString(process.env.review_results_RUN_ID || "");
  return safeZoteroString([
    item.pmid ? `PMID: ${item.pmid}` : "",
    item.pmcid ? `PMCID: ${item.pmcid}` : "",
    item.doi ? `DOI: ${item.doi}` : "",
    runId ? `run_id: ${runId}` : "",
    `source_channel: ${item.source_channel || ""}`,
    `source_platform: ${item.source_platform || ""}`,
    `grade: ${item.grade || ""}`,
    `grade_label: ${item.grade_label || item["推荐等级"] || ""}`,
    `final_grade: ${item.final_grade || ""}`,
    `effective_grade: ${resolveGradeName(item)}`,
  ].filter(Boolean).join("\n"));
}

export async function buildCreateItemRequest(item = {}) {
  const fields = {
    title: safeZoteroString(item.title),
    shortTitle: safeZoteroString(item.shortTitle || item.title_translation || ""),
    url: safeZoteroString(item.url),
    DOI: safeZoteroString(item.doi),
    date: safeZoteroString(item.pubdate),
    publicationTitle: cleanJournalName(item.journal) || await inferJournalFromUrl(item.url, item.feed_url),
    abstractNote: safeZoteroString(item.abstract),
    extra: buildZoteroExtra(item),
  };
  const runId = safeZoteroString(process.env.review_results_RUN_ID || "");
  const tags = ["research-os", "自动入库", runId ? `run:${runId}` : "", resolveGradeName(item), item.source_channel || ""]
    .filter((tag) => String(tag || "").trim())
    .map((tag) => ({ tag }));
  // Build collections array: key strings only (CLI import expects plain keys)
  const collections = [];
  if (item._target_collections) {
    for (const coll of item._target_collections) {
      const key = typeof coll === "string" ? coll : coll?.key;
      if (key) collections.push(key);
    }
  }

  return {
    action: "create",
    itemType: "journalArticle",
    fields,
    tags,
    collections,
  };
}
