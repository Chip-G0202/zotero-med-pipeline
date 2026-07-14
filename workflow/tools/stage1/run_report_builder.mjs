import { buildSkillAlignmentMatrix } from "../lib/research_os_exports.mjs";
import { REVIEW_REPORT_LABEL } from "../lib/report_period_support.mjs";

export function buildStage1SkipRunReport({
  startedAt,
  intervalInfo = {},
  intervalGateDiagnostics = {},
  triggerMode = "",
  forceRun = false,
  monthDir = "",
  reviewDayDir = "",
  exportRoot = "",
} = {}) {
  return {
    started_at: startedAt,
    skipped: true,
    reason: "interval_not_reached",
    ...intervalInfo,
    interval_gate_diagnostics: intervalGateDiagnostics,
    triggerMode,
    forceRun,
    month_dir: monthDir,
    review_day_dir: reviewDayDir,
    report_cadence: "weekly",
    report_label: REVIEW_REPORT_LABEL,
    synthesis_cadence: "monthly",
    synthesis_label: "月报",
    export_root: exportRoot,
    desktop_export_disabled: true,
  };
}

export function buildStage1RunReport({
  startedAt,
  date = "",
  monthDir = "",
  reviewDayDir = "",
  weekDir = "",
  dayDir = "",
  intervalInfo = {},
  intervalGateDiagnostics = {},
  triggerMode = "",
  forceRun = false,
  exportRoot = "",
} = {}) {
  return {
    started_at: startedAt,
    date,
    month_dir: monthDir,
    review_day_dir: reviewDayDir,
    week_dir: weekDir,
    day_dir: dayDir,
    steps: {},
    counts: {},
    failures: [],
    pending_zotero_writeback: [],
    stage_timings: {},
    ...intervalInfo,
    interval_gate_diagnostics: intervalGateDiagnostics,
    triggerMode,
    forceRun,
    report_cadence: "weekly",
    report_label: REVIEW_REPORT_LABEL,
    synthesis_cadence: "monthly",
    synthesis_label: "月报",
    legacy_daily_review_compat: true,
    legacy_weekly_report_compat: true,
    export_root: exportRoot,
    desktop_export_disabled: true,
    feedback_item_actions_default_enabled: true,
    manual_standard_evaluation_default_enabled: true,
  };
}

function countByGradeLabel(items = []) {
  return items.reduce((counts, item) => {
    counts[item.grade_label] = (counts[item.grade_label] || 0) + 1;
    return counts;
  }, {});
}

