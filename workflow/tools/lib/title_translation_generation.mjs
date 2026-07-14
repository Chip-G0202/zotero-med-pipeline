import { DEFAULT_CACHE_PATH, translateTitlesBatch } from "./title_translation_support.mjs";

export function existingTranslatedTitle(item = {}) {
  return String(item.translatedTitle || item["标题翻译"] || item["中文标题"] || item.shortTitle || "").trim();
}

export async function generateLiteratureTitleTranslations(items = [], {
  cachePath = DEFAULT_CACHE_PATH,
  translateTitlesBatchImpl = translateTitlesBatch,
} = {}) {
  const source = Array.isArray(items) ? items : [];
  const missingTitles = source
    .filter((item) => !existingTranslatedTitle(item))
    .map((item) => String(item?.title || "").trim())
    .filter(Boolean);
  const translated = missingTitles.length
    ? await translateTitlesBatchImpl(missingTitles, undefined, { cachePath })
    : { map: new Map(), usage: { total_items: 0, cache_hits: 0, cache_misses: 0, api_calls: 0 } };
  const failures = [];
  let generatedCount = 0;
  const enriched = source.map((item) => {
    const existing = existingTranslatedTitle(item);
    if (existing) return { ...item, translatedTitle: existing };
    const title = String(item?.title || "").trim();
    const result = translated?.map?.get(title);
    const value = result?.ok ? String(result.zh || "").trim() : "";
    if (!value) {
      if (title) failures.push({ title, reason: result?.reason || "translation_failed" });
      return { ...item };
    }
    generatedCount += 1;
    return { ...item, translatedTitle: value };
  });
  return { items: enriched, usage: translated?.usage || null, generated_count: generatedCount, failures };
}
