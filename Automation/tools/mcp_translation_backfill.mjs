import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import "./lib/env_file_bootstrap.mjs";
import { getTranslationConfig, translateOne, translateTitlesBatch } from "./lib/title_translation_support.mjs";
import {
  backfillShortTitles,
  nextBackfillDowngrade,
  resolveBackfillConcurrency,
  shouldStopBackfillByRisk,
} from "./lib/translation_backfill_support.mjs";
import { ensureZoteroMcpReady } from "./lib/ensure_zotero_mcp_ready.mjs";
import { buildRuntimeConfig } from "./lib/runtime_config.mjs";
import { parseToolText } from "./lib/writeback_support.mjs";
import { summarizeCollectionScopeBlocks } from "./lib/zotero_collection_guard.mjs";

const RUNTIME = buildRuntimeConfig();
const ROOT = RUNTIME.projectRoot;
const RESEARCH_ROOT = RUNTIME.researchRoot;
const MCP_URL = process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp";
const TODAY = RUNTIME.now;
const RUNTIME_STATE_PATH = path.join(RESEARCH_ROOT, "runtime_state.json");

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function yyMd(d) {
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
}
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// Global mutex: serialize all MCP requests to reduce error rate.
// The Zotero MCP plugin's JSON parser rejects raw UTF-8 bytes (returns -32700 "Parse error");
// asciiEscapeJson() below is the primary fix; the mutex is a secondary safeguard.
let _mcpMutexChain = Promise.resolve();

/** Serialize JSON with all non-ASCII characters escaped as \uXXXX.
 *  Zotero MCP's JSON parser intermittently rejects raw UTF-8 (returns -32700 "Parse error"). */
