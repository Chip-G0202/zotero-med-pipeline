import { resolveCachedTranslation } from "./title_translation_support.mjs";

export function buildFinalExportPayload({
  writebackReady = [],
  writebackSummary = {},
  backfillReport = {},
  reportContext = {},
  translationCache = null,
  allAbcItems = [],
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
  const writebackItemKeys = new Set(successfulWritebackItems.map((it) => it.itemKey).filter(Boolean));

  // Prefer allAbcItems for daily review (full ABC set); fall back to writeback-ready subset.
  // Avoid collapsing export candidates into successfulWritebackItems to prevent under-exporting.
  const baseItems = (allAbcItems.length ? allAbcItems : writebackReady).filter((item) => {
    const grade = String(item?.grade || item?.final_grade || item?.rule_grade || item?.["推荐等级"] || "");
    return grade && grade !== "D" && grade !== "D无关";
  });
  const triaged = baseItems.map((item) => {
    const itemKey = item.itemKey || itemKeyByStage1Key.get(summaryKey(item));
    const cacheTranslation = resolveCachedTranslation(translationCache, item.title);
    const translatedTitle = translatedByKey.get(itemKey) || cacheTranslation || item["标题翻译"] || item["中文标题"] || item.title || "";
    const wasWrittenBack = itemKey ? writebackItemKeys.has(itemKey) : false;
    return {
      ...item,
      itemKey,
      标题翻译: translatedTitle,
      中文标题: translatedTitle,
      写回状态: wasWrittenBack ? "已写回" : (itemKey ? "待核对" : "未写回"),
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
