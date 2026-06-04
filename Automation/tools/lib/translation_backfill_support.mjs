import { buildTranslationBackfillInput } from "./pipeline_stage_support.mjs";

export const DEFAULT_BACKFILL_DAILY_CONCURRENCY = 10;

export function resolveBackfillConcurrency(rawValue, defaultConcurrency = DEFAULT_BACKFILL_DAILY_CONCURRENCY) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return { value: defaultConcurrency, clamped: false, warning: "" };
  }
  const n = Number(rawValue);
  if (!Number.isFinite(n) || n < 1) {
    return { value: defaultConcurrency, clamped: true, warning: "invalid_backfill_concurrency_fallback_to_default" };
  }
  const value = Math.max(1, Math.floor(n));
  const warning = value > 10 ? "backfill_concurrency_gt_10_high_risk_client_stability" : "";
  return { value, clamped: value !== n, warning };
}

export function nextBackfillDowngrade(current) {
  const c = Number(current || 1);
  if (c > 128) return 128;
  if (c > 96) return 96;
  if (c > 80) return 80;
  if (c > 64) return 64;
  if (c > 48) return 48;
  if (c > 32) return 32;
  if (c > 24) return 24;
  if (c > 16) return 16;
  if (c > 10) return 10;
  if (c > 8) return 8;
  if (c > 4) return 4;
  if (c > 1) return 1;
  return 1;
}

export function shouldStopBackfillByRisk({
  failureRate = 0,
  shortTitleMismatchCount = 0,
  mcpErrors = [],
  retryCount = 0,
  previousRetryCount = 0,
}) {
  if (shortTitleMismatchCount > 0) {
    return { stop: true, downgrade: false, reason: "shortTitle_mismatch" };
  }
  if (failureRate > 0.05) {
    return { stop: false, downgrade: true, reason: "failure_rate_gt_5pct" };
  }
  const joined = (mcpErrors || []).join(" | ").toLowerCase();
  if (/(timeout|lock conflict|write_metadata_failed|429|rate limit)/i.test(joined)) {
    return { stop: false, downgrade: true, reason: "mcp_runtime_error" };
  }
  if (retryCount > previousRetryCount * 2 + 2) {
    return { stop: false, downgrade: true, reason: "retry_spike" };
  }
  return { stop: false, downgrade: false, reason: "" };
}

