import { LABELS } from "./grade_primitives.mjs";
import { resolveCachedTranslation } from "./title_translation_support.mjs";

/**
 * Deterministic normalization for correlation key components.
 * Only trims and collapses whitespace; no fuzzy matching, no AI.
 */
function normKeyComponent(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Build the deterministic correlation key used to associate a Stage 1 candidate
 * with a Stage 2 writeback item.
 *
 * Contract (must stay in sync with finalize_exports_support.mjs summaryKey):
 *   key = title || "" + "||" + source_channel || "" + "||" + grade || ""
 *
 * grade resolves through: item.grade → item.grade_label → item["推荐等级"]
 *
 * @param {object} item
 * @returns {string}
 */
export function buildStage1WritebackCorrelationKey(item) {
  const title = normKeyComponent(item?.title);
  const sourceChannel = normKeyComponent(item?.source_channel);
  const grade = normKeyComponent(
    item?.grade ?? item?.grade_label ?? item?.["推荐等级"],
  );
  return `${title}||${sourceChannel}||${grade}`;
}

export function buildWritebackReadyItems(triagedItems, { translationCache = null } = {}) {
  return (triagedItems || [])
    .filter((item) => item && item.grade && item.grade !== "D" && item.pre_llm_skip_writeback !== true)
    .map((item) => ({
      ...item,
      推荐等级: item.final_grade || item.grade_label || item["推荐等级"] || LABELS[item.grade] || "",
      推荐理由: item.grade_reason || item["推荐理由"] || "",
      标题翻译: resolveCachedTranslation(translationCache, item.title) || String(item["标题翻译"] || "").trim(),
      中文标题: resolveCachedTranslation(translationCache, item.title) || String(item["中文标题"] || item.title || "").trim() || String(item.title || "").trim(),
      backfill_short_title: true,
    }));
}

export function buildWritebackReadyArtifact(triagedItems, {
  translationCache = null,
  exportLimit = null,
} = {}) {
  const rawItems = buildWritebackReadyItems(triagedItems, { translationCache });
  const limit = Number(exportLimit || 0);
  const items = limit > 0 ? rawItems.slice(0, limit) : rawItems;
  return {
    items,
    summary: {
      input_count: Array.isArray(triagedItems) ? triagedItems.length : 0,
      item_count_before_export_limit: rawItems.length,
      item_count: items.length,
      excluded_count: Math.max(0, (Array.isArray(triagedItems) ? triagedItems.length : 0) - rawItems.length),
      export_limit: limit > 0 ? limit : null,
    },
  };
}

export function buildTranslationBackfillInput(summary) {
  return (summary?.writeback_items || [])
    .filter((item) => item && item.itemKey && item.backfill_short_title === true && item.grade && item.grade !== "D")
    .map((item) => ({
      itemKey: item.itemKey,
      title: item.title || "",
      中文标题: item["中文标题"] || item.title || "",
      grade: item.grade,
      source_channel: item.source_channel || "",
    }));
}

/**
 * Filter desktop daily review source to only include items actually written
 * back by Stage 2, using title + source_channel + grade correlation keys.
 *
 * Stage 1 candidates do NOT carry itemKey (Zotero assigns it during writeback).
 * Matching relies solely on the deterministic correlation key.
 * On match, the writeback item's itemKey is backfilled onto the output item.
 *
 * @param {object} desktopSource - The desktop_daily_review_source.json object
 *   (must have triaged array). Items are expected to be Stage 1 output with
 *   title, source_channel, and grade fields but without itemKey.
 * @param {object} writebackSummary - The zotero_writeback_summary.json object
 * @returns {{
 *   source: object,
 *   status: string,
 *   warning: string,
 *   candidateCount: number,
 *   writebackItemCount: number,
 *   keptCount: number,
 *   unmatchedCandidateCount: number,
 *   unmatchedWritebackCount: number,
 *   ambiguousCandidateKeyCount: number,
 *   ambiguousWritebackKeyCount: number,
 * }}
 */
export function filterDesktopReviewSourceByWritebackSummary(desktopSource, writebackSummary) {
  if (!desktopSource || !Array.isArray(desktopSource.triaged)) {
    return {
      source: desktopSource || { triaged: [] },
      status: "invalid_desktop_source",
      warning: "desktop_daily_review_source.json missing or has no triaged array",
      candidateCount: 0,
      writebackItemCount: 0,
      keptCount: 0,
      unmatchedCandidateCount: 0,
      unmatchedWritebackCount: 0,
      ambiguousCandidateKeyCount: 0,
      ambiguousWritebackKeyCount: 0,
    };
  }

  const candidates = desktopSource.triaged;

  if (!writebackSummary || typeof writebackSummary !== "object") {
    return {
      source: { ...desktopSource, triaged: [] },
      status: "degraded_missing_writeback_summary",
      warning: "writeback summary missing; refusing to export full candidate pool as daily review source",
      candidateCount: candidates.length,
      writebackItemCount: 0,
      keptCount: 0,
      unmatchedCandidateCount: candidates.length,
      unmatchedWritebackCount: 0,
      ambiguousCandidateKeyCount: 0,
      ambiguousWritebackKeyCount: 0,
    };
  }

  const writebackItems = Array.isArray(writebackSummary.writeback_items)
    ? writebackSummary.writeback_items
    : null;
  if (!writebackItems) {
    return {
      source: { ...desktopSource, triaged: [] },
      status: "degraded_writeback_items_missing",
      warning: "writeback_items missing from writeback summary; refusing to export full candidate pool",
      candidateCount: candidates.length,
      writebackItemCount: 0,
      keptCount: 0,
      unmatchedCandidateCount: candidates.length,
      unmatchedWritebackCount: 0,
      ambiguousCandidateKeyCount: 0,
      ambiguousWritebackKeyCount: 0,
    };
  }

  if (writebackItems.length === 0) {
    return {
      source: { ...desktopSource, triaged: [] },
      status: "no_new_writeback_items",
      warning: "writeback_items is empty; no items were written to Zotero this run",
      candidateCount: candidates.length,
      writebackItemCount: 0,
      keptCount: 0,
      unmatchedCandidateCount: candidates.length,
      unmatchedWritebackCount: 0,
      ambiguousCandidateKeyCount: 0,
      ambiguousWritebackKeyCount: 0,
    };
  }

  // ── Build writeback key → item map, detect ambiguous keys ──
  const wbKeyToItem = new Map();
  const wbAmbiguousKeys = new Set();
  for (const wbItem of writebackItems) {
    const key = buildStage1WritebackCorrelationKey(wbItem);
    if (!key || key === "||") continue; // skip items with no usable fields
    if (wbKeyToItem.has(key)) {
      wbAmbiguousKeys.add(key);
    } else {
      wbKeyToItem.set(key, wbItem);
    }
  }
  // Remove ambiguous keys from the matchable map
  for (const key of wbAmbiguousKeys) {
    wbKeyToItem.delete(key);
  }

  // ── Build candidate key → indices map, detect ambiguous keys ──
  const candKeyToIndices = new Map();
  const candAmbiguousKeys = new Set();
  for (let i = 0; i < candidates.length; i++) {
    const key = buildStage1WritebackCorrelationKey(candidates[i]);
    if (!key || key === "||") continue;
    if (candKeyToIndices.has(key)) {
      candAmbiguousKeys.add(key);
      candKeyToIndices.get(key).push(i);
    } else {
      candKeyToIndices.set(key, [i]);
    }
  }

  // ── Match: only unambiguous keys on both sides ──
  const kept = [];
  const matchedCandidateIndices = new Set();
  for (const [key, indices] of candKeyToIndices.entries()) {
    if (candAmbiguousKeys.has(key)) continue; // skip ambiguous candidates
    if (wbAmbiguousKeys.has(key)) continue;   // skip ambiguous writeback
    const wbItem = wbKeyToItem.get(key);
    if (!wbItem) continue;
    for (const idx of indices) {
      matchedCandidateIndices.add(idx);
      kept.push({
        ...candidates[idx],
        itemKey: wbItem.itemKey,
        写回状态: "已写回",
      });
    }
  }

  return {
    source: { ...desktopSource, triaged: kept },
    status: "ok",
    warning: kept.length === 0 ? "all_candidates_filtered_out_none_matched_writeback_items" : "",
    candidateCount: candidates.length,
    writebackItemCount: writebackItems.length,
    keptCount: kept.length,
    unmatchedCandidateCount: candidates.length - matchedCandidateIndices.size,
    unmatchedWritebackCount: writebackItems.length - [...wbKeyToItem.keys()].filter((k) => candKeyToIndices.has(k) && !candAmbiguousKeys.has(k)).length,
    ambiguousCandidateKeyCount: candAmbiguousKeys.size,
    ambiguousWritebackKeyCount: wbAmbiguousKeys.size,
  };
}
