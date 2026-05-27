import { resolveCachedTranslation } from "./title_translation_support.mjs";

export function buildFinalExportPayload({
  writebackReady = [],
  writebackSummary = {},
  backfillReport = {},
  reportContext = {},
  translationCache = null,
} = {}) {
  const successfulWritebackItems = Array.isArray(writebackSummary?.writeback_items) ? writebackSummary.writeback_items : [];
  const summaryKey = (item) => [item.title || "", item.source_channel || "", item.grade || item["推荐等级"] || ""].join("||");
  const itemKeyByStage1Key = new Map(
    successfulWritebackItems.map((item) => [
      [item.title || "", item.source_channel || "", item.grade || item.grade_label || ""].join("||"),
      item.itemKey,
    ]),
  );
  const translatedByKey = new Map(
    (backfillReport.updated_items || []).map((item) => [item.itemKey, item.shortTitle]),
  );

  const baseItems = successfulWritebackItems.length ? successfulWritebackItems : writebackReady;
  const triaged = baseItems.map((item) => {
    const itemKey = item.itemKey || itemKeyByStage1Key.get(summaryKey(item));
    const cacheTranslation = resolveCachedTranslation(translationCache, item.title);
    const translatedTitle = translatedByKey.get(itemKey) || cacheTranslation || item["标题翻译"] || item["中文标题"] || item.title || "";
    return {
      ...item,
      itemKey,
      标题翻译: translatedTitle,
      中文标题: translatedTitle,
      写回状态: itemKey ? "已写回" : "待核对",
    };
  });

  return {
    triaged,
    reportContext: {
      ...reportContext,
      translation: {
        failed_count: backfillReport.failure_count || 0,
        failed_samples: backfillReport.failures || [],
        stage: "completed_after_writeback",
        ...(reportContext.translation || {}),
      },
    },
  };
}