export async function backfillShortTitles(summary, {
  translateOne,
  translateTitlesBatch,
  writeMetadata,
  metadataConcurrency = 1,
  metadataRetry = 2,
  metadataConcurrencyMax = 256,
  observationMode = false,
  cachePath,
}) {
  const startedAt = Date.now();
  const items = buildTranslationBackfillInput(summary);
  const report = {
    total: items.length,
    success_count: 0,
    failure_count: 0,
    skipped_count: 0,
    failures: [],
    updated_items: [],
    usage: null,
    cache_hits: null,
    cache_misses: null,
  };

  const translatedResult = translateTitlesBatch
    ? await translateTitlesBatch(items.map((item) => item.title), undefined, { cachePath })
    : null;
  const translatedMap = translatedResult?.map || null;
  report.usage = translatedResult?.usage || null;
  if (report.usage) {
    report.cache_hits = report.usage.cache_hits;
    report.cache_misses = report.usage.cache_misses;
  }

  const concurrency = Math.min(metadataConcurrencyMax, Math.max(1, Number(metadataConcurrency || 1)));
  let metadataRetriesUsed = 0;
  const mcpErrors = [];
  const batchObservations = [];

  async function processOne(item) {
    try {
      const translated = translatedMap
        ? (translatedMap.get(item.title) || { ok: false, zh: item.title, reason: "missing_from_batch" })
        : await translateOne(item.title);
      if (!translated?.ok || !String(translated.zh || "").trim()) {
        report.failure_count++;
        if (report.failures.length < 100) {
          report.failures.push({
            itemKey: item.itemKey,
            title: item.title,
            reason: translated?.reason || "translation_failed",
          });
        }
        return;
      }

      const shortTitle = String(translated.zh).trim();
      let updated = false;
      for (let attempt = 0; attempt <= metadataRetry; attempt++) {
        try {
          await writeMetadata(item.itemKey, { shortTitle });
          updated = true;
          break;
        } catch (error) {
          if (attempt >= metadataRetry) throw error;
          metadataRetriesUsed += 1;
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
      if (!updated) throw new Error("write_metadata_failed");
      report.success_count++;
      report.updated_items.push({
        itemKey: item.itemKey,
        title: item.title,
        shortTitle,
        grade: item.grade,
      });
    } catch (error) {
      mcpErrors.push(String(error?.message || error));
      report.failure_count++;
      if (report.failures.length < 100) {
        report.failures.push({
          itemKey: item.itemKey,
          title: item.title,
          reason: String(error?.message || error),
        });
      }
    }
  }
  const batchSize = Math.max(1, Number(process.env.ZOTERO_TRANSLATION_BACKFILL_OBSERVATION_BATCH_SIZE || 20));
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize);
    const batchStarted = Date.now();
    const beforeSuccess = report.success_count;
    const beforeFailure = report.failure_count;
    const beforeRetries = metadataRetriesUsed;
    if (concurrency === 1) {
      for (const item of batch) {
        await processOne(item);
      }
    } else {
      const workers = Array.from({ length: concurrency }).map(async (_, workerIndex) => {
        for (let i = workerIndex; i < batch.length; i += concurrency) {
          await processOne(batch[i]);
        }
      });
      await Promise.all(workers);
    }
    if (observationMode) {
      batchObservations.push({
        batch_index: Math.floor(offset / batchSize) + 1,
        batch_size: batch.length,
        per_batch_duration: Date.now() - batchStarted,
        per_batch_success_count: report.success_count - beforeSuccess,
        per_batch_failure_count: report.failure_count - beforeFailure,
        per_batch_retry_count: metadataRetriesUsed - beforeRetries,
        per_batch_avg_ms_per_item: batch.length ? (Date.now() - batchStarted) / batch.length : 0,
      });
    }
  }

  // Retry pass: re-attempt items that failed due to 429 rate limit or transient errors
  const rateLimitFailures = report.failures.filter((f) =>
    /429|rate.?limit|HTTP_429/i.test(String(f.reason || ""))
  );
  if (rateLimitFailures.length > 0) {
    const retryDelayMs = 10000;
    console.error(`[translation_backfill] retry pass: ${rateLimitFailures.length} items failed due to 429, waiting ${retryDelayMs}ms before retry`);
    await new Promise((r) => setTimeout(r, retryDelayMs));
    // Reset failures list for retry tracking
    const retryItems = rateLimitFailures.map((f) => ({
      itemKey: f.itemKey,
      title: f.title,
      grade: items.find((it) => it.itemKey === f.itemKey)?.grade || "C",
      source_channel: "retry",
    }));
    // Remove old failures that will be retried
    report.failure_count -= rateLimitFailures.length;
    report.failures = report.failures.filter((f) => !rateLimitFailures.some((rf) => rf.itemKey === f.itemKey));

    const retryConcurrency = Math.max(1, Math.floor(concurrency / 2));
    const retryWorkers = Array.from({ length: retryConcurrency }).map(async (_, wi) => {
      for (let i = wi; i < retryItems.length; i += retryConcurrency) {
        await processOne(retryItems[i]);
      }
    });
    await Promise.all(retryWorkers);
    const retriedSuccess = retryItems.filter((r) => report.updated_items.some((u) => u.itemKey === r.itemKey)).length;
    console.error(`[translation_backfill] retry pass result: ${retriedSuccess}/${retryItems.length} recovered`);
  }

  report.timings = {
    translation_ms: Date.now() - startedAt,
  };
  report.writeback = {
    metadata_concurrency: concurrency,
    metadata_retry_limit: metadataRetry,
    metadata_retries_used: metadataRetriesUsed,
  };
  report.mcp_errors = mcpErrors.slice(0, 200);
  report.observation = observationMode ? batchObservations : [];
  return report;
}
