import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { shouldStopBackfillByRisk } from "./lib/translation_backfill_support.mjs";

const ROOT = process.env.ZOTERO_PROJECT_ROOT || path.resolve(".");
const RESEARCH_ROOT = path.join(ROOT, "research_os");
// MCP_URL: Default is http://127.0.0.1:23120/mcp.
// If your Zotero MCP plugin uses a different port, set ZOTERO_MCP_URL in your environment or .env file.
const MCP_URL = process.env.ZOTERO_MCP_URL || "http://127.0.0.1:23120/mcp";
// ZOTERO_EXE: Default candidates are used if not set.
// Windows: D:/Zotero/zotero.exe (or C:/Program Files/Zotero/zotero.exe)
// macOS: /Applications/Zotero.app/Contents/MacOS/zotero or /Applications/Zotero.app
// The system attempts to auto-detect or launch by app name on macOS.
const ZOTERO_EXE = process.env.ZOTERO_EXE || (process.platform === "win32" ? "D:/Zotero/zotero.exe" : "zotero");
const PW_SH = process.env.PWSH_PATH || "pwsh";
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
function parseCandidates(raw, defaults) {
  if (!String(raw || "").trim()) return defaults;
  return [...new Set(String(raw).split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0))];
}
function startZotero() {
  spawnSync(PW_SH, ["-NoLogo", "-Command", `Start-Process "${ZOTERO_EXE}" -WindowStyle Hidden`], { encoding: "utf8" });
}
async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function mcpToolCall(name, args, id) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`MCP ${name} failed: ${JSON.stringify(json.error)}`);
  return json.result;
}
async function ensureMcpReady() {
  startZotero();
  await wait(3000);
  let lastErr = null;
  for (let i = 0; i < 5; i++) {
    try {
      await mcpToolCall("get_collections", { mode: "minimal", limit: 1 }, 993000 + i);
      return;
    } catch (e) {
      lastErr = e;
      await wait(1000);
    }
  }
  throw new Error(`MCP_NOT_READY: ${String(lastErr?.message || lastErr)}`);
}

async function runOneConcurrency(items, concurrency) {
  const started = Date.now();
  let retryCount = 0;
  let successCount = 0;
  let failureCount = 0;
  let shortTitleMismatchCount = 0;
  const errors = [];
  const batchSize = Math.max(1, Number(process.env.ZOTERO_TRANSLATION_BACKFILL_CALIBRATION_BATCH_SIZE || 20));
  const metadataRetry = Math.max(0, Number(process.env.ZOTERO_TRANSLATION_BACKFILL_RETRY_LIMIT || 1));
  let batchIdx = 0;
  let firstErrorItem = null;
  let firstErrorBatch = null;
  for (let offset = 0; offset < items.length; offset += batchSize) {
    batchIdx += 1;
    const batch = items.slice(offset, offset + batchSize);
    const seen = new Set();
    const workers = Array.from({ length: Math.max(1, concurrency) }).map(async (_, workerIdx) => {
      for (let i = workerIdx; i < batch.length; i += concurrency) {
        const item = batch[i];
        if (seen.has(item.itemKey)) continue;
        seen.add(item.itemKey);
        let ok = false;
        for (let attempt = 0; attempt <= metadataRetry; attempt++) {
          try {
            await mcpToolCall("write_metadata", { itemKey: item.itemKey, fields: { shortTitle: item.shortTitle } }, 994000 + offset + i + attempt);
            ok = true;
            break;
          } catch (e) {
            if (attempt < metadataRetry) retryCount += 1;
            if (attempt >= metadataRetry) {
              const msg = String(e?.message || e);
              if (firstErrorItem == null) firstErrorItem = item.itemKey;
              if (firstErrorBatch == null) firstErrorBatch = batchIdx;
              errors.push(msg);
            }
          }
        }
        if (ok) {
          successCount += 1;
        } else {
          failureCount += 1;
        }
      }
    });
    await Promise.all(workers);
  }
  return {
    concurrency,
    items_attempted: successCount + failureCount,
    success_count: successCount,
    failure_count: failureCount,
    failure_rate: (successCount + failureCount) ? failureCount / (successCount + failureCount) : 0,
    retry_count: retryCount,
    shortTitle_mismatch_count: shortTitleMismatchCount,
    duration_ms: Date.now() - started,
    avg_ms_per_item: (successCount + failureCount) ? (Date.now() - started) / (successCount + failureCount) : 0,
    mcp_errors: errors.slice(0, 20),
    status: "stable",
    warning_signals: [],
  };
}

