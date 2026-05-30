import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function runWriteback(samplePath, concurrency, batchSize) {
  const scriptPath = path.join(ROOT, "tools/mcp_bulk_writeback.mjs");
  const envUsed = {
    ZOTERO_CONCURRENCY_DIAGNOSTIC: "1",
    ZOTERO_WRITEBACK_CONCURRENCY: String(concurrency),
    ZOTERO_WRITEBACK_CONCURRENCY_BATCH_SIZE: String(batchSize),
    ZOTERO_WRITEBACK_OBSERVATION_MODE: "1",
  };
  const proc = spawnSync(NODE, [scriptPath, `--input-file=${samplePath}`], {
    cwd: ROOT,
    env: { ...process.env, ...envUsed },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 100,
  });
  return { proc, envUsed, failedCommand: `${NODE} ${scriptPath} --input-file=${samplePath}` };
}

async function main() {
  const week = isoWeek(TODAY);
  const day = yyMd(TODAY);
  const pipelineDir = path.join(RESEARCH_ROOT, "pipeline", day);
  const writebackPath = path.join(pipelineDir, "writeback_ready_items.json");
  const summaryPath = path.join(pipelineDir, "mcp_writeback_summary.json");
  const reportPath = path.join(pipelineDir, "zotero_concurrency_diagnostic_report.json");
  const baseItems = JSON.parse(await fs.readFile(writebackPath, "utf8"));
  const maxItems = Math.max(1, Number(process.env.ZOTERO_WRITEBACK_DIAGNOSTIC_MAX_ITEMS || 20));
  const batchSize = Math.max(1, Number(process.env.ZOTERO_WRITEBACK_DIAGNOSTIC_BATCH_SIZE || 5));
  const concurrency = Math.max(1, Number(process.env.ZOTERO_WRITEBACK_DIAGNOSTIC_CONCURRENCY || 12));
  const sample = baseItems.filter((x) => x.grade !== "D").slice(0, maxItems);
  const samplePath = path.join(pipelineDir, `diagnostic_writeback_sample_c${concurrency}.json`);
  await fs.writeFile(samplePath, JSON.stringify(sample, null, 2), "utf8");
  const started = Date.now();
  const { proc, envUsed, failedCommand } = runWriteback(samplePath, concurrency, batchSize);

  const report = {
    diagnostic_concurrency: concurrency,
    diagnostic_items_attempted: sample.length,
    created_count: 0,
    reused_count: 0,
    failure_count: sample.length,
    retry_count: 0,
    duration_ms: Date.now() - started,
    avg_ms_per_created_item: 0,
    process_exit_code: proc.status,
    process_signal: proc.signal || null,
    stderr_excerpt: String(proc.stderr || "").slice(0, 3000),
    stdout_excerpt: String(proc.stdout || "").slice(0, 3000),
    failed_command: failedCommand,
    env_used: envUsed,
    mcp_errors: [],
    first_error_item: null,
    first_error_batch: null,
    failure_phase: "process_level_failure",
    recommendation: "keep_write_item_concurrency_at_or_below_last_stable",
  };

  if (proc.status === 0) {
    const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
    report.created_count = Number(summary?.counters?.created || 0);
    report.reused_count = Number(summary?.counters?.reused_existing || 0);
    report.failure_count = Number(summary?.counters?.failed || 0);
    report.retry_count = Number(summary?.run_stats?.writeback_retry_count || 0);
    report.avg_ms_per_created_item = report.created_count > 0 ? report.duration_ms / report.created_count : 0;
    report.mcp_errors = (summary?.failures || []).map((x) => String(x.error || "")).slice(0, 20);
    report.first_error_item = summary?.failures?.[0]?.idx ?? null;
    report.first_error_batch = 1;
    report.failure_phase = report.failure_count > 0 ? "write_item_or_attach_failure" : "none";
    report.recommendation = report.failure_count > 0 ? "investigate_item_level_failures_before_higher_concurrency" : "c12_passed_for_this_sample";
  }

  if (report.diagnostic_items_attempted === 0 && report.failure_count > 0) {
    report.failure_phase = "sample_allocation_failure";
  }
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ ok: proc.status === 0, report_path: reportPath }, null, 2));
  if (proc.status !== 0) process.exit(proc.status || 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
