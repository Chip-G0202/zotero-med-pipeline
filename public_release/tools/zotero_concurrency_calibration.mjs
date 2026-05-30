import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildNonOverlappingAllocations,
  classifyCreateMix,
  getAggressiveDefaults,
  parseCandidates,
  recommendConcurrency,
  shouldStopEscalation,
} from "./lib/concurrency_calibration_support.mjs";

const ROOT = process.env.ZOTERO_PROJECT_ROOT || path.resolve(".");
const RESEARCH_ROOT = path.join(ROOT, "research_os");
const NODE = process.env.NODE_PATH || "node";
const TODAY = new Date();

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
function runNode(scriptPath, args, env) {
  return spawnSync(NODE, [scriptPath, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env, ZOTERO_CONCURRENCY_CALIBRATION: "1" },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 100,
  });
}
function dedupeKey(it) {
  return String(it?.dedupe_key || it?.doi || it?.pmid || it?.url || it?.title || "").trim();
}

async function main() {
  const defaults = getAggressiveDefaults();
  const writebackCandidates = parseCandidates(process.env.ZOTERO_WRITEBACK_CALIBRATION_CONCURRENCIES, defaults.writeback);
  const backfillCandidates = parseCandidates(process.env.ZOTERO_TRANSLATION_BACKFILL_CALIBRATION_CONCURRENCIES, defaults.translation);
  const writebackMaxItems = Math.max(1, Number(process.env.ZOTERO_WRITEBACK_CALIBRATION_MAX_ITEMS || 60));
  const backfillMaxItems = Math.max(1, Number(process.env.ZOTERO_TRANSLATION_BACKFILL_CALIBRATION_MAX_ITEMS || 120));

  const week = isoWeek(TODAY);
  const day = yyMd(TODAY);
  const pipelineDir = path.join(RESEARCH_ROOT, "pipeline", day);
  const reportPath = path.join(pipelineDir, "zotero_concurrency_calibration_report.json");
  const writebackReadyPath = path.join(pipelineDir, "writeback_ready_items.json");
  const previousReport = await fs.readFile(reportPath, "utf8").then((t) => JSON.parse(t)).catch(() => null);
  const writebackReady = JSON.parse(await fs.readFile(writebackReadyPath, "utf8"));
  const unique = [];
  const seen = new Set();
  for (const it of writebackReady) {
    const k = dedupeKey(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    unique.push({ key: k, item: it });
  }
  const allocationPlan = buildNonOverlappingAllocations({
    uniqueItems: unique,
    concurrencies: writebackCandidates,
    preferredSizes: [writebackMaxItems, 30, 20],
  });
  const report = {
    profile: process.env.ZOTERO_CONCURRENCY_CALIBRATION_PROFILE || "aggressive",
    calibration_started_at: new Date().toISOString(),
    calibration_finished_at: null,
    safe_to_promote_to_daily_defaults: false,
    manual_review_required: true,
    writeback: {
      daily_default_concurrency: 1,
      daily_max_concurrency: 10,
      calibration_max_concurrency: 16,
      available_unique_items: allocationPlan.available_unique_items,
      tested_until_concurrency: null,
      skipped_concurrencies: allocationPlan.skipped_concurrencies,
      skip_reason: allocationPlan.skipped_concurrencies.length ? "insufficient_non_overlapping_samples" : null,
      tested_concurrencies: [],
      last_stable_concurrency: null,
      failed_concurrency: null,
      recommended_concurrency: 1,
      aggressive_next_candidates: [],
      sample_limited: allocationPlan.sample_limited,
      reused_heavy_calibration: previousReport?.writeback?.results || [],
      new_create_heavy_calibration: [],
      results: [],
      unstable_details: null,
    },
    translation_backfill: {
      ...previousReport?.translation_backfill,
      daily_default_concurrency: 1,
      daily_max_concurrency: 32,
      calibration_max_concurrency: 32,
    },
    warnings: [],
  };
  const calibrationRunId = `cal-${Date.now()}`;
  const isolatedCollectionName = `Concurrency Calibration Test ${new Date().toISOString().slice(0, 10)}`;

  let lastStable = null;
  const allPreviousKeys = new Set();
  for (const alloc of allocationPlan.allocations) {
    const started = Date.now();
    const keys = alloc.sample_items.map((x) => x.key);
    const syntheticItems = alloc.sample_items.map((x, idx) => ({
      ...x.item,
      title: `[CALIB ${calibrationRunId}] c${alloc.concurrency} o${alloc.sample_offset} i${idx} :: ${x.item.title}`,
      中文标题: `[CALIB ${calibrationRunId}] c${alloc.concurrency} o${alloc.sample_offset} i${idx}`,
      doi: "",
      pmid: "",
      pmcid: "",
      url: "",
      dedupe_key: `calibration:${calibrationRunId}:c${alloc.concurrency}:i${idx}`,
      source_channel: "rss",
      grade: "C",
      grade_label: "C领域相关",
    }));
    const samplePath = path.join(pipelineDir, `calibration_writeback_sample_c${alloc.concurrency}.json`);
    await fs.writeFile(samplePath, JSON.stringify(syntheticItems, null, 2), "utf8");
    const overlap = keys.filter((k) => allPreviousKeys.has(k));
    for (const k of keys) allPreviousKeys.add(k);
    const result = {
      concurrency: alloc.concurrency,
      sample_offset: alloc.sample_offset,
      sample_size: alloc.sample_size,
      sample_limited: alloc.sample_size < writebackMaxItems,
      sample_dedupe_keys: keys,
      sample_overlap_with_previous_count: overlap.length,
      sample_overlap_with_previous_keys: overlap,
      items_attempted: 0,
      created_count: 0,
      reused_count: 0,
      failure_count: 0,
      retry_count: 0,
      duplicate_prevented_count: 0,
      duplicate_detected_count: 0,
      wrong_collection_detected_count: 0,
      uncertain_create_state_count: 0,
      in_flight_dedupe_wait_count: 0,
      duration_ms: 0,
      avg_ms_per_item: 0,
      avg_ms_per_created_item: 0,
      mcp_errors: [],
      fallback_to_serial: false,
      status: "stable",
      calibration_type: "new_create_heavy",
    };
    if (overlap.length > 0) {
      result.status = "unstable";
      result.mcp_errors.push("sample_overlap_detected");
    } else {
      const proc = runNode(
        path.join(ROOT, "tools/mcp_bulk_writeback.mjs"),
        [`--input-file=${samplePath}`],
        {
          ZOTERO_WRITEBACK_CONCURRENCY: String(alloc.concurrency),
          ZOTERO_WRITEBACK_CALIBRATION_ISOLATED: "1",
          ZOTERO_WRITEBACK_CALIBRATION_COLLECTION: isolatedCollectionName,
        },
      );
      if (proc.status !== 0) {
        result.failure_count = alloc.sample_size;
        result.uncertain_create_state_count = alloc.sample_size;
        result.mcp_errors.push((proc.stderr || proc.stdout || "writeback_failed").slice(0, 500));
        result.status = "unstable";
      } else {
        const summary = JSON.parse(await fs.readFile(path.join(pipelineDir, "mcp_writeback_summary.json"), "utf8"));
        result.items_attempted = Number(summary?.counters?.total || 0);
        result.created_count = Number(summary?.counters?.created || 0);
        result.reused_count = Number(summary?.counters?.reused_existing || 0);
        result.failure_count = Number(summary?.counters?.failed || 0);
        result.retry_count = Number(summary?.run_stats?.writeback_retry_count || 0);
        result.duplicate_prevented_count = Number(summary?.run_stats?.duplicate_prevented_count || 0);
        result.duplicate_detected_count = Number(summary?.run_stats?.duplicate_detected_count || 0);
        result.in_flight_dedupe_wait_count = Number(summary?.run_stats?.in_flight_dedupe_wait_count || 0);
        result.fallback_to_serial = Number(summary?.fallback_to_per_item_count || 0) > 0;
        result.mcp_errors.push(...(summary?.failures || []).map((x) => String(x.error || "")).slice(0, 10));
        if (result.reused_count / Math.max(1, result.items_attempted) > 0.2) {
          result.calibration_type = "mixed_create_reuse";
          report.warnings.push(`writeback c=${alloc.concurrency} mixed create/reuse`);
        }
      }
    }
    result.duration_ms = Date.now() - started;
    result.failure_rate = result.items_attempted ? result.failure_count / result.items_attempted : 0;
    result.avg_ms_per_item = result.items_attempted ? result.duration_ms / result.items_attempted : 0;
    result.avg_ms_per_created_item = result.created_count ? result.duration_ms / result.created_count : 0;
    if (result.status === "stable" && shouldStopEscalation(result, lastStable)) {
      result.status = "unstable";
      result.mcp_errors.push("escalation_stop_condition");
    }

    report.writeback.new_create_heavy_calibration.push(result);
    report.writeback.results.push(result);
    report.writeback.tested_concurrencies.push(result.concurrency);
    report.writeback.tested_until_concurrency = result.concurrency;
    if (result.status === "unstable") {
      report.writeback.failed_concurrency = result.concurrency;
      report.writeback.unstable_details = {
        failed_concurrency: result.concurrency,
        failure_reason: result.mcp_errors[0] || "unstable",
        first_error_batch: 1,
        first_error_item: 1,
        error_message: result.mcp_errors[0] || "",
        retry_count: result.retry_count,
        failure_rate: result.failure_rate,
        whether_duplicate_detected: result.duplicate_detected_count > 0,
        whether_wrong_collection_detected: result.wrong_collection_detected_count > 0,
        whether_shortTitle_mismatch_detected: false,
        last_stable_concurrency: report.writeback.last_stable_concurrency,
      };
      break;
    }
    lastStable = result;
    report.writeback.last_stable_concurrency = result.concurrency;
  }

  const recommendBase = report.writeback.new_create_heavy_calibration.filter((x) => x.sample_overlap_with_previous_count === 0 && x.status === "stable");
  report.writeback.recommended_concurrency = recommendConcurrency(recommendBase);
  if (report.writeback.last_stable_concurrency >= 12 && report.writeback.failed_concurrency == null) {
    report.writeback.aggressive_next_candidates.push(16);
  }
  report.calibration_finished_at = new Date().toISOString();
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({
    ok: true,
    report_path: reportPath,
    writeback_tested: report.writeback.tested_concurrencies,
    backfill_kept_from_previous: true,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