function recommend(results) {
  const stable = results.filter((x) => x.status === "stable");
  if (!stable.length) return { recommended: 32, reason: "no_stable_result_fallback" };
  let best = stable[0];
  for (const r of stable.slice(1)) {
    const improved = r.avg_ms_per_item < best.avg_ms_per_item * 0.9;
    const lowRetry = r.retry_count <= best.retry_count + 2;
    if (improved && lowRetry) best = r;
  }
  return { recommended: best.concurrency, reason: "best_speed_within_risk_threshold" };
}

async function main() {
  await ensureMcpReady();
  const week = isoWeek(TODAY);
  const day = yyMd(TODAY);
  const pipelineDir = path.join(RESEARCH_ROOT, "pipeline", day);
  const summaryPath = path.join(pipelineDir, "mcp_writeback_summary.json");
  const reportPath = path.join(pipelineDir, "zotero_write_metadata_upper_bound_report.json");
  const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
  const defaults = [32, 40, 48, 64, 80, 96, 128];
  const candidates = parseCandidates(process.env.ZOTERO_WRITE_METADATA_UPPER_BOUND_CONCURRENCIES, defaults);
  const maxItems = Math.max(1, Number(process.env.ZOTERO_TRANSLATION_BACKFILL_CALIBRATION_MAX_ITEMS || 120));
  const uniqueMap = new Map();
  for (const rec of (summary.writeback_items || [])) {
    const itemKey = String(rec?.itemKey || "").trim();
    if (!itemKey || uniqueMap.has(itemKey)) continue;
    const shortTitle = String(rec?.中文标题 || rec?.title || "").trim();
    if (!shortTitle) continue;
    uniqueMap.set(itemKey, { itemKey, shortTitle });
  }
  const items = [...uniqueMap.values()].slice(0, maxItems);
  const results = [];
  let lastStable = null;
  let failedConcurrency = null;
  let previousRetryCount = 0;

  for (const c of candidates) {
    const result = await runOneConcurrency(items, c);
    const risk = shouldStopBackfillByRisk({
      failureRate: result.failure_rate,
      shortTitleMismatchCount: result.shortTitle_mismatch_count,
      mcpErrors: result.mcp_errors || [],
      retryCount: result.retry_count,
      previousRetryCount,
    });
    const warningSignals = [];
    if (risk.reason) warningSignals.push(risk.reason);
    if (result.failure_count > 0) warningSignals.push("failure_count_gt_0");
    if (previousRetryCount > 0 && result.retry_count > previousRetryCount * 2 + 5) {
      warningSignals.push("retry_spike");
    }
    if (risk.stop || risk.downgrade || warningSignals.includes("retry_spike")) {
      result.status = "unstable";
      result.warning_signals = [...new Set([...(result.warning_signals || []), ...warningSignals])];
      result.failed_concurrency = c;
      result.failure_reason = result.warning_signals[0] || "unstable";
      result.error_message = result.mcp_errors?.[0] || "";
    } else {
      result.status = "stable";
      result.warning_signals = [...new Set([...(result.warning_signals || []), ...warningSignals])];
    }
    results.push(result);
    if (result.status === "unstable") {
      failedConcurrency = c;
      break;
    }
    lastStable = c;
    previousRetryCount = result.retry_count;
  }
  const rec = recommend(results);
  const output = {
    tested_concurrencies: results.map((x) => x.concurrency),
    last_stable_concurrency: lastStable,
    failed_concurrency: failedConcurrency,
    recommended_daily_default: rec.recommended,
    recommended_reason: rec.reason,
    sample_limited: items.length < 100,
    available_items: items.length,
    results,
  };
  await fs.writeFile(reportPath, JSON.stringify(output, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, report_path: reportPath, recommended_daily_default: rec.recommended }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
