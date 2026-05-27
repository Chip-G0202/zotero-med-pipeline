import fs from "node:fs/promises";
import path from "node:path";
import { runFeedbackLearningDiagnostic } from "./lib/feedback_learning_support.mjs";
import { buildDryRunReport, yyMd } from "./lib/writeback_pool_dry_run_support.mjs";

const ROOT = process.env.ZOTERO_PROJECT_ROOT || path.resolve(".");
const RESEARCH_ROOT = path.join(ROOT, "research_os");
const REVIEW_ROOT = path.join(RESEARCH_ROOT, "文献评价");
const DESKTOP_REVIEW_ROOT = process.env.DESKTOP_REVIEW_ROOT || path.join(ROOT, "research_os", "文献评价");
const RUNTIME_STATE_PATH = path.join(RESEARCH_ROOT, "runtime_state.json");
const MCP_URL = process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp";

const READ_ONLY_TOOLS = new Set(["get_collections", "get_collection_items", "get_item_details", "search_library"]);

function parseToolText(result) {
  const txt = result?.content?.[0]?.text || "{}";
  return JSON.parse(txt);
}

async function mcpToolCall(name, args, id, counters) {
  counters.total += 1;
  counters.by_tool[name] = (counters.by_tool[name] || 0) + 1;
  if (!READ_ONLY_TOOLS.has(name)) {
    throw new Error(`FORBIDDEN_TOOL_IN_DRY_RUN:${name}`);
  }
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
  if (json.error) throw new Error(`MCP_${name}_FAILED:${JSON.stringify(json.error)}`);
  return json.result;
}

