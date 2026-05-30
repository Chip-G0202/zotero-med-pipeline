import path from "node:path";
import { DAILY_REVIEW_HEADERS } from "./spreadsheet_adapter.mjs";
import { evaluateRunInterval } from "./schedule_support.mjs";
import { buildPoolDuplicateIndex, matchPoolDuplicate } from "./writeback_support.mjs";

export const FORBIDDEN_REPORT_HEADERS = ["日期", "推荐理由", "命中信号", "Zotero条目Key", "写回状态"];

export function weekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

export function yyMd(d) {
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
}

export function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function weekLabel(d) {
  return `${String(d.getFullYear()).slice(2)} Week${weekNumber(d)}`;
}

export function buildDryRunReport({
  now = new Date(),
  runtimeStatePath,
  lastSuccessfulRunAt = null,
  runIntervalDays = 2,
  forceRun = false,
  exportRoot,
  feedbackReviewRoot,
  feedbackLearning = {},
  pool = {},
  candidates = [],
  semanticSearchCalls = 0,
  dryRunReuseResolver = null,
} = {}) {
  const schedule = evaluateRunInterval({
    now,
    lastSuccessfulRunAt,
    intervalDays: runIntervalDays,
    forceRun,
  });

  const plannedWeekFolder = path.join(exportRoot, weekLabel(now));
  const plannedDateFolder = path.join(plannedWeekFolder, yyMd(now));
  const plannedIntervalReportPath = path.join(plannedDateFolder, "隔日报.xlsx");

  const idx = buildPoolDuplicateIndex(pool.items || []);
  const duplicateIndexCounts = {
    doi: idx.doi.size,
    pmid: idx.pmid.size,
    pmcid: idx.pmcid.size,
    arxiv: idx.arxiv.size,
    title: idx.title.size,
  };

  let wouldSkipDuplicateInPool = 0;
  let wouldCreate = 0;
  let wouldReuseExisting = 0;
  let wouldAddToPool = 0;
  let wouldAddToCurrentDateCollection = 0;
  const duplicateRecords = [];
  const writebackPreview = [];
  const skippedPreview = [];

  const poolBlocked = !pool.found || pool.ambiguous;
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    if (String(item?.grade || "").toUpperCase() === "D" || String(item?.grade_label || "") === "D无关") continue;
    if (poolBlocked) continue;
    const dup = matchPoolDuplicate(item, idx);
    if (dup.matched) {
      wouldSkipDuplicateInPool += 1;
      const rec = {
        candidate_id: i,
        title: item?.title || "",
        duplicate_reason: `duplicate_by_${dup.type}`,
        matched_pool_item_key: dup.itemKey || "",
        matched_identifier_type: dup.type,
        matched_identifier_value: dup.value,
        pool_item_title: "",
        action: "skipped_duplicate_in_pool",
      };
      duplicateRecords.push(rec);
      if (skippedPreview.length < 20) skippedPreview.push(rec);
      continue;
    }
    const wouldReuse = typeof dryRunReuseResolver === "function" ? Boolean(dryRunReuseResolver(item)) : false;
    if (wouldReuse) {
      wouldReuseExisting += 1;
    } else {
      wouldCreate += 1;
    }
    wouldAddToPool += 1;
    wouldAddToCurrentDateCollection += 1;
    if (writebackPreview.length < 20) {
      writebackPreview.push({
        candidate_id: i,
        title: item?.title || "",
        grade: item?.grade || "",
        source_channel: item?.source_channel || "",
        plan: wouldReuse ? "would_reuse_existing" : "would_create",
      });
    }
  }

  const wouldNotWriteDueToPool = poolBlocked ? candidates.filter((x) => String(x?.grade || "").toUpperCase() !== "D").length : 0;
  const headers = DAILY_REVIEW_HEADERS.slice();
  const forbiddenHeadersPresent = FORBIDDEN_REPORT_HEADERS.filter((h) => headers.includes(h));

  return {
    ok: true,
    dry_run: true,
    timestamp: new Date(now).toISOString(),
    no_zotero_writes: true,
    schedule: {
      runtime_state_path: runtimeStatePath,
      last_successful_full_run_at: lastSuccessfulRunAt,
      run_interval_days: runIntervalDays,
      elapsed_hours_since_last_success: schedule.elapsed_hours_since_last_success,
      run_due: schedule.run_due,
      force_run: schedule.force_run,
      would_skip_due_to_interval: schedule.skipped_due_to_interval,
      stage4_required_for_success_state: true,
    },
    paths: {
      export_root: exportRoot,
      feedback_review_root: feedbackReviewRoot,
      planned_week_folder: plannedWeekFolder,
      planned_date_folder: plannedDateFolder,
      planned_interval_report_path: plannedIntervalReportPath,
    },
    feedback_learning: {
      lookup_paths: feedbackLearning.lookup_paths || [],
      selected_feedback_file: feedbackLearning.selected_feedback_file || null,
      headers: feedbackLearning.headers || [],
      rows_with_feedback: Number(feedbackLearning.rows_with_feedback || 0),
      rows_with_comment: Number(feedbackLearning.rows_with_comment || 0),
      would_load_before_triage: Boolean(feedbackLearning.would_load_before_triage),
    },
    pool: {
      collection_name: "文献池",
      collection_key: pool.collection_key || null,
      found: Boolean(pool.found),
      ambiguous: Boolean(pool.ambiguous),
      items_scanned: Number((pool.items || []).length),
      duplicate_index_counts: duplicateIndexCounts,
    },
    writeback_plan: {
      candidates_total: candidates.length,
      would_skip_duplicate_in_pool: wouldSkipDuplicateInPool,
      would_create: wouldCreate,
      would_reuse_existing: wouldReuseExisting,
      would_add_to_pool: wouldAddToPool,
      would_add_to_current_date_collection: wouldAddToCurrentDateCollection,
      would_not_write_due_to_pool_missing_or_ambiguous: wouldNotWriteDueToPool,
      duplicate_records_preview: duplicateRecords.slice(0, 20),
      writeback_preview: writebackPreview.slice(0, 20),
      skipped_duplicate_preview: skippedPreview,
    },
    stage3_plan: {
      would_backfill_count: wouldAddToCurrentDateCollection,
      excludes_pool_duplicates: true,
    },
    report_plan: {
      would_export_rows: wouldAddToCurrentDateCollection,
      excludes_pool_duplicates: true,
      excludes_d: true,
      headers,
      forbidden_headers_present: forbiddenHeadersPresent,
    },
    safety: {
      created_items: 0,
      updated_items: 0,
      collection_adds: 0,
      collection_removes: 0,
      collection_moves: 0,
      semantic_search_calls: semanticSearchCalls,
    },
    recommendations: [],
  };
}

