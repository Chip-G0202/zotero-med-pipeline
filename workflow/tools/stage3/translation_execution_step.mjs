import { getTranslationConfig, translateOne, translateTitlesBatch } from "../lib/title_translation_support.mjs";
import {
  backfillShortTitles,
  buildBackfillDowngradeRecommendation,
  buildStage3TranslationSummary,
  nextBackfillDowngrade,
  resolveBackfillConcurrency,
  shouldStopBackfillByRisk,
} from "./translation_backfill_support.mjs";

export async function runStage3TranslationExecution({
  summaryForRun,
  poolScan,
  translationCachePath,
  writeMetadata,
  writeMetadataBatch,
} = {}) {
  const translationConfig = getTranslationConfig();
  const concurrencyRaw = process.env.ZOTERO_TRANSLATION_BACKFILL_CONCURRENCY;
  const configuredConcurrency = Number(concurrencyRaw || 10);
  const metadataConcurrencyMax = 256;
  const resolvedConcurrency = resolveBackfillConcurrency(concurrencyRaw);
  const baseConcurrency = resolvedConcurrency.value;
  const concurrencyWarning = resolvedConcurrency.warning;
  const concurrencyClamped = resolvedConcurrency.clamped;
  const observationMode = process.env.ZOTERO_TRANSLATION_BACKFILL_OBSERVATION_MODE === "1";
  const source = (concurrencyRaw === undefined || String(concurrencyRaw).trim() === "") ? "default" : "env";
  let currentConcurrency = baseConcurrency;
  const previousRetryCount = 0;
  let downgradeAudit = null;
  let report = null;

  while (true) {
    report = await backfillShortTitles(summaryForRun, {
      translateOne,
      translateTitlesBatch,
      cachePath: translationCachePath,
      metadataConcurrency: currentConcurrency,
      metadataConcurrencyMax,
      observationMode,
      writeMetadata,
      writeMetadataBatch,
    });
    const failureRate = report.total ? report.failure_count / report.total : 0;
    const risk = shouldStopBackfillByRisk({
      failureRate,
      shortTitleMismatchCount: Number(report.shortTitle_mismatch_count || 0),
      mcpErrors: report.mcp_errors || [],
      retryCount: Number(report?.writeback?.metadata_retries_used || 0),
      previousRetryCount,
    });
    if (risk.stop) {
      throw new Error(`backfill_high_risk_stop:${risk.reason}`);
    }
    if (!risk.downgrade || currentConcurrency <= 1) break;
    const downgraded = nextBackfillDowngrade(currentConcurrency);
    if (downgraded >= currentConcurrency) break;
    downgradeAudit = buildBackfillDowngradeRecommendation({
      originalConcurrency: baseConcurrency,
      recommendedConcurrency: downgraded,
      reason: risk.reason,
      report,
      downgradeAtBatch: 1,
    });
    break;
  }

  return {
    report,
    translationConfig,
    translationSummary: buildStage3TranslationSummary({
      report,
      translationConfig,
      poolScan,
      dryRunBlocked: false,
    }),
    concurrency: {
      configuredConcurrency,
      currentConcurrency,
      concurrencyWarning,
      concurrencyClamped,
      source,
    },
    downgradeAudit,
  };
}