async function findLatestWritebackReadyPath() {
  const newRoot = path.join(RESEARCH_ROOT, "pipeline");
  try {
    const days = (await fs.readdir(newRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && /^\d{2}\.\d{1,2}\.\d{1,2}$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
    for (const d of days) {
      const candidate = path.join(newRoot, d, "writeback_ready_items.json");
      try {
        await fs.access(candidate);
        return candidate;
      } catch {}
    }
  } catch {}

  // Legacy fallback: research_os/<ISO-week>/<yy.M.d>/pipeline/*
  const entries = await fs.readdir(RESEARCH_ROOT, { withFileTypes: true });
  const weekDirs = entries.filter((e) => e.isDirectory() && /^\d{4}-W\d{2}$/.test(e.name)).map((e) => e.name).sort().reverse();
  for (const w of weekDirs) {
    const weekPath = path.join(RESEARCH_ROOT, w);
    const days = (await fs.readdir(weekPath, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && /^\d{2}\.\d{1,2}\.\d{1,2}$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
    for (const d of days) {
      const candidate = path.join(weekPath, d, "pipeline", "writeback_ready_items.json");
      try {
        await fs.access(candidate);
        return candidate;
      } catch {}
    }
  }
  return null;
}

async function readPoolItems(counters) {
  const all = parseToolText(await mcpToolCall("get_collections", { mode: "complete", limit: 500 }, 1, counters));
  const exact = all.filter((x) => x.name === "文献池");
  if (exact.length !== 1) {
    return { found: exact.length === 1, ambiguous: exact.length > 1, collection_key: exact[0]?.key || null, items: [] };
  }
  const collectionKey = exact[0].key;
  const keys = [];
  const limit = 500;
  let offset = 0;
  while (true) {
    const page = parseToolText(await mcpToolCall("get_collection_items", { collectionKey, limit, offset }, 1000 + offset, counters));
    if (!Array.isArray(page) || !page.length) break;
    for (const it of page) {
      if (it?.key) keys.push(it.key);
    }
    if (page.length < limit) break;
    offset += limit;
  }

  const poolItems = [];
  for (let i = 0; i < keys.length; i++) {
    const itemKey = keys[i];
    try {
      const det = parseToolText(await mcpToolCall("get_item_details", { itemKey, mode: "preview" }, 5000 + i, counters));
      const d = det?.data || det || {};
      const extra = String(d.extra || "");
      poolItems.push({
        itemKey,
        DOI: d.DOI || d.doi || "",
        pmid: (extra.match(/PMID:\s*([^\s]+)/i) || [])[1] || "",
        pmcid: (extra.match(/PMCID:\s*([^\s]+)/i) || [])[1] || "",
        arxiv_id: (extra.match(/arXiv:\s*([^\s]+)/i) || [])[1] || "",
        title: d.title || det?.title || "",
      });
    } catch {}
  }

  return {
    found: true,
    ambiguous: false,
    collection_key: collectionKey,
    items: poolItems,
  };
}

async function buildReuseResolver(counters) {
  return async function resolve(item) {
    const queries = [item.doi, item.pmid, item.pmcid, item.arxiv_id, item.title].filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      try {
        const hits = parseToolText(await mcpToolCall("search_library", { q, limit: 8, mode: "preview", relevanceScoring: true }, 900000 + i, counters));
        if (Array.isArray(hits) && hits.length > 0) return true;
      } catch {}
    }
    return false;
  };
}

async function main() {
  const now = new Date();
  const day = yyMd(now);
  const pipelineDir = path.join(RESEARCH_ROOT, "pipeline", day);
  await fs.mkdir(pipelineDir, { recursive: true });

  let lastSuccessfulRunAt = null;
  try {
    const runtimeState = JSON.parse(await fs.readFile(RUNTIME_STATE_PATH, "utf8"));
    lastSuccessfulRunAt = runtimeState?.last_successful_full_run_at || null;
  } catch {}

  const feedbackDiag = runFeedbackLearningDiagnostic(now, {
    reviewRoot: REVIEW_ROOT,
    desktopRoot: DESKTOP_REVIEW_ROOT,
    projectRoot: ROOT,
    researchRoot: RESEARCH_ROOT,
  });

  const inputArg = process.argv.find((x) => x.startsWith("--input="));
  const explicitInput = inputArg ? inputArg.split("=")[1] : null;
  const inputPath = explicitInput || await findLatestWritebackReadyPath();
  const candidates = inputPath ? JSON.parse(await fs.readFile(inputPath, "utf8")) : [];

  const mcpCounters = { total: 0, by_tool: {} };
  let pool = { found: false, ambiguous: false, collection_key: null, items: [] };
  let poolError = "";
  try {
    pool = await readPoolItems(mcpCounters);
  } catch (e) {
    poolError = String(e.message || e);
  }

  const asyncReuseResolver = await buildReuseResolver(mcpCounters);
  const syncReuseCache = new Map();
  for (let i = 0; i < candidates.length; i++) {
    const it = candidates[i];
    const key = `${it?.title || ""}||${it?.doi || ""}||${it?.pmid || ""}||${it?.pmcid || ""}`;
    if (!syncReuseCache.has(key)) {
      const reused = pool.found && !pool.ambiguous ? await asyncReuseResolver(it) : false;
      syncReuseCache.set(key, reused);
    }
  }
  const syncReuseResolver = (item) => {
    const key = `${item?.title || ""}||${item?.doi || ""}||${item?.pmid || ""}||${item?.pmcid || ""}`;
    return syncReuseCache.get(key) || false;
  };

  const report = buildDryRunReport({
    now,
    runtimeStatePath: RUNTIME_STATE_PATH,
    lastSuccessfulRunAt,
    runIntervalDays: 2,
    forceRun: /^(1|true|yes)$/i.test(String(process.env.FORCE_RESEARCH_OS_RUN || process.env.RESEARCH_OS_FORCE_RUN || "false")),
    exportRoot: REVIEW_ROOT,
    feedbackReviewRoot: REVIEW_ROOT,
    feedbackLearning: {
      lookup_paths: feedbackDiag.candidate_feedback_files || [],
      selected_feedback_file: feedbackDiag.selected_feedback_file || null,
      headers: feedbackDiag.sheet?.headers || [],
      rows_with_feedback: feedbackDiag.counts?.rows_with_feedback || 0,
      rows_with_comment: feedbackDiag.counts?.rows_with_comment || 0,
      would_load_before_triage: true,
    },
    pool,
    candidates,
    semanticSearchCalls: 0,
    dryRunReuseResolver: syncReuseResolver,
  });

  report.source = {
    candidate_input_path: inputPath,
    pool_scan_error: poolError || null,
    mcp_read_calls: mcpCounters,
  };
  report.recommendations = [];
  if (!pool.found) {
    report.recommendations.push("未找到唯一文献池；真实写回将被阻止。");
  }
  if (pool.ambiguous) {
    report.recommendations.push("文献池存在重名歧义；真实写回将被阻止。");
  }
  if (!feedbackDiag.selected_feedback_file_exists) {
    report.recommendations.push("上一期反馈文件未找到；下次执行偏好学习将降级。");
  }

  const outPath = path.join(pipelineDir, "writeback_pool_dedupe_dry_run.json");
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ ok: true, dry_run: true, output: outPath }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
