import { LABELS } from "./triage_policy.mjs";
import { resolveCachedTranslation } from "./title_translation_support.mjs";

export function buildWritebackReadyItems(triagedItems, { translationCache = null } = {}) {
  return (triagedItems || [])
    .filter((item) => item && item.grade && item.grade !== "D")
    .map((item) => ({
      ...item,
      推荐等级: item.grade_label || item["推荐等级"] || LABELS[item.grade] || "",
      推荐理由: item.grade_reason || item["推荐理由"] || "",
      标题翻译: resolveCachedTranslation(translationCache, item.title) || String(item["标题翻译"] || "").trim(),
      中文标题: resolveCachedTranslation(translationCache, item.title) || String(item["中文标题"] || item.title || "").trim() || String(item.title || "").trim(),
      backfill_short_title: true,
    }));
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
