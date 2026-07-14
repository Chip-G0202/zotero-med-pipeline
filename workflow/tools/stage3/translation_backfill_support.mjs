import { buildTranslationBackfillInput } from "../lib/pipeline_stage_support.mjs";
import { generateLiteratureTitleTranslations } from "../lib/title_translation_generation.mjs";

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

export function buildBackfillDowngradeRecommendation({
  originalConcurrency = null,
  recommendedConcurrency = null,
  reason = "",
  report = {},
  downgradeAtBatch = null,
} = {}) {
  return {
    original_concurrency: originalConcurrency,
    recommended_concurrency: recommendedConcurrency,
    reason,
    downgrade_at_batch: downgradeAtBatch,
    failure_count: Number(report?.failure_count || 0),
    total: Number(report?.total || 0),
    metadata_retries_used: Number(report?.writeback?.metadata_retries_used || 0),
    applied: false,
  };
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

function toCount(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

function toPositiveCount(value, fallback = 0) {
  const count = toCount(value, -1);
  return count > 0 ? count : fallback;
}

function classifyBackfillFailure(reason) {
  const text = String(reason || "").toLowerCase();
  if (!text) return "unknown";
  if (text.includes("missing_api_key")) return "missing_api_key";
  if (text.includes("write_metadata_failed")) return "write_metadata_failed";
  if (text.includes("collection_scope_blocked")) return "collection_scope_blocked";
  if (/http[_ -]?429|\b429\b|rate.?limit/.test(text)) return "http_429";
  if (/http[_ -]?5\d\d|\b5\d\d\b/.test(text)) return "http_5xx";
  if (/timeout|abort/.test(text)) return "timeout";
  if (text.includes("missing_from_batch")) return "missing_from_batch";
  if (text.includes("empty_translation")) return "empty_translation";
  if (text.includes("translation_failed")) return "translation_failed";
  return "unknown";
}

function isWritebackFailure(reason) {
  const category = classifyBackfillFailure(reason);
  return category === "write_metadata_failed" || category === "collection_scope_blocked";
}

export function buildStage3TranslationSummary({
  report = {},
  translationConfig = {},
  poolScan = {},
  dryRunBlocked = "unknown",
} = {}) {
  const usage = report?.usage || {};
  const failures = Array.isArray(report?.failures) ? report.failures : [];
  const failureReasons = [...new Set(failures.map((failure) => classifyBackfillFailure(failure?.reason)))];
  const apiKeyPresent = typeof translationConfig?.apiKeyConfigured === "boolean"
    ? translationConfig.apiKeyConfigured
    : "unknown";
  const total = toCount(report?.total);
  const cacheHits = toCount(usage.cache_hits ?? report?.cache_hits);
  const cacheMisses = toCount(usage.cache_misses ?? report?.cache_misses);
  const requestTimingCount = toCount(usage?.request_timing?.total_requests, -1);
  const apiAttempted = apiKeyPresent === false
    ? 0
    : toPositiveCount(
        usage.api_calls,
        requestTimingCount >= 0 ? requestTimingCount : cacheMisses,
      );
  const writebackFailureCount = failures.filter((failure) => isWritebackFailure(failure?.reason)).length;
  const translationFailureCount = apiKeyPresent === false
    ? 0
    : failures.filter((failure) => !isWritebackFailure(failure?.reason)).length;
  const apiSucceeded = toPositiveCount(
    usage.api_items,
    Math.max(0, apiAttempted - translationFailureCount),
  );
  const zoteroSucceeded = toCount(report?.success_count);
  const zoteroFailed = writebackFailureCount;
  const zoteroAttempted = zoteroSucceeded + zoteroFailed;
  const poolScanStats = poolScan?.scanStats || {};
  const poolScanCandidates = Array.isArray(poolScan?.candidates) ? poolScan.candidates.length : 0;

  let skippedReason = "";
  if (dryRunBlocked === true) {
    skippedReason = "dry_run";
  } else if (total === 0) {
    skippedReason = "no_items";
  } else if (apiKeyPresent === false && cacheMisses > 0) {
    skippedReason = "missing_api_key";
  } else if (cacheHits > 0 && cacheMisses === 0 && apiAttempted === 0) {
    skippedReason = "all_cache_hits";
  }

  return {
    enabled: true,
    configured: apiKeyPresent === "unknown" ? "unknown" : apiKeyPresent,
    api_key_present: apiKeyPresent,
    triggered: apiAttempted > 0,
    items_scanned_count: total,
    items_considered_count: total,
    cache_hits_count: cacheHits,
    cache_misses_count: cacheMisses,
    api_translation_attempted_count: apiAttempted,
    api_translation_succeeded_count: apiSucceeded,
    api_translation_failed_count: translationFailureCount,
    cache_writes_count: Math.max(0, Math.min(cacheMisses, apiSucceeded)),
    zotero_updates_attempted_count: zoteroAttempted,
    zotero_updates_succeeded_count: zoteroSucceeded,
    zotero_updates_failed_count: zoteroFailed,
    pool_scan_performed: poolScanStats.scan_disabled === true ? false : poolScanCandidates > 0 || toCount(poolScanStats.items_scanned) > 0,
    pool_scan_items_count: toCount(poolScanStats.items_scanned),
    pool_scan_candidates_count: poolScanCandidates,
    skipped_reason: skippedReason,
    failure_reasons: failureReasons,
    degraded: toCount(report?.failure_count) > 0,
    dry_run_blocked: dryRunBlocked,
  };
}

export async function backfillShortTitles(summary, {
  translateOne,
  translateTitlesBatch,
  writeMetadata,
  writeMetadataBatch = null,
  metadataConcurrency = 1,
  metadataRetry = 4,
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

  const translationRequestStarted = Date.now();
  const generated = await generateLiteratureTitleTranslations(items, {
    cachePath,
    translateTitlesBatchImpl: translateTitlesBatch || (async (titles) => ({
      map: new Map(await Promise.all(titles.map(async (title) => [title, await translateOne(title)]))),
      usage: null,
    })),
  });
  const translatedResult = {
    map: new Map(generated.items.map((item) => [item.title, item.translatedTitle
      ? { ok: true, zh: item.translatedTitle }
      : { ok: false, zh: item.title, reason: generated.failures.find((failure) => failure.title === item.title)?.reason || "translation_failed" }])),
    usage: generated.usage,
  };
  const translationRequestMs = Date.now() - translationRequestStarted;
  const translatedMap = translatedResult?.map || null;
  report.usage = translatedResult?.usage || null;
  if (report.usage) {
    report.cache_hits = report.usage.cache_hits;
    report.cache_misses = report.usage.cache_misses;
  }

  const concurrency = Math.min(metadataConcurrencyMax, Math.max(1, Number(metadataConcurrency || 1)));
  let metadataRetriesUsed = 0;
  let metadataWriteMs = 0;
  const mcpErrors = [];
  const batchObservations = [];

  if (typeof writeMetadataBatch === "function" && translatedMap) {
    const metadataWriteStarted = Date.now();
    const updates = [];
    for (const item of items) {
      const translated = translatedMap.get(item.title) || { ok: false, zh: item.title, reason: "missing_from_batch" };
      if (!translated?.ok || !String(translated.zh || "").trim()) {
        report.failure_count++;
        if (report.failures.length < 100) {
          report.failures.push({
            itemKey: item.itemKey,
            title: item.title,
            reason: translated?.reason || "translation_failed",
          });
        }
        continue;
      }
      updates.push({ item, itemKey: item.itemKey, fields: { shortTitle: String(translated.zh).trim() } });
    }
    try {
      const writeResult = await writeMetadataBatch(updates.map(({ itemKey, fields }) => ({ itemKey, fields })));
      const failed = new Map((writeResult?.write_failures || []).map((failure) => [failure.itemKey, failure]));
      const successKeys = new Set(updates.map((update) => update.itemKey));
      for (const failure of failed.values()) successKeys.delete(failure.itemKey);
      for (const update of updates) {
        if (!successKeys.has(update.itemKey)) continue;
        report.success_count++;
        report.updated_items.push({
          itemKey: update.itemKey,
          title: update.item.title,
          shortTitle: update.fields.shortTitle,
          grade: update.item.grade,
          version: Number(writeResult?.versions?.[update.itemKey] || 0) || undefined,
        });
      }
      for (const failure of failed.values()) {
        mcpErrors.push(String(failure.error || "write_metadata_failed"));
        report.failure_count++;
        if (report.failures.length < 100) {
          const item = updates.find((update) => update.itemKey === failure.itemKey)?.item || {};
          report.failures.push({
            itemKey: failure.itemKey,
            title: item.title || "",
            reason: String(failure.error || "write_metadata_failed"),
          });
        }
      }
    } catch (error) {
      const writeResult = error?.result || null;
      const failures = Array.isArray(writeResult?.write_failures) && writeResult.write_failures.length
        ? writeResult.write_failures
        : updates.map((update) => ({ itemKey: update.itemKey, error: error?.message || "write_metadata_failed" }));
      for (const failure of failures) {
        mcpErrors.push(String(failure.error || error?.message || "write_metadata_failed"));
        report.failure_count++;
        if (report.failures.length < 100) {
          const item = updates.find((update) => update.itemKey === failure.itemKey)?.item || {};
          report.failures.push({
            itemKey: failure.itemKey,
            title: item.title || "",
            reason: String(failure.error || error?.message || "write_metadata_failed"),
          });
        }
      }
      const failedKeys = new Set(failures.map((failure) => failure.itemKey));
      for (const update of updates) {
        if (failedKeys.has(update.itemKey)) continue;
        report.success_count++;
        report.updated_items.push({
          itemKey: update.itemKey,
          title: update.item.title,
          shortTitle: update.fields.shortTitle,
          grade: update.item.grade,
        });
      }
    }
    metadataWriteMs += Date.now() - metadataWriteStarted;
    report.timings = {
      translation_ms: Date.now() - startedAt,
      total_ms: Date.now() - startedAt,
      translation_request_ms: translationRequestMs,
      metadata_write_ms: metadataWriteMs,
    };
    report.writeback = {
      metadata_concurrency: concurrency,
      metadata_retry_limit: metadataRetry,
      metadata_retries_used: metadataRetriesUsed,
      metadata_batch_update_calls: updates.length ? 1 : 0,
      metadata_batch_update_count: updates.length,
    };
    report.mcp_errors = mcpErrors.slice(0, 200);
    report.observation = observationMode ? batchObservations : [];
    return report;
  }

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
        const metadataWriteStarted = Date.now();
        try {
          await writeMetadata(item.itemKey, { shortTitle });
          metadataWriteMs += Date.now() - metadataWriteStarted;
          updated = true;
          break;
        } catch (error) {
          metadataWriteMs += Date.now() - metadataWriteStarted;
          if (attempt >= metadataRetry) throw error;
          metadataRetriesUsed += 1;
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
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
    total_ms: Date.now() - startedAt,
    translation_request_ms: translationRequestMs,
    metadata_write_ms: metadataWriteMs,
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