function asciiEscapeJson(obj) {
  return JSON.stringify(obj).replace(/[\u0080-\uFFFF]/g, (ch) =>
    `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

async function mcpToolCall(name, args, id) {
  const result = await new Promise((resolve, reject) => {
    _mcpMutexChain = _mcpMutexChain.then(async () => {
      const maxAttempts = 5;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) await wait(1000 * attempt); // 1s, 2s, 3s, 4s backoff
        try {
          const res = await fetch(MCP_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: asciiEscapeJson({
              jsonrpc: "2.0",
              id,
              method: "tools/call",
              params: { name, arguments: args },
            }),
          });
          const json = await res.json();
          if (!json.error) { resolve(json.result); return; }
          const errMsg = JSON.stringify(json.error);
          const isTransient = /-32700|Parse error|timeout|database busy|lock conflict/i.test(errMsg);
          if (attempt >= maxAttempts - 1 || !isTransient) {
            reject(new Error(`MCP ${name} failed: ${errMsg}`));
            return;
          }
        } catch (err) {
          if (attempt >= maxAttempts - 1) { reject(err); return; }
        }
      }
      reject(new Error(`MCP ${name} failed: exhausted retries`));
    });
  });
  return result;
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureMcpReady() {
  return ensureZoteroMcpReady({
    mcpProbe: async (attempt) => {
      await mcpToolCall("get_collections", { mode: "minimal", limit: 1 }, 970000 + attempt);
    },
  });
}

export function parseDateNameToDate(name) {
  const m = String(name || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const legacy = String(name || "").match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})$/);
  if (legacy) return new Date(2000 + Number(legacy[1]), Number(legacy[2]) - 1, Number(legacy[3]));
  return null;
}

export function parseMonthDayCollectionDate(dayName, parentNames = []) {
  const day = String(dayName || "").match(/^(\d{2})\.(\d{2})$/);
  if (!day) return null;
  for (let i = parentNames.length - 1; i >= 0; i--) {
    const month = String(parentNames[i] || "").match(/^(\d{2})\.(\d{2})$/);
    if (!month) continue;
    return new Date(2000 + Number(month[1]), Number(day[1]) - 1, Number(day[2]));
  }
  return null;
}

function inLastNDays(d, now, days) {
  if (!d) return false;
  const n = Math.max(1, Math.floor(Number(days || 7)));
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d >= start && d <= end;
}

export function collectRecentDateCollectionNodes(tree, now, days) {
  const nodes = [];
  const seen = new Set();
  const visit = (node, parents = []) => {
    if (!node) return;
    const date = parseDateNameToDate(node.name) || parseMonthDayCollectionDate(node.name, parents);
    if (date && inLastNDays(date, now, days) && !seen.has(node.key)) {
      seen.add(node.key);
      nodes.push(node);
    }
    for (const child of node.subcollections || []) {
      visit(child, [...parents, node.name]);
    }
  };
  for (const node of Array.isArray(tree) ? tree : []) {
    visit(node, []);
  }
  return nodes;
}

const GRADE_NAMES = ["A课题相关", "B专题相关", "C领域相关"];

async function collectExistingItemsMissingShortTitle(rootKey, existingKeys, { now = new Date(), windowDays = 14, idBase = 1100000, maxScan = 100 } = {}) {
  const scannedKeys = [];
  const scanStats = { date_collections_scanned: 0, items_scanned: 0, items_missing_shorttitle: 0, errors: 0, scan_limited: false };

  try {
    const tree = parseToolText(await mcpToolCall("get_subcollections", { collectionKey: rootKey, recursive: true }, idBase));
    const dateNodes = collectRecentDateCollectionNodes(tree, now, windowDays);

    for (const node of dateNodes) {
      if (scanStats.items_scanned >= maxScan) break;
      const childMap = new Map((node.subcollections || []).map((c) => [c.name, c]));
      const gradeCollections = GRADE_NAMES.map((name) => childMap.get(name)).filter(Boolean);
      if (!gradeCollections.length) continue;
      scanStats.date_collections_scanned += 1;

      for (const gc of gradeCollections) {
        if (scanStats.items_scanned >= maxScan) break;
        let offset = 0;
        const limit = 200;
        while (true) {
          if (scanStats.items_scanned >= maxScan) break;
          const items = parseToolText(await mcpToolCall("get_collection_items", { collectionKey: gc.key, limit, offset }, idBase + 100 + offset));
          if (!Array.isArray(items) || !items.length) break;

          for (const item of items) {
            if (scanStats.items_scanned >= maxScan) { scanStats.scan_limited = true; break; }
            if (!item?.key || existingKeys.has(item.key)) continue;
            existingKeys.add(item.key);
            scanStats.items_scanned += 1;

            try {
              const detail = parseToolText(await mcpToolCall("get_item_details", { itemKey: item.key, mode: "preview" }, idBase + 200 + scanStats.items_scanned));
              const data = detail?.data || detail || {};
              const shortTitle = String(data.shortTitle || "").trim();
              if (!shortTitle) {
                scanStats.items_missing_shorttitle += 1;
                scannedKeys.push({
                  itemKey: item.key,
                  title: data.title || "",
                  grade: gc.name.replace(/[课题专题领域相关]/g, "").charAt(0) || "C",
                  source_channel: "pool_scan",
                });
              }
            } catch {
              scanStats.errors += 1;
            }
          }
          if (items.length < limit) break;
          offset += limit;
        }
      }
    }
  } catch (e) {
    console.error(`[translation_backfill] pool scan error: ${String(e?.message || e).slice(0, 200)}`);
  }

  return { candidates: scannedKeys, scanStats };
}

async function readRuntimeState() {
  try {
    return JSON.parse(await fs.readFile(RUNTIME_STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function mergeRuntimeState(patch) {
  const current = await readRuntimeState();
  await fs.mkdir(path.dirname(RUNTIME_STATE_PATH), { recursive: true });
  await fs.writeFile(RUNTIME_STATE_PATH, JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
}

function elapsedDaysSince(isoValue, now) {
  if (!isoValue) return Infinity;
  const t = Date.parse(isoValue);
  if (!Number.isFinite(t)) return Infinity;
  return (now.getTime() - t) / 86400000;
}

export async function runMcpTranslationBackfill({ argv = process.argv } = {}) {
  const stageStarted = Date.now();
  await ensureMcpReady();
  const dateStr = fmtDate(TODAY);
  const week = isoWeek(TODAY);
  const day = yyMd(TODAY);
  const pipelineDir = path.join(RESEARCH_ROOT, "pipeline", day);
  const summaryPath = path.join(pipelineDir, "mcp_writeback_summary.json");
  const backfillPath = path.join(pipelineDir, "abc_translation_backfill.json");
  const failuresPath = path.join(pipelineDir, "abc_translation_failures.json");
  const usagePath = path.join(pipelineDir, "translation_usage_report.json");
  const runReportPath = path.join(pipelineDir, "run_report.json");

  const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
  const limitArg = argv.find((x) => x.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : null;
  const offsetArg = argv.find((x) => x.startsWith("--offset="));
  const offset = offsetArg ? Number(offsetArg.split("=")[1]) : 0;
  let summaryForRun = limit
    ? { ...summary, writeback_items: (summary.writeback_items || []).slice(offset, offset + limit) }
    : { ...summary, writeback_items: (summary.writeback_items || []).slice(offset) };

  // Scan 文献池 for existing ABC items with empty shortTitle every two scheduled runs by default.
  // The pipeline runs every 2 days, so the default pool-scan interval/window is 4 days.
  const poolScanOptOut = /^(0|false|no|off)$/i.test(String(process.env.ZOTERO_TRANSLATION_POOL_SCAN_ENABLED ?? "true"));
  const poolScanIntervalDays = Math.max(1, Number(process.env.ZOTERO_TRANSLATION_POOL_SCAN_INTERVAL_DAYS || 4));
  const poolScanWindowDays = Math.max(1, Number(process.env.ZOTERO_TRANSLATION_POOL_SCAN_WINDOW_DAYS || 4));
  const runtimeState = await readRuntimeState();
  const lastPoolScanAt = runtimeState.last_translation_pool_scan_at || null;
  const daysSincePoolScan = elapsedDaysSince(lastPoolScanAt, TODAY);
  const poolScanDue = !poolScanOptOut && daysSincePoolScan >= poolScanIntervalDays;
  const rootKey = summary?.pool_collection_key || summary?.root_collection?.key || "";
  const poolScanEnabled = Boolean(rootKey && poolScanDue);
  const writebackKeys = new Set((summaryForRun.writeback_items || []).map((it) => it.itemKey).filter(Boolean));
  const poolScanSkipReason = poolScanOptOut
    ? "disabled_by_env"
    : !rootKey
      ? "pool_collection_key_missing"
      : !poolScanDue
        ? "interval_not_reached"
        : "";
  const poolScan = poolScanEnabled
    ? await collectExistingItemsMissingShortTitle(rootKey, writebackKeys, {
        now: TODAY,
        windowDays: poolScanWindowDays,
        idBase: 1100000,
        maxScan: Math.max(10, Number(process.env.ZOTERO_TRANSLATION_POOL_SCAN_MAX_ITEMS || 100)),
      })
    : { candidates: [], scanStats: { date_collections_scanned: 0, items_scanned: 0, items_missing_shorttitle: 0, errors: 0, scan_limited: false, scan_disabled: true, scan_skip_reason: poolScanSkipReason } };

  if (poolScan.candidates.length > 0) {
    const poolScanLimit = Math.max(1, Number(process.env.ZOTERO_TRANSLATION_POOL_SCAN_LIMIT || 50));
    const limited = poolScan.candidates.slice(0, poolScanLimit);
    const merged = [...summaryForRun.writeback_items, ...limited.map((c) => ({ ...c, backfill_short_title: true }))];
    summaryForRun = { ...summaryForRun, writeback_items: merged };
    console.error(`[translation_backfill] pool scan: ${poolScan.scanStats.items_missing_shorttitle} missing shortTitle, ${limited.length} added (limit=${poolScanLimit})`);
  }
  const admittedMetadataItemKeys = new Set((summaryForRun.writeback_items || []).map((it) => it.itemKey).filter(Boolean));
  const metadataScopeBlocks = [];

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
  let previousRetryCount = 0;
  let autoDowngrade = null;
  let report = null;

  while (true) {
    report = await backfillShortTitles(summaryForRun, {
      translateOne,
      translateTitlesBatch,
      cachePath: RUNTIME.translationCachePath,
      metadataConcurrency: currentConcurrency,
      metadataConcurrencyMax,
      observationMode,
      writeMetadata: async (itemKey, fields) => {
        if (!admittedMetadataItemKeys.has(itemKey)) {
          metadataScopeBlocks.push({
            action: "write_metadata",
            role: "shortTitle_backfill",
            itemKey,
            reason: "write_metadata_item_not_admitted_by_stage2_or_allowed_pool_scan",
          });
          throw new Error("collection_scope_blocked:write_metadata_item_not_admitted");
        }
        await mcpToolCall("write_metadata", { itemKey, fields }, 980000 + Math.floor(Math.random() * 10000));
      },
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
    autoDowngrade = {
      backfill_auto_downgrade_triggered: true,
      original_concurrency: baseConcurrency,
      downgraded_concurrency: downgraded,
      downgrade_reason: risk.reason,
      downgrade_at_batch: 1,
      write_metadata_success_before_downgrade: report.success_count,
      write_metadata_remaining_after_downgrade: Math.max(0, report.total - report.success_count - report.failure_count),
    };
    previousRetryCount = Number(report?.writeback?.metadata_retries_used || 0);
    currentConcurrency = downgraded;
    break;
  }

  const output = {
    date: dateStr,
    stage: "abc_shorttitle_backfill",
    provider: translationConfig.model,
    api_key_configured: translationConfig.apiKeyConfigured,
    cache_path: RUNTIME.translationCachePath,
    configured_concurrency: configuredConcurrency,
    effective_concurrency: currentConcurrency,
    concurrency_warning: concurrencyWarning,
    concurrency_clamped: concurrencyClamped,
    concurrency_default_used: source === "default",
    concurrency_source: source,
    collection_scope_guard_enabled: true,
    ...summarizeCollectionScopeBlocks(metadataScopeBlocks),
    ...(autoDowngrade || { backfill_auto_downgrade_triggered: false }),
    ...report,
  };
  Object.assign(output, summarizeCollectionScopeBlocks(metadataScopeBlocks));

  // Diagnostic signals: distinguish no-candidates vs missing API key
  const writebackItemCount = (summary?.writeback_items || []).length;
  const poolDuplicates = Number(summary?.counters?.skipped_duplicate_in_pool || 0);
  const writebackFailures = Array.isArray(summary?.failures) ? summary.failures.length : 0;
  output.diagnostic_signals = {
    translation_skipped_no_candidates: report.total === 0,
    translation_disabled_missing_api_key: !translationConfig.apiKeyConfigured,
    writeback_items_in: writebackItemCount,
    writeback_pool_duplicates: poolDuplicates,
    writeback_failures: writebackFailures,
    pool_scan_date_collections: poolScan.scanStats.date_collections_scanned,
    pool_scan_items_scanned: poolScan.scanStats.items_scanned,
    pool_scan_items_missing_shorttitle: poolScan.scanStats.items_missing_shorttitle,
    pool_scan_errors: poolScan.scanStats.errors,
    pool_scan_limited: poolScan.scanStats.scan_limited,
    pool_scan_enabled: poolScanEnabled,
    pool_scan_interval_days: poolScanIntervalDays,
    pool_scan_window_days: poolScanWindowDays,
    pool_scan_last_run_at: lastPoolScanAt,
    pool_scan_days_since_last_run: Number.isFinite(daysSincePoolScan) ? daysSincePoolScan : null,
    pool_scan_skip_reason: poolScanSkipReason,
    pool_scan_max_items: Math.max(10, Number(process.env.ZOTERO_TRANSLATION_POOL_SCAN_MAX_ITEMS || 100)),
    candidates_from_writeback: writebackItemCount,
    candidates_from_pool_scan: poolScan.candidates.length,
    pool_scan_limit: Math.max(1, Number(process.env.ZOTERO_TRANSLATION_POOL_SCAN_LIMIT || 50)),
  };
  if (report.total === 0 && !translationConfig.apiKeyConfigured) {
    console.error("[translation_backfill] skipped: no candidate items AND missing TITLE_TRANSLATION_API_KEY");
  } else if (report.total === 0) {
    console.error(`[translation_backfill] skipped: no candidate items (writeback=${writebackItemCount}, pool_scan_missing=${poolScan.scanStats.items_missing_shorttitle}, duplicates=${poolDuplicates}, failures=${writebackFailures})`);
  } else if (!translationConfig.apiKeyConfigured) {
    console.error("[translation_backfill] disabled: missing TITLE_TRANSLATION_API_KEY (items available but API key not set)");
  } else {
    console.error(`[translation_backfill] processing ${report.total} items (writeback=${writebackItemCount}, pool_scan=${poolScan.candidates.length})`);
  }
  const usage = report.usage || {};
  const usageReport = {
    date: dateStr,
    stage: "abc_shorttitle_backfill",
    total_items: report.total,
    cache_hits: usage.cache_hits ?? null,
    cache_misses: usage.cache_misses ?? null,
    cache_hit_rate: usage.cache_hit_rate ?? null,
    api_items: usage.api_items ?? null,
    api_calls: usage.api_calls ?? null,
    api_rpm_limit: usage.api_rpm_limit ?? null,
    api_tpm_limit: usage.api_tpm_limit ?? null,
    rpm_window_seconds: usage.rpm_window_seconds ?? 60,
    tpm_window_seconds: usage.tpm_window_seconds ?? 60,
    batch_size: usage.batch_size ?? null,
    retries: usage.retries ?? null,
    rate_limit_wait_count: usage.rate_limit_wait_count ?? 0,
    rate_limit_wait_ms: usage.rate_limit_wait_ms ?? 0,
    rate_limit_error_count: usage.rate_limit_error_count ?? 0,
    estimated_tokens: usage.estimated_tokens ?? null,
    token_estimation_method: usage.token_estimation_method ?? null,
    input_tokens: usage.usage_available === false ? "unavailable" : (usage.input_tokens ?? null),
    output_tokens: usage.usage_available === false ? "unavailable" : (usage.output_tokens ?? null),
    total_tokens: usage.usage_available === false ? "unavailable" : (usage.total_tokens ?? null),
    avg_input_tokens_per_item: usage.usage_available === false ? "unavailable" : (usage.avg_input_tokens_per_item ?? null),
    avg_output_tokens_per_item: usage.usage_available === false ? "unavailable" : (usage.avg_output_tokens_per_item ?? null),
    avg_total_tokens_per_item: usage.usage_available === false ? "unavailable" : (usage.avg_total_tokens_per_item ?? null),
    max_output_tokens_per_call: usage.max_output_tokens_per_call ?? null,
    model: translationConfig.model,
    temperature: usage.temperature ?? 0,
    max_output_tokens: usage.max_output_tokens ?? null,
    warnings: usage.warnings || [],
    abnormal_batches: usage.abnormal_batches || [],
  };

  await fs.writeFile(backfillPath, JSON.stringify(output, null, 2), "utf8");
  await fs.writeFile(failuresPath, JSON.stringify({
    date: dateStr,
    failure_count: report.failure_count,
    failures: report.failures,
  }, null, 2), "utf8");
  await fs.writeFile(usagePath, JSON.stringify(usageReport, null, 2), "utf8");
  if (poolScanEnabled) {
    await mergeRuntimeState({
      last_translation_pool_scan_at: new Date().toISOString(),
      last_translation_pool_scan_planned_slot_at: dateStr,
    });
  }

  try {
    const runReport = JSON.parse(await fs.readFile(runReportPath, "utf8"));
    runReport.stage_timings = runReport.stage_timings || {};
    runReport.stage_timings.translation = {
      status: "completed",
      ms: Date.now() - stageStarted,
      usage_report: usagePath,
    };
    runReport.steps = runReport.steps || {};
    runReport.steps.translation = {
      ...(runReport.steps.translation || {}),
      stage: "completed",
      provider: translationConfig.model,
      failed_count: report.failure_count,
      failed_samples: report.failures.slice(0, 5),
      api_key_configured: translationConfig.apiKeyConfigured,
      usage_report_path: usagePath,
      diagnostic_signals: output.diagnostic_signals,
      collection_scope_guard_enabled: true,
      collection_scope_blocked_count: output.collection_scope_blocked_count,
      collection_scope_blocked_samples: output.collection_scope_blocked_samples,
    };
    await fs.writeFile(runReportPath, JSON.stringify(runReport, null, 2), "utf8");
  } catch {}

  console.log(JSON.stringify(output, null, 2));
}

export async function markBackfillFailure(err) {
  try {
    const date = TODAY;
    const week = isoWeek(date);
    const day = yyMd(date);
    const pipelineDir = path.join(RESEARCH_ROOT, "pipeline", day);
    const runReportPath = path.join(pipelineDir, "run_report.json");
    const runReport = JSON.parse(await fs.readFile(runReportPath, "utf8"));
    runReport.failures = Array.isArray(runReport.failures) ? runReport.failures : [];
    const reason = String(err?.message || err);
    const details = err?.details || null;
    runReport.failures.push({
      stage: "stage3_translation_backfill",
      reason,
      details,
      at: new Date().toISOString(),
    });
    runReport.steps = runReport.steps || {};
    runReport.steps.abc_translation_backfill = {
      ok: false,
      completed: false,
      downgrade_reason: reason,
      downgrade_details: details,
      fallback: "stage4_use_english_title_when_missing_translation",
    };
    runReport.stage_timings = runReport.stage_timings || {};
    runReport.stage_timings.translation = {
      status: "failed",
      reason,
      details,
    };
    await fs.writeFile(runReportPath, JSON.stringify(runReport, null, 2), "utf8");
  } catch {}
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runMcpTranslationBackfill().catch((e) => {
    markBackfillFailure(e).finally(() => {
      console.error(e);
      process.exit(1);
    });
  });
}
