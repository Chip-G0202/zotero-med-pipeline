import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { getTranslationConfig, translateOne, translateTitlesBatch } from "./lib/title_translation_support.mjs";
import {
  backfillShortTitles,
  nextBackfillDowngrade,
  resolveBackfillConcurrency,
  shouldStopBackfillByRisk,
} from "./lib/translation_backfill_support.mjs";
import { ensureZoteroMcpReady } from "./lib/ensure_zotero_mcp_ready.mjs";
import { buildRuntimeConfig } from "./lib/runtime_config.mjs";

const RUNTIME = buildRuntimeConfig();
const ROOT = RUNTIME.projectRoot;
const RESEARCH_ROOT = RUNTIME.researchRoot;
const MCP_URL = process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp";
const TODAY = new Date();

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

async function mcpToolCall(name, args, id) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`MCP ${name} failed: ${JSON.stringify(json.error)}`);
  return json.result;
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
  const summaryForRun = limit
    ? { ...summary, writeback_items: (summary.writeback_items || []).slice(offset, offset + limit) }
    : { ...summary, writeback_items: (summary.writeback_items || []).slice(offset) };
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
    ...(autoDowngrade || { backfill_auto_downgrade_triggered: false }),
    ...report,
  };
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