export function buildCompletedStage1RunReport({
  report,
  mergedCount = 0,
  rssItemsCount = 0,
  dbItemsCount = 0,
  triagedAll = [],
  triaged = [],
  triageSummary = {},
  exportLimit = null,
  translationConfig = {},
  translationCachePath = "",
  triageDurationMs = 0,
  triageVersion = "",
  labels = {},
  dateStr = "",
  starMigrationDefaults = {},
} = {}) {
  const next = {
    ...report,
    steps: { ...(report?.steps || {}) },
    counts: { ...(report?.counts || {}) },
    failures: [...(report?.failures || [])],
    pending_zotero_writeback: [...(report?.pending_zotero_writeback || [])],
    stage_timings: { ...(report?.stage_timings || {}) },
  };

  next.steps.translation = {
    stage: "deferred_after_writeback",
    provider: translationConfig.model,
    failed_count: 0,
    failed_samples: [],
    api_key_configured: translationConfig.apiKeyConfigured,
    cache_path: translationCachePath,
    batch_size: translationConfig.batchSize,
    temperature: translationConfig.temperature,
  };
  next.steps.med_daily_triage = {
    ok: true,
    excludes_d_from_daily_review: true,
    translation_deferred: true,
    triage_version: triageVersion,
    exported_count: triaged.length,
  };
  next.steps.daily_export_counts = {
    raw: countByGradeLabel(triagedAll),
    exported: countByGradeLabel(triaged),
    export_limit: exportLimit || null,
  };

  next.counts.merged = mergedCount;
  next.counts.fetched_count = next.steps.dedupe?.fetched_count ?? (rssItemsCount + dbItemsCount);
  next.counts.deduped_count = next.steps.dedupe?.deduped_count ?? mergedCount;
  next.counts.duplicate_removed_count = next.steps.dedupe?.duplicate_removed_count ?? 0;
  next.counts.llm_review_candidate_count = next.steps.dedupe?.llm_review_candidate_count ?? 0;
  next.counts.llm_review_candidate_count_before_zotero_dedupe = next.steps.dedupe?.llm_review_candidate_count_before_zotero_dedupe ?? next.counts.llm_review_candidate_count;
  next.counts.llm_review_candidate_count_after_zotero_dedupe = next.steps.dedupe?.llm_review_candidate_count_after_zotero_dedupe ?? next.counts.llm_review_candidate_count;
  next.counts.pre_llm_existing_duplicate_count = next.steps.pre_llm_zotero_existing_dedupe?.pre_llm_existing_duplicate_count ?? 0;
  next.counts.skipped_llm_review_existing_count = next.steps.pre_llm_zotero_existing_dedupe?.skipped_llm_review_existing_count ?? 0;
  next.counts.skipped_writeback_pre_llm_existing_count = next.steps.pre_llm_zotero_existing_dedupe?.skipped_writeback_pre_llm_existing_count ?? 0;
  next.counts.duplicates_still_reviewed_count = next.steps.dedupe?.duplicates_still_reviewed_count ?? 0;
  next.counts.llm_candidate_excluded_non_abc = next.steps.dedupe?.excluded_non_abc_count ?? 0;
  next.counts.llm_candidate_excluded_not_deduped = next.steps.dedupe?.excluded_not_deduped_count ?? 0;
  next.counts.triaged = triagedAll.length;
  next.counts.daily_export = triaged.length;
  next.counts.grade_counts = triageSummary.grade_counts;
  next.counts.abc_writeback_candidates = triageSummary.writeback_candidate_count;
  next.counts.d_skipped = triageSummary.skipped_d_count;
  next.counts.uncertain = triageSummary.uncertain_count;

  next.stage_timings.triage = { status: "completed", ms: triageDurationMs };
  next.triage_policy = {
    version: triageVersion,
    labels,
  };
  next.pdf_automation = {
    enabled: false,
    reason: "PDF acquisition is out of automation scope",
  };

  next.pending_zotero_writeback.push({
    mode: "zotero_backend_required",
    root_candidates: ["文献池", "RSS文献池"],
    target_layout: `${dateStr}/${labels.A} + ${dateStr}/${labels.B} + ${dateStr}/${labels.C} (${labels.D}不写回)`,
    star_migration: {
      status: "managed_in_stage2_writeback",
      default_mode: starMigrationDefaults.default_mode,
      default_window_days: starMigrationDefaults.default_window_days,
      default_star_threshold: starMigrationDefaults.default_star_threshold,
      note: "Stage1 不再直接执行迁移；真实迁移由 Stage2 writeback summary 输出。",
    },
    note: "Zotero information read/write/move must be executed via the configured Zotero backend. This script only produces ingestion+triage payload.",
  });
  next.steps.med_zotero_bridge = {
    ok: next.steps.connector.ok,
    zotero_backend_required: true,
    pending_writeback: true,
    connector_ok: next.steps.connector.ok,
  };
  next.stage_timings.zotero_writeback = { status: "skipped", reason: "stage_2_script" };
  next.stage_timings.translation = { status: "skipped", reason: "stage_3_script" };
  next.stage_timings.excel_export = { status: "skipped", reason: "stage_4_script" };

  next.steps.skill_alignment = buildSkillAlignmentMatrix({
    feedbackLearning: next.steps.feedback_learning,
    dailyExport: {
      rssCount: next.counts.rss_raw,
      databaseCount: next.counts.db_raw,
      mergedCount: next.counts.merged,
      exportedCount: next.counts.daily_export,
      excludesD: true,
      translationFailuresTracked: false,
    },
    weeklyAssets: { updated: false },
    zoteroWriteback: { backendOnly: true, tagCleanupUsesWriteTag: true, migrationTracked: true },
  });

  return next;
}
