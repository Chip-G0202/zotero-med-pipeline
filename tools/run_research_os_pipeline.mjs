import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildSkillAlignmentMatrix } from "./lib/research_os_exports.mjs";
import { buildWritebackReadyItems } from "./lib/pipeline_stage_support.mjs";
import { getTranslationConfig, loadTranslationCache } from "./lib/title_translation_support.mjs";
import { LABELS, TRIAGE_VERSION, classifyItem, loadScreeningStandards, summarizeGradeCounts, buildFeedbackIndex, deriveSemanticGradeFromFeedbackMatches, synthesizeFinalGrade } from "./lib/triage_policy.mjs";
import { createZoteroSemanticAdapter } from "./lib/zotero_semantic_search.mjs";
import { ensureZoteroMcpReady } from "./lib/ensure_zotero_mcp_ready.mjs";
import { ensureOllamaReady } from "./lib/ensure_ollama_ready.mjs";
import { buildFeedbackSemanticSamples, buildPreferenceLearningAudit, refinePreferencesFromSemantic } from "./lib/preference_refinement.mjs";
import { runFeedbackLearningDiagnostic } from "./lib/feedback_learning_support.mjs";
import { applyScreeningStandardsLearningUpdate, generateRuleSuggestionsFromFeedback, loadRuleSuggestionsLog, writeRuleSuggestionsLog, ruleSuggestionsLogPath, processManualStandardEvaluation, parseScreeningStandardsDocx, screeningStandardsDocxPath, readScreeningStandardsFile, syncScreeningStandardsDocx } from "./lib/screening_standards_file.mjs";
import { evaluateRunInterval } from "./lib/schedule_support.mjs";
import { evaluatePwshGate } from "./lib/pwsh_gate.mjs";
import { buildRuntimeConfig } from "./lib/runtime_config.mjs";
import { buildNcbiESearchUrl, loadPubMedPmcSearchConfig, loadRssSources } from "./lib/literature_config.mjs";
import { buildMovePlan, scanFeedbackRows, scanLiteratureRecords } from "./archive_history_by_feedback.mjs";
import { buildCorrectionPlan, enrichArchivePlanWithZoteroTitleMatches, readCollections } from "./zotero_feedback_collection_corrections.mjs";

const RUNTIME = buildRuntimeConfig();
const ROOT = RUNTIME.projectRoot;
const RESEARCH_ROOT = RUNTIME.researchRoot;
const REVIEW_ROOT = RUNTIME.reviewRoot;
const ZOTERO_EXE = RUNTIME.zoteroExe;
const PW_SH = RUNTIME.pwshPath;
const DESKTOP_REVIEW_ROOT = RUNTIME.legacyDesktopReviewRoot;
const LEGACY_PROJECT_REVIEW_ROOT = path.join(ROOT, "文献评价");
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
function cleanText(s) {
  return (s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function normTitle(t) {
  return cleanText(t)
    .normalize("NFKC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
}
function weekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function desktopWeekLabel(d) {
  return `${String(d.getFullYear()).slice(2)} Week${weekNumber(d)}`;
}

export function shouldSkipLocalZoteroLaunch(externalLauncher = "") {
  return String(externalLauncher || "").trim().toLowerCase() === "desktop_commander";
}

function loadPreviousFeedbackPrefs(now) {
  const diag = runFeedbackLearningDiagnostic(now, {
    reviewRoot: REVIEW_ROOT,
    desktopRoot: DESKTOP_REVIEW_ROOT,
    projectRoot: ROOT,
    researchRoot: RESEARCH_ROOT,
    lookbackDays: 7,
  });
  const learningPayload = diag.learning_payload || {};
  return {
    ok: Boolean(diag.ok && diag.preference_learning?.would_update_preference),
    path: diag.selected_feedback_file || "",
    selected_date: diag.selected_feedback_date || "",
    checked_files: diag.checked_files || [],
    rows_used: Number(learningPayload.rows_used || 0),
    rows_with_comment: Number(diag.counts?.rows_with_comment || 0),
    rows_missing_title_translation: Number(diag.counts?.rows_missing_title_translation || 0),
    rows_ambiguous: Number(diag.preference_learning?.ambiguous_samples || 0),
    hardPositiveTerms: Array.isArray(learningPayload.hardPositiveTerms) ? learningPayload.hardPositiveTerms : [],
    hardNegativeTerms: Array.isArray(learningPayload.hardNegativeTerms) ? learningPayload.hardNegativeTerms : [],
    signals: Array.isArray(learningPayload.signals) ? learningPayload.signals : [],
    metaPreferenceSignals: Array.isArray(learningPayload.meta_preference_signals) ? learningPayload.meta_preference_signals : [],
    standardSummaryFeedback: diag.standard_summary_feedback || {},
    screeningStandards: diag.screening_standards || {},
    diagnostics: diag,
  };
}
function checkPwshVersionGate() {
  const p = spawnSync(PW_SH, ["-NoLogo", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8" });
  return evaluatePwshGate({
    rawVersionOutput: (p.stdout || "").trim(),
    requiredMinVersion: "7.0.0",
    commandStatus: Number(p.status ?? 1),
  });
}
async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}
async function fetchJson(url, timeoutMs = 15000) {
  const txt = await fetchText(url, timeoutMs);
  return JSON.parse(txt);
}
async function fetchTextWithRetry(url, attempts = 3, timeoutMs = 15000) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetchText(url, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 600 * i));
    }
  }
  throw lastErr || new Error("UNKNOWN_FETCH_ERROR");
}
function parseRssItems(xml, sourceUrl) {
  const items = [];
  const channelTitle = cleanText((xml.match(/<channel[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const title = cleanText((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const link = cleanText((b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || "");
    const desc = cleanText((b.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || "");
    if (!title) continue;
    const doi = (desc.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i) || [])[0] || "";
    items.push({
      source_channel: "rss",
      source_platform: "rss",
      feed_url: sourceUrl,
      journal: channelTitle,
      item_type_hint: "journalArticle",
      title,
      url: link,
      abstract: desc,
      doi: doi.toLowerCase(),
    });
  }
  return items;
}
async function fetchRssAll() {
  const out = [];
  const failed = [];
  const rssConfig = loadRssSources({ root: ROOT });
  await Promise.all(
    rssConfig.sources.map(async ({ url: u }) => {
      try {
        const xml = await fetchTextWithRetry(u, 3, 15000);
        out.push(...parseRssItems(xml, u));
      } catch (e) {
        failed.push({ feed: u, error: String(e.message || e) });
      }
    }),
  );
  return { items: out, failed, config: rssConfig };
}
async function fetchNcbiDatabase(database, cfg) {
  const esearchUrl = buildNcbiESearchUrl(cfg, database);
  const txt = await fetchText(esearchUrl, 20000);
  const json = JSON.parse(txt);
  const ids = json?.esearchresult?.idlist || [];
  if (!ids.length) return { items: [], failed: [] };
  const esummaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=${encodeURIComponent(database)}&retmode=json&id=${ids.join(",")}`;
  const sumTxt = await fetchText(esummaryUrl, 20000);
  const sum = JSON.parse(sumTxt);
  const items = ids
    .map((id) => sum?.result?.[id])
    .filter(Boolean)
    .map((r, i) => ({
      source_channel: "database",
      source_platform: database,
      item_type_hint: "journalArticle",
      title: cleanText(r.title || ""),
      url: database === "pmc" ? `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${ids[i]}/` : `https://pubmed.ncbi.nlm.nih.gov/${ids[i]}/`,
      abstract: "",
      doi: "",
      pmid: database === "pubmed" ? String(ids[i]) : "",
      pmcid: database === "pmc" ? `PMC${ids[i]}` : "",
      journal: r.fulljournalname || "",
      pubdate: r.pubdate || "",
    }));
  return { items, failed: [] };
}
async function fetchPubMed() {
  const cfg = loadPubMedPmcSearchConfig({ root: ROOT, now: new Date() });
  const items = [];
  const failed = [];
  for (const database of cfg.databases) {
    try {
      const result = await fetchNcbiDatabase(database, cfg);
      items.push(...result.items);
      failed.push(...(result.failed || []));
    } catch (error) {
      failed.push({ source: database, error: String(error.message || error) });
    }
  }
  return { items, failed, config: cfg };
}
function dedup(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const doiKey = it.doi ? `doi:${String(it.doi).toLowerCase().trim()}` : "";
    const pmidKey = it.pmid ? `pmid:${String(it.pmid).toLowerCase().trim()}` : "";
    const pmcidKey = it.pmcid ? `pmcid:${String(it.pmcid).toLowerCase().trim()}` : "";
    const titleKey = it.title ? `title:${normTitle(it.title)}` : "";
    const urlKey = it.url ? `url:${String(it.url).toLowerCase().trim()}` : "";
    const key = doiKey || pmidKey || pmcidKey || titleKey || urlKey;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

export async function runResearchOsPipeline({ argv = process.argv } = {}) {
  const totalStarted = Date.now();
  const exportLimitArg = argv.find((x) => x.startsWith("--export-limit="));
  const exportLimit = exportLimitArg ? Number(exportLimitArg.split("=")[1]) : null;
  const now = RUNTIME.now;
  const dateStr = fmtDate(now);
  const week = isoWeek(now);
  const day = yyMd(now);
  const pipeDir = path.join(RESEARCH_ROOT, "pipeline", day);
  await fs.mkdir(pipeDir, { recursive: true });
  await fs.mkdir(REVIEW_ROOT, { recursive: true });

  const runIntervalDays = Number(process.env.RESEARCH_OS_RUN_INTERVAL_DAYS || 2);
  const forceRun = /^(1|true|yes)$/i.test(String(process.env.FORCE_RESEARCH_OS_RUN || process.env.RESEARCH_OS_FORCE_RUN || "false"));
  let lastSuccessfulRunAt = null;
  try {
    const runtimeState = JSON.parse(await fs.readFile(RUNTIME_STATE_PATH, "utf8"));
    lastSuccessfulRunAt = runtimeState?.last_accepted_planned_slot_at || runtimeState?.last_successful_full_run_at || null;
  } catch {}
  const intervalInfo = evaluateRunInterval({
    now,
    lastSuccessfulRunAt,
    intervalDays: runIntervalDays,
    forceRun,
  });
  const currentRunAtIso = intervalInfo.current_run_at;
  const elapsedHours = intervalInfo.elapsed_hours_since_last_success;
  const runDue = intervalInfo.run_due;
  const nextEligibleRunAt = intervalInfo.next_eligible_run_at;
  if (!runDue && !forceRun) {
    const skipReport = {
      started_at: currentRunAtIso,
      skipped: true,
      reason: "interval_not_reached",
      ...intervalInfo,
      triggerMode: process.env.RESEARCH_OS_ORCHESTRATOR_TRIGGER || "",
      forceRun,
      report_cadence: "two_day",
      report_label: "隔日报",
      synthesis_cadence_days: 14,
      synthesis_label: "双周报",
      export_root: REVIEW_ROOT,
      desktop_export_disabled: true,
    };
    await fs.writeFile(path.join(pipeDir, "run_skip_report.json"), JSON.stringify(skipReport, null, 2), "utf8");
    await fs.writeFile(path.join(pipeDir, "run_report.json"), JSON.stringify(skipReport, null, 2), "utf8");
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "interval_not_reached", next_eligible_run_at: nextEligibleRunAt }, null, 2));
    return;
  }

  const report = {
    started_at: new Date().toISOString(),
    date: dateStr,
    week_dir: week,
    day_dir: day,
    steps: {},
    counts: {},
    failures: [],
    pending_zotero_writeback: [],
    stage_timings: {},
    ...intervalInfo,
    triggerMode: process.env.RESEARCH_OS_ORCHESTRATOR_TRIGGER || "",
    forceRun,
    report_cadence: "two_day",
    report_label: "隔日报",
    synthesis_cadence_days: 14,
    synthesis_label: "双周报",
    legacy_daily_review_compat: true,
    legacy_weekly_report_compat: true,
    export_root: REVIEW_ROOT,
    desktop_export_disabled: true,
  };
  const pubmedPmcConfigPath = path.join(ROOT, "config", "pubmed_pmc_search.json");
  report.steps.manual_standard_evaluation = await processManualStandardEvaluation({
    reviewRoot: REVIEW_ROOT,
    pubmedConfigPath: pubmedPmcConfigPath,
    auditPath: path.join(pipeDir, "manual_standard_evaluation_audit.json"),
  });
  report.steps.feedback_learning = loadPreviousFeedbackPrefs(now);
  const feedbackDiag = report.steps.feedback_learning?.diagnostics || {};
  report.steps.med_query_learning = {
    ok: Boolean(report.steps.feedback_learning?.ok),
    feedback_file_used: report.steps.feedback_learning?.path || "",
    feedback_file_selected_date: report.steps.feedback_learning?.selected_date || "",
    feedback_files_checked: report.steps.feedback_learning?.checked_files || [],
    feedback_rows_count: Number(report.steps.feedback_learning?.rows_used || 0),
    feedback_used_for_item_actions: false,
    feedback_item_actions_entry: "tools/zotero_feedback_collection_corrections.mjs (manual command only)",
    feedback_item_actions_status: "not_executed_in_pipeline",
    feedback_used_for_rule_learning: false,
    previous_feedback_lookup_paths: feedbackDiag.lookup_paths || [],
    feedback_review_root: REVIEW_ROOT,
    feedback_lookup_paths: feedbackDiag.lookup_paths || [],
    selected_previous_feedback_file: feedbackDiag.selected_feedback_file || "",
    selected_feedback_file_source: feedbackDiag.selected_feedback_file_source || "",
    fallback_reason: feedbackDiag.fallback_reason || "",
    previous_feedback_file_found: Boolean(feedbackDiag.selected_feedback_file_exists),
    workbook_unreadable: Boolean(feedbackDiag.workbook_unreadable),
    previous_feedback_sheet_name: feedbackDiag.sheet?.name || "",
    previous_feedback_headers: feedbackDiag.sheet?.headers || [],
    feedback_column_detected: Boolean(feedbackDiag.columns?.feedback),
    comment_column_detected: Boolean(feedbackDiag.columns?.comment),
    title_columns_detected: {
      english_title: Boolean(feedbackDiag.columns?.english_title),
      title_translation: Boolean(feedbackDiag.columns?.title_translation),
      chinese_title: Boolean(feedbackDiag.columns?.chinese_title),
    },
    rows_used: report.steps.feedback_learning?.rows_used || 0,
    rows_with_comment: report.steps.feedback_learning?.rows_with_comment || 0,
    rows_missing_title_translation: report.steps.feedback_learning?.rows_missing_title_translation || 0,
    rows_ambiguous: report.steps.feedback_learning?.rows_ambiguous || 0,
    rows_with_feedback: Number(feedbackDiag.counts?.rows_with_feedback || 0),
    rows_total: Number(feedbackDiag.counts?.total_rows || feedbackDiag.counts?.rows_total || 0),
    feedback_samples_used: Number(report.steps.feedback_learning?.rows_used || 0),
    feedback_samples_ignored: Number(feedbackDiag.preference_learning?.ignored_samples || 0),
    positive_feedback_samples: Number(feedbackDiag.preference_learning?.positive_samples || 0),
    negative_feedback_samples: Number(feedbackDiag.preference_learning?.negative_samples || 0),
    ambiguous_feedback_samples: Number(feedbackDiag.preference_learning?.ambiguous_samples || 0),
    preference_learning_executed: Boolean(report.steps.feedback_learning?.ok),
    preferences_added: 0,
    preferences_updated: 0,
    preferences_reinforced: 0,
    preferences_marked_ambiguous: 0,
    preferences_needing_more_feedback: 0,
    evidence_total: 0,
    evidence_positive: 0,
    evidence_negative: 0,
    evidence_ambiguous: 0,
    evidence_ignored: 0,
    new_evidence_count: 0,
    historical_evidence_count: 0,
    clusters_total: 0,
    clusters_existing_matched: 0,
    clusters_created: 0,
    clusters_updated: 0,
    clusters_stable: 0,
    clusters_tentative: 0,
    clusters_ambiguous: 0,
    clusters_needing_more_feedback: 0,
    clustering_executed: false,
    clustering_warning: "",
    evidence_to_cluster_map_available: false,
    standard_summary_generated: false,
    standard_summary_feedback_read: Boolean(report.steps.feedback_learning?.standardSummaryFeedback?.sheet_present),
    standard_summary_feedback_used: false,
    standard_summary_feedback_rows: 0,
    meta_preference_evidence_count: 0,
    primary_rationale_source: "daily_feedback_comment_or_title",
    standard_summary_my_evaluation_rows: 0,
    clusters_adjusted_by_summary_feedback: 0,
    global_meta_feedback_count: 0,
    clusters_reinforced_by_summary_feedback: 0,
    clusters_weakened_by_summary_feedback: 0,
    clusters_scope_narrowed_by_summary_feedback: 0,
    clusters_scope_broadened_by_summary_feedback: 0,
    clusters_marked_ambiguous_by_summary_feedback: 0,
    clusters_retired_by_summary_feedback: 0,
    summary_feedback_mapping_failures: 0,
    standard_summary_sheet_exported: false,
    standard_summary_sheet_schema: "zh_two_column",
    current_standard_summary_excerpt: "",
    positive_terms: report.steps.feedback_learning?.hardPositiveTerms || [],
    negative_terms: report.steps.feedback_learning?.hardNegativeTerms || [],
    standard_summary_feedback_sheet_present: Boolean(report.steps.feedback_learning?.standardSummaryFeedback?.sheet_present),
    signals: {
      previous_feedback_missing: !feedbackDiag.selected_feedback_file_exists,
      feedback_columns_missing: Boolean((feedbackDiag.sheet?.headers || []).length > 0 && !feedbackDiag.columns?.feedback),
      no_feedback_rows: Number(feedbackDiag.counts?.rows_with_feedback || 0) === 0,
      preference_not_updated: !Boolean(report.steps.feedback_learning?.ok),
    },
  };

  const semanticAdapter = createZoteroSemanticAdapter();
  const semanticReportPath = path.join(pipeDir, "semantic_preference_refinement.json");

  if (semanticAdapter.enabled) {
    const semanticStatus = await semanticAdapter.checkSemanticStatus();
    const existingPreferenceStore = { clusters: [], preferences: [], evidence: [], meta_preference_evidence: [] };
    const feedbackSamples = buildFeedbackSemanticSamples(report.steps.feedback_learning, report.steps.feedback_learning?.path || "", {
      generatedAt: report.started_at,
    });
    const usedSamples = feedbackSamples.filter((s) => s.direction === "positive" || s.direction === "negative");
    const ignoredSamples = feedbackSamples.filter((s) => s.direction !== "positive" && s.direction !== "negative");
    const semanticResults = [];
    let semanticQueriesSucceeded = 0;
    let semanticQueriesFailed = 0;
    let semanticEmptyResults = 0;
    let semanticDegraded = false;
    let semanticDegradeReason = "";
    for (const sample of usedSamples) {
      const result = await semanticAdapter.semanticSearch(sample);
      semanticResults.push(result);
      if (!result.ok) {
        semanticQueriesFailed += 1;
        semanticDegraded = true;
        if (!semanticDegradeReason) semanticDegradeReason = result.degrade_reason || result.error || "semantic_unknown_error";
        continue;
      }
      semanticQueriesSucceeded += 1;
      if (!result.results.length) semanticEmptyResults += 1;
    }
    const refined = refinePreferencesFromSemantic({
      samples: feedbackSamples,
      semanticResults,
      metaPreferenceSignals: report.steps.feedback_learning?.metaPreferenceSignals || [],
      existingStore: existingPreferenceStore,
      screeningStandards: report.steps.feedback_learning?.screeningStandards || {},
      generatedAt: report.started_at,
    });
    await fs.writeFile(semanticReportPath, JSON.stringify({
      enabled: true,
      generated_at: new Date().toISOString(),
      samples: feedbackSamples,
      semantic_results: semanticResults,
      preferences: refined.preferences,
      evidence: refined.evidence,
      conflicts: refined.conflicts,
      stats: refined.stats,
      config: {
        mcp_url: semanticAdapter.mcpUrl,
        limit: semanticAdapter.limit,
        min_score: semanticAdapter.minScore,
        language: semanticAdapter.language,
        timeout_ms: semanticAdapter.timeoutMs,
        status: semanticStatus,
      },
    }, null, 2), "utf8");
    report.steps.med_query_learning = {
      ...report.steps.med_query_learning,
      semantic_preference_enabled: true,
      semantic_adapter: "zotero_mcp",
      zotero_mcp_endpoint: semanticAdapter.mcpUrl,
      semantic_status_checked: Boolean(semanticStatus.checked),
      semantic_status_ok: semanticStatus.ok,
      semantic_degraded: semanticDegraded || semanticStatus.degraded,
      semantic_degrade_reason: semanticDegradeReason || semanticStatus.degrade_reason || null,
      semantic_queries_attempted: usedSamples.length,
      semantic_queries_succeeded: semanticQueriesSucceeded,
      semantic_queries_failed: semanticQueriesFailed,
      feedback_samples_total: feedbackSamples.length,
      feedback_samples_used: usedSamples.length,
      feedback_samples_ignored: ignoredSamples.length,
      preferences_added: refined.stats.preferences_added,
      preferences_updated: refined.stats.preferences_updated,
      preferences_reinforced: refined.stats.preferences_reinforced,
      preferences_marked_ambiguous: refined.stats.preferences_marked_ambiguous,
      preferences_needing_more_feedback: refined.stats.preferences_needing_more_feedback,
      evidence_total: refined.stats.evidence_total,
      evidence_positive: refined.stats.evidence_positive,
      evidence_negative: refined.stats.evidence_negative,
      evidence_ambiguous: refined.stats.evidence_ambiguous,
      evidence_ignored: refined.stats.evidence_ignored,
      clusters_total: refined.stats.clusters_total,
      clusters_stable: refined.stats.clusters_stable,
      clusters_tentative: refined.stats.clusters_tentative,
      clusters_ambiguous: refined.stats.clusters_ambiguous,
      clusters_needing_more_feedback: refined.stats.clusters_needing_more_feedback,
      clustering_executed: refined.stats.clustering_executed,
      semantic_samples: feedbackSamples,
      preference_evidence: refined.evidence,
      preference_clusters: refined.clusters,
      signals: {
        ...report.steps.med_query_learning.signals,
        semantic_unavailable: semanticQueriesFailed > 0,
      },
    };
  } else {
    await fs.writeFile(semanticReportPath, JSON.stringify({
      semantic_search: {
        enabled: false,
        skipped_reason: "disabled",
        generated_at: new Date().toISOString(),
      },
    }, null, 2), "utf8");
    report.steps.med_query_learning = {
      ...report.steps.med_query_learning,
      semantic_preference_enabled: false,
      semantic_search: {
        enabled: false,
        skipped_reason: "disabled",
      },
    };
  }
  const refined = { preferences: [], evidence: [], conflicts: [], stats: {}, cluster_changes: [], clusters: [] };
  const feedbackSamples = [];
  const preferenceAuditPath = path.join(pipeDir, "preference_learning_audit.json");
  let preferenceAudit = buildPreferenceLearningAudit({
    medQueryLearning: report.steps.med_query_learning,
    feedbackLearning: report.steps.feedback_learning,
    samples: feedbackSamples,
    refined,
    triagedItems: [],
    auditPath: preferenceAuditPath,
  });
  const standardsUpdate = await applyScreeningStandardsLearningUpdate(REVIEW_ROOT, preferenceAudit, { generatedAt: report.started_at, suggestionsLogPath: ruleSuggestionsLogPath(REVIEW_ROOT) });
  report.steps.med_query_learning = {
    ...report.steps.med_query_learning,
    screening_standards_path: standardsUpdate.path,
    screening_standards_loaded: standardsUpdate.loaded,
    screening_standards_cleaned: standardsUpdate.cleaned,
    screening_standards_primary_rationale_source: standardsUpdate.used_as_primary_rationale_source,
    screening_standards_change_markup_applied: standardsUpdate.change_markup_applied,
    screening_standards_additions_count: standardsUpdate.additions_count,
    screening_standards_deletions_count: standardsUpdate.deletions_count,
    screening_standards_docx_path: standardsUpdate.docx_path,
    screening_standards_docx_synced: Boolean(standardsUpdate.docx_synced),
  };
  preferenceAudit = {
    ...preferenceAudit,
    screening_standards_path: standardsUpdate.path,
    screening_standards_loaded: standardsUpdate.loaded,
    screening_standards_cleaned: standardsUpdate.cleaned,
    screening_standards_primary_rationale_source: standardsUpdate.used_as_primary_rationale_source,
    screening_standards_change_markup_applied: standardsUpdate.change_markup_applied,
    screening_standards_additions_count: standardsUpdate.additions_count,
    screening_standards_deletions_count: standardsUpdate.deletions_count,
    screening_standards_docx_path: standardsUpdate.docx_path,
    screening_standards_docx_synced: Boolean(standardsUpdate.docx_synced),
    summary: {
      ...preferenceAudit.summary,
      screening_standards_path: standardsUpdate.path,
      screening_standards_loaded: standardsUpdate.loaded,
      screening_standards_cleaned: standardsUpdate.cleaned,
      screening_standards_primary_rationale_source: standardsUpdate.used_as_primary_rationale_source,
      screening_standards_change_markup_applied: standardsUpdate.change_markup_applied,
      screening_standards_additions_count: standardsUpdate.additions_count,
      screening_standards_deletions_count: standardsUpdate.deletions_count,
      screening_standards_docx_path: standardsUpdate.docx_path,
      screening_standards_docx_synced: Boolean(standardsUpdate.docx_synced),
    },
  };
  report.steps.med_query_learning.preference_learning_audit_path = preferenceAuditPath;
  report.steps.med_query_learning.preference_learning_summary_exported = true;
  report.steps.med_query_learning.current_standard_summary_excerpt = preferenceAudit.current_standard_summary?.one_sentence_summary || "";
  report.steps.med_query_learning.preference_learning_sheets_exported = [
    "每日反馈",
  ];
  report.steps.med_query_learning.ignored_feedback_samples = Number(report.steps.med_query_learning.feedback_samples_ignored || 0);
  report.steps.med_query_learning.triage_impact_available = preferenceAudit.triage_impact_available;
  report.steps.med_query_learning.score_delta_available = preferenceAudit.score_delta_available;
  report.steps.med_query_learning.detected_headers = report.steps.med_query_learning.previous_feedback_headers || [];
  report.steps.med_query_learning.expected_feedback_aliases = ["feedback", "Feedback", "反馈", "用户反馈"];
  report.steps.med_query_learning.expected_comment_aliases = ["comment", "Comment", "备注", "评价备注"];
  report.steps.med_query_learning.missing_columns = [
    report.steps.med_query_learning.feedback_column_detected ? null : "feedback",
    report.steps.med_query_learning.comment_column_detected ? null : "comment",
  ].filter(Boolean);
  report.steps.med_query_learning.blocker = "";
  if (report.steps.med_query_learning.workbook_unreadable) {
    report.steps.med_query_learning.blocker = "workbook_unreadable";
  } else if (report.steps.med_query_learning.missing_columns.length && report.steps.med_query_learning.detected_headers.length > 0) {
    report.steps.med_query_learning.blocker = "required_feedback_columns_missing";
  } else if ((report.steps.med_query_learning.rows_with_feedback || 0) === 0) {
    report.steps.med_query_learning.blocker = "no_supported_feedback_rows";
  }
  report.steps.med_query_learning.blockers = feedbackDiag.preference_learning?.blockers || (report.steps.med_query_learning.blocker ? [report.steps.med_query_learning.blocker] : []);
  report.steps.med_query_learning.degraded_reason = report.steps.med_query_learning.blocker || report.steps.med_query_learning.semantic_degrade_reason || "";
  report.steps.med_query_learning.signals.score_delta_unavailable = !preferenceAudit.score_delta_available;
  await fs.writeFile(preferenceAuditPath, JSON.stringify(preferenceAudit, null, 2), "utf8");

  report.steps.pwsh_gate = checkPwshVersionGate();
  if (!report.steps.pwsh_gate.pwsh_gate_passed && !report.steps.pwsh_gate.pwsh_version_unknown) {
    report.failures.push({
      stage: "pwsh_gate",
      reason: report.steps.pwsh_gate.pwsh_gate_message,
      pwsh_required_min_version: report.steps.pwsh_gate.pwsh_required_min_version,
      pwsh_detected_version: report.steps.pwsh_gate.pwsh_detected_version,
      pwsh_version_unknown: report.steps.pwsh_gate.pwsh_version_unknown,
    });
  }
  const mcpUrl = RUNTIME.mcpUrl;
  const connectorMcpProbe = async () => {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_collections", arguments: {} } }),
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json();
    if (json.error) throw new Error(`MCP get_collections failed: ${JSON.stringify(json.error)}`);
    if (!json.result) throw new Error("MCP get_collections returned no result");
  };
  try {
    report.steps.connector = await ensureZoteroMcpReady({ mcpProbe: connectorMcpProbe });
  } catch (err) {
    report.steps.connector = { ok: false, error: String(err?.message || err), errorCode: err?.code };
  }

  const fetchStarted = Date.now();
  const rss = await fetchRssAll();
  const db = await fetchPubMed().catch((e) => ({ items: [], failed: [{ source: "pubmed", error: String(e.message || e) }] }));
  report.stage_timings.fetch = { status: "completed", ms: Date.now() - fetchStarted };
  report.counts.rss_raw = rss.items.length;
  report.counts.db_raw = db.items.length;
  report.failures.push(...rss.failed.map((f) => ({ stage: "rss", ...f })));
  report.failures.push(...db.failed.map((f) => ({ stage: "pubmed", ...f })));
  report.steps.med_entry_parallel = {
    ok: true,
    rss_raw: rss.items.length,
    db_raw: db.items.length,
    rss_failures: rss.failed.length,
    db_failures: db.failed.length,
    rss_config_path: rss.config?.path || "",
    rss_sources_enabled: rss.config?.enabled_count || 0,
    pubmed_pmc_config_path: db.config?.path || "",
    pubmed_pmc_databases: db.config?.databases || [],
    pubmed_pmc_days_back: db.config?.days_back ?? 7,
    pubmed_pmc_mindate: db.config?.minDate || "",
    pubmed_pmc_maxdate: db.config?.maxDate || "",
    pubmed_pmc_warnings: db.config?.warnings || [],
  };

  const dedupeStarted = Date.now();
  const merged = dedup([...rss.items, ...db.items]);
  report.stage_timings.dedupe = { status: "completed", ms: Date.now() - dedupeStarted };
  const triageStandards = loadScreeningStandards(REVIEW_ROOT);
  report.triage_standards = {
    path: triageStandards.path || "",
    loaded: Boolean(triageStandards.loaded),
    parsed: Boolean(triageStandards.parsed),
    rules_count: (triageStandards.hard_excludes || []).length,
    error: triageStandards.error || "",
  };
  if (!triageStandards.parsed) {
    report.failures.push({ stage: "triage_standards", reason: "screening_standards_unavailable_using_fallback", fallback: "hardcoded_keywords_only" });
  }
  const triageStarted = Date.now();
  const triagedAll = merged.map((it) => {
    const scored = classifyItem(it, report.steps.feedback_learning || { hardPositiveTerms: [], hardNegativeTerms: [] }, triageStandards);
    return {
      ...it,
      grade: scored.grade,
      grade_label: scored.grade_label,
      grade_reason: scored.grade_reason,
      classification_reason: scored.classification_reason,
      hard_excluded: scored.hard_excluded,
      matched_standard_rules: scored.matched_standard_rules,
      standards_used: scored.standards_used,
      matched_signals: scored.matched_signals,
      source: scored.source,
      dedupe_key: scored.dedupe_key,
      writeback_ready: scored.writeback_ready,
      flags: scored.flags,
      triage_version: scored.triage_version,
      推荐等级: scored.grade_label,
      中文标题: it.title,
      推荐理由: scored.grade_reason,
      评分明细: scored,
    };
  });

  // ─── Semantic Grading Pass ──────────────────────────────────────────
  const semanticGradingReport = {
    enabled: false,
    items_reviewed: 0,
    items_skipped_not_eligible: 0,
    items_with_semantic_grade: 0,
    items_with_feedback_match: 0,
    items_needing_human_review: 0,
    final_grade_unchanged: 0,
    final_grade_upgraded: 0,
    final_grade_downgraded: 0,
    unique_query_count: 0,
    items_deduped: 0,
    query_mode: "title_only",
    concurrency: 0,
    search_total_ms: 0,
    search_avg_ms: 0,
    skipped_reason: "",
    error: "",
  };

  // ─── Ollama Readiness Check (before semantic grading) ────────────────
  report.steps.ollama = { ok: false, skipped: true };
  if (semanticAdapter.enabled) {
    try {
      report.steps.ollama = await ensureOllamaReady();
    } catch (err) {
      report.steps.ollama = { ok: false, error: String(err?.message || err), errorCode: err?.code };
    }
    if (!report.steps.ollama?.ok) {
      semanticGradingReport.skipped_reason = "ollama_unavailable";
    }
  }

  if (semanticAdapter.enabled && report.steps.ollama?.ok) {
    const feedbackSignals = report.steps.feedback_learning?.signals || [];
    const feedbackIdx = buildFeedbackIndex(feedbackSignals);
    semanticGradingReport.enabled = true;

    if (!feedbackIdx.size) {
      semanticGradingReport.skipped_reason = "no_feedback_signals";
    } else {
      // ── Collect eligible items (B/C only) ──
      const eligibleItems = [];
      for (const item of triagedAll) {
        const ruleGrade = item.grade;
        const isEligible = ruleGrade === "B" || ruleGrade === "C";
        if (!isEligible) {
          item.rule_grade = ruleGrade;
          item.semantic_grade = "";
          item.final_grade = ruleGrade;
          item.semantic_reason = "";
          item.needs_human_review = false;
          item.disagreement_type = "";
          semanticGradingReport.items_skipped_not_eligible += 1;
        } else {
          item.rule_grade = ruleGrade;
          eligibleItems.push(item);
        }
      }
      semanticGradingReport.items_reviewed = eligibleItems.length;

      // ── Query dedup by normTitle ──
      const titleToItems = new Map();
      for (const item of eligibleItems) {
        const key = normTitle(item.title || "");
        if (!key) {
          item.semantic_grade = "";
          item.final_grade = item.rule_grade;
          item.semantic_reason = "";
          item.needs_human_review = false;
          item.disagreement_type = "";
          continue;
        }
        if (!titleToItems.has(key)) titleToItems.set(key, []);
        titleToItems.get(key).push(item);
      }
      semanticGradingReport.unique_query_count = titleToItems.size;
      semanticGradingReport.items_deduped = eligibleItems.length - titleToItems.size;
      semanticGradingReport.concurrency = Number(process.env.ZOTERO_SEMANTIC_CONCURRENCY || 8) || 8;

      // ── Build batch samples (title-only query) ──
      const uniqueEntries = [...titleToItems.entries()];
      const batchSamples = uniqueEntries.map(([key, items], i) => ({
        row_index: i,
        feedback: "",
        direction: "ignored",
        semantic_query: key,
        _key: key,
        _items: items,
      }));

      let batchResults = [];
      const searchStarted = Date.now();
      try {
        batchResults = await semanticAdapter.searchBatch(batchSamples);
      } catch (err) {
        semanticGradingReport.error = String(err?.message || err);
        batchResults = batchSamples.map((s) => ({
          ok: false,
          results: [],
          error: String(err?.message || err),
        }));
      }
      semanticGradingReport.search_total_ms = Date.now() - searchStarted;
      semanticGradingReport.search_avg_ms = batchSamples.length > 0
        ? Math.round(semanticGradingReport.search_total_ms / batchSamples.length)
        : 0;

      // ── Process batch results ──
      for (let i = 0; i < batchResults.length; i++) {
        const searchResult = batchResults[i];
        const items = batchSamples[i]._items;
        const ruleGrade = items[0].rule_grade;

        if (!searchResult.ok || !searchResult.results?.length) {
          for (const item of items) {
            item.semantic_grade = "";
            item.final_grade = item.rule_grade;
            item.semantic_reason = "";
            item.needs_human_review = false;
            item.disagreement_type = "";
          }
          continue;
        }

        const derived = deriveSemanticGradeFromFeedbackMatches({
          searchResults: searchResult.results,
          feedbackIndex: feedbackIdx,
          ruleGrade,
        });

        const synthesized = synthesizeFinalGrade({
          ruleGrade,
          semanticGrade: derived.semanticGrade,
          semanticReason: derived.semanticReason,
          flags: items[0].flags,
        });

        for (const item of items) {
          item.semantic_grade = derived.semanticGrade;
          item.semantic_reason = derived.semanticReason;
          item.final_grade = synthesized.finalGrade;
          item.needs_human_review = synthesized.needsHumanReview;
          item.disagreement_type = synthesized.disagreementType;
        }

        if (derived.matchedFeedbackCount > 0) {
          semanticGradingReport.items_with_feedback_match += items.length;
        }
        if (synthesized.needsHumanReview) {
          semanticGradingReport.items_needing_human_review += items.length;
        }
        if (derived.semanticGrade) {
          semanticGradingReport.items_with_semantic_grade += items.length;
        }
        if (synthesized.finalGrade === ruleGrade) {
          semanticGradingReport.final_grade_unchanged += items.length;
        } else {
          const gradeOrder = { A: 1, B: 2, C: 3, D: 4 };
          if ((gradeOrder[synthesized.finalGrade] || 4) < (gradeOrder[ruleGrade] || 4)) {
            semanticGradingReport.final_grade_upgraded += items.length;
          } else {
            semanticGradingReport.final_grade_downgraded += items.length;
          }
        }
      }
    }
  } else if (semanticAdapter.enabled && !report.steps.ollama?.ok) {
    // Semantic enabled but Ollama unavailable — keep rule_grade from semantic pass, clear semantic fields
    semanticGradingReport.skipped_reason = semanticGradingReport.skipped_reason || "ollama_unavailable";
    for (const item of triagedAll) {
      if (!item.rule_grade) item.rule_grade = item.grade;
      item.semantic_grade = "";
      item.final_grade = item.rule_grade || item.grade;
      item.semantic_reason = "";
      item.needs_human_review = false;
      item.disagreement_type = "";
    }
  } else {
    semanticGradingReport.skipped_reason = "semantic_preference_disabled";
    // When disabled, set default fields on all items
    for (const item of triagedAll) {
      item.rule_grade = item.grade;
      item.semantic_grade = "";
      item.final_grade = item.grade;
      item.semantic_reason = "";
      item.needs_human_review = false;
      item.disagreement_type = "";
    }
  }

  report.steps.semantic_grading = semanticGradingReport;

  const triageSummary = summarizeGradeCounts(triagedAll);
  let preferenceAuditWithImpact = buildPreferenceLearningAudit({
    medQueryLearning: report.steps.med_query_learning,
    feedbackLearning: report.steps.feedback_learning,
    samples: feedbackSamples,
    refined,
    triagedItems: triagedAll,
    auditPath: preferenceAuditPath,
  });
  preferenceAuditWithImpact = {
    ...preferenceAuditWithImpact,
    screening_standards_path: report.steps.med_query_learning.screening_standards_path,
    screening_standards_loaded: report.steps.med_query_learning.screening_standards_loaded,
    screening_standards_cleaned: report.steps.med_query_learning.screening_standards_cleaned,
    screening_standards_primary_rationale_source: report.steps.med_query_learning.screening_standards_primary_rationale_source,
    screening_standards_change_markup_applied: report.steps.med_query_learning.screening_standards_change_markup_applied,
    screening_standards_additions_count: report.steps.med_query_learning.screening_standards_additions_count,
    screening_standards_deletions_count: report.steps.med_query_learning.screening_standards_deletions_count,
    screening_standards_docx_path: report.steps.med_query_learning.screening_standards_docx_path,
    screening_standards_docx_synced: report.steps.med_query_learning.screening_standards_docx_synced,
    summary: {
      ...preferenceAuditWithImpact.summary,
      screening_standards_path: report.steps.med_query_learning.screening_standards_path,
      screening_standards_loaded: report.steps.med_query_learning.screening_standards_loaded,
      screening_standards_cleaned: report.steps.med_query_learning.screening_standards_cleaned,
      screening_standards_primary_rationale_source: report.steps.med_query_learning.screening_standards_primary_rationale_source,
      screening_standards_change_markup_applied: report.steps.med_query_learning.screening_standards_change_markup_applied,
      screening_standards_additions_count: report.steps.med_query_learning.screening_standards_additions_count,
      screening_standards_deletions_count: report.steps.med_query_learning.screening_standards_deletions_count,
      screening_standards_docx_path: report.steps.med_query_learning.screening_standards_docx_path,
      screening_standards_docx_synced: report.steps.med_query_learning.screening_standards_docx_synced,
    },
  };
  await fs.writeFile(preferenceAuditPath, JSON.stringify(preferenceAuditWithImpact, null, 2), "utf8");

  // ─── Rule Suggestion Generation ──────────────────────────────────────
  const suggestionsLogPath = ruleSuggestionsLogPath(REVIEW_ROOT);
  let ruleSuggestionsReport = {
    standards_rule_suggestions_count: 0,
    standards_rule_suggestions_pending_count: 0,
    standards_rule_suggestions_accepted_count: 0,
    standards_rule_suggestions_revised_count: 0,
    standards_rule_suggestions_rejected_count: 0,
    skipped_duplicate_rule_suggestions_count: 0,
    docx_rule_suggestions_table_updated: false,
    docx_dropdown_supported: false,
    docx_dropdown_fallback_reason: "handcrafted_openxml_no_sdt_support",
    docx_format_sync_applied: false,
    manual_evaluation_cleared: false,
    manual_evaluation_clear_reason: "",
    docx_format_unsupported_features: ["sdt_dropdown", "read_time_format", "highlight"],
  };
  try {
    const feedbackSignals = report.steps.feedback_learning?.signals || [];
    const feedbackSource = report.steps.feedback_learning?.path || "";
    const existingSuggestionsLog = await loadRuleSuggestionsLog(suggestionsLogPath);
    const screeningStandardsParsed = loadScreeningStandards(REVIEW_ROOT);
    const standardsContent = screeningStandardsParsed?.content || (await readScreeningStandardsFile(REVIEW_ROOT)).content;

    const { suggestions: newSuggestions } = generateRuleSuggestionsFromFeedback({
      feedbackSignals,
      feedbackSource,
      standardsContent,
      screeningStandards: screeningStandardsParsed,
      existingSuggestionsLog,
      generatedAt: report.started_at,
    });

    const dedupedNewSuggestions = newSuggestions.filter((s) => {
      const hash = s.suggestion_hash;
      return !existingSuggestionsLog.suggestions.some((existing) => existing.suggestion_hash === hash);
    });

    for (const s of dedupedNewSuggestions) existingSuggestionsLog.suggestions.push(s);
    await writeRuleSuggestionsLog(suggestionsLogPath, existingSuggestionsLog);

    // Sync docx again to include newly generated suggestions in the Pending Rule Suggestions table
    const pubmedConfigPathForSync = path.join(ROOT, "config", "pubmed_pmc_search.json");
    await syncScreeningStandardsDocx(REVIEW_ROOT, {
      pubmedConfigPath: pubmedConfigPathForSync,
      evaluationText: "",
      suggestionsLogPath,
    });

    const allSuggestions = existingSuggestionsLog.suggestions;
    ruleSuggestionsReport.standards_rule_suggestions_count = allSuggestions.length;
    ruleSuggestionsReport.standards_rule_suggestions_pending_count = allSuggestions.filter((s) => s.status === "pending").length;
    ruleSuggestionsReport.standards_rule_suggestions_accepted_count = allSuggestions.filter((s) => s.status === "accepted").length;
    ruleSuggestionsReport.standards_rule_suggestions_revised_count = allSuggestions.filter((s) => s.status === "revised").length;
    ruleSuggestionsReport.standards_rule_suggestions_rejected_count = allSuggestions.filter((s) => s.status === "rejected").length;
    ruleSuggestionsReport.skipped_duplicate_rule_suggestions_count = newSuggestions.length - dedupedNewSuggestions.length;
    ruleSuggestionsReport.docx_rule_suggestions_table_updated = allSuggestions.length > 0;
    ruleSuggestionsReport.docx_format_sync_applied = true;
    const evalAudit = report.steps.manual_standard_evaluation || {};
    ruleSuggestionsReport.manual_evaluation_cleared = Boolean(evalAudit.evaluation_cleared);
    ruleSuggestionsReport.manual_evaluation_clear_reason = evalAudit.evaluation_cleared
      ? "evaluation_processed_and_cleared"
      : evalAudit.blockers?.length ? `blockers: ${evalAudit.blockers.join(",")}` : "no_evaluation_input";

    await fs.writeFile(path.join(pipeDir, "standards_rule_suggestions.json"), JSON.stringify({
      suggestions: allSuggestions,
      new_suggestions: dedupedNewSuggestions,
      log_path: suggestionsLogPath,
      generated_at: report.started_at,
    }, null, 2), "utf8");
  } catch (err) {
    ruleSuggestionsReport.suggestions_error = String(err?.message || err);
  }
  report.steps.standards_rule_suggestions = ruleSuggestionsReport;

  // ─── Feedback Item Actions Dry-Run ───────────────────────────────────
  const applyItemActions = /^(1|true|yes)$/i.test(String(process.env.APPLY_FEEDBACK_ITEM_ACTIONS || "false"));
  const feedbackItemActionsReport = {
    feedback_used_for_item_actions: false,
    feedback_item_actions_mode: applyItemActions ? "apply" : "dry_run",
    planned_actions_count: 0,
    executed_actions_count: 0,
    skipped_actions_count: 0,
    failed_actions_count: 0,
    feedback_item_actions_plan_path: "",
    status: "not_attempted",
  };
  try {
    if (report.steps.connector?.ok) {
      const feedbackRows = await scanFeedbackRows(REVIEW_ROOT);
      if (feedbackRows.length > 0) {
        const archiveRoot = path.join(RESEARCH_ROOT, "literature_archive");
        const manifestRoot = path.join(RESEARCH_ROOT, "run_manifests");
        const records = await scanLiteratureRecords(RESEARCH_ROOT);
        const archivePlan = buildMovePlan({ records, feedbackRows, archiveRoot });
        feedbackItemActionsReport.feedback_used_for_item_actions = true;
        feedbackItemActionsReport.planned_actions_count = archivePlan.filter((e) => e.status === "planned").length;
        feedbackItemActionsReport.skipped_actions_count = archivePlan.filter((e) => e.status === "skipped" || e.status === "needs_review").length;
        feedbackItemActionsReport.status = "plan_generated";

        const mcpUrl = process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp";
        const mcpToolCall = async (name, args, id) => {
          const res = await fetch(mcpUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) });
          const json = await res.json();
          if (json.error) throw new Error(`MCP ${name} failed: ${JSON.stringify(json.error)}`);
          return json.result;
        };
        try {
          await enrichArchivePlanWithZoteroTitleMatches(archivePlan, { mcpToolCall });
        } catch (enrichErr) {
          feedbackItemActionsReport.enrich_error = String(enrichErr?.message || enrichErr);
        }
        let collections = [];
        try {
          collections = await readCollections(mcpToolCall);
        } catch (collErr) {
          feedbackItemActionsReport.collections_fetch_error = String(collErr?.message || collErr);
        }
        const correctionPlan = buildCorrectionPlan({ archivePlan, collections });
        feedbackItemActionsReport.planned_correction_actions = correctionPlan.actions.filter((a) => a.status === "planned").length;
        if (applyItemActions) {
          feedbackItemActionsReport.executed_actions_count = correctionPlan.actions.filter((a) => a.status === "moved").length;
          feedbackItemActionsReport.status = "applied";
        } else {
          feedbackItemActionsReport.correction_plan_generated = true;
          feedbackItemActionsReport.status = "plan_generated";
        }

        const planPath = path.join(pipeDir, "feedback_item_actions_plan.json");
        await fs.writeFile(planPath, JSON.stringify({
          mode: feedbackItemActionsReport.feedback_item_actions_mode,
          planned_actions: archivePlan.filter((e) => e.status === "planned"),
          needs_review: archivePlan.filter((e) => e.status === "needs_review" || e.status === "conflict"),
          generated_at: report.started_at,
        }, null, 2), "utf8");
        feedbackItemActionsReport.feedback_item_actions_plan_path = planPath;
      } else {
        feedbackItemActionsReport.status = "no_feedback_rows";
      }
    } else {
      feedbackItemActionsReport.status = "skipped_mcp_not_ready";
    }
  } catch (err) {
    feedbackItemActionsReport.status = "error";
    feedbackItemActionsReport.error = String(err?.message || err);
  }
  report.steps.feedback_item_actions = feedbackItemActionsReport;
  report.steps.med_query_learning.feedback_used_for_item_actions = feedbackItemActionsReport.feedback_used_for_item_actions;
  report.steps.med_query_learning.feedback_item_actions_mode = feedbackItemActionsReport.feedback_item_actions_mode;
  report.steps.med_query_learning.feedback_item_actions_status = feedbackItemActionsReport.status;

  const translationCache = await loadTranslationCache(RUNTIME.translationCachePath);
  const writebackReadyRaw = buildWritebackReadyItems(triagedAll, { translationCache });
  const writebackReady = exportLimit ? writebackReadyRaw.slice(0, exportLimit) : writebackReadyRaw;
  const triaged = writebackReady;
  const abcAllItems = triagedAll.filter((it) => it && it.grade && it.grade !== "D");
  const translationConfig = getTranslationConfig();
  report.steps.translation = {
    stage: "deferred_after_writeback",
    provider: translationConfig.model,
    failed_count: 0,
    failed_samples: [],
    api_key_configured: translationConfig.apiKeyConfigured,
    cache_path: RUNTIME.translationCachePath,
    batch_size: translationConfig.batchSize,
    temperature: translationConfig.temperature,
  };
  report.steps.med_daily_triage = {
    ok: true,
    excludes_d_from_daily_review: true,
    translation_deferred: true,
    triage_version: TRIAGE_VERSION,
    exported_count: triaged.length,
  };
  report.steps.daily_export_counts = {
    raw: triagedAll.reduce((m, x) => ((m[x.grade_label] = (m[x.grade_label] || 0) + 1), m), {}),
    exported: triaged.reduce((m, x) => ((m[x.grade_label] = (m[x.grade_label] || 0) + 1), m), {}),
    export_limit: exportLimit || null,
  };
  report.counts.merged = merged.length;
  report.counts.triaged = triagedAll.length;
  report.counts.daily_export = triaged.length;
  report.counts.grade_counts = triageSummary.grade_counts;
  report.counts.abc_writeback_candidates = triageSummary.writeback_candidate_count;
  report.counts.d_skipped = triageSummary.skipped_d_count;
  report.counts.uncertain = triageSummary.uncertain_count;
  report.stage_timings.triage = { status: "completed", ms: Date.now() - triageStarted };
  report.triage_policy = {
    version: TRIAGE_VERSION,
    labels: LABELS,
  };
  report.pdf_automation = {
    enabled: false,
    reason: "PDF acquisition is out of automation scope",
  };

  report.pending_zotero_writeback.push({
    mode: "mcp_required",
    root_candidates: ["文献池", "RSS文献池"],
    target_layout: `${dateStr}/${LABELS.A} + ${dateStr}/${LABELS.B} + ${dateStr}/${LABELS.C} (${LABELS.D}不写回)`,
    star_migration: {
      status: "managed_in_stage2_writeback",
      default_mode: process.env.ZOTERO_STAR_MIGRATION_MODE || "expand",
      default_window_days: Number(process.env.ZOTERO_STAR_MIGRATION_WINDOW_DAYS || 7) || 7,
      default_star_threshold: Number(process.env.ZOTERO_STAR_MIGRATION_MIN_STARS || 4) || 4,
      note: "Stage1 不再直接执行迁移；真实迁移由 Stage2 writeback summary 输出。",
    },
    note: "Zotero information read/write/move must be executed via zotero-mcp. This script only produces ingestion+triage payload.",
  });
  report.steps.med_zotero_bridge = {
    ok: report.steps.connector.ok,
    mcp_required: true,
    pending_writeback: true,
    connector_ok: report.steps.connector.ok,
  };
  report.stage_timings.zotero_writeback = { status: "skipped", reason: "stage_2_script" };
  report.stage_timings.translation = { status: "skipped", reason: "stage_3_script" };
  report.stage_timings.excel_export = { status: "skipped", reason: "stage_4_script" };

  report.steps.skill_alignment = buildSkillAlignmentMatrix({
    feedbackLearning: report.steps.feedback_learning,
    dailyExport: {
      rssCount: report.counts.rss_raw,
      databaseCount: report.counts.db_raw,
      mergedCount: report.counts.merged,
      exportedCount: report.counts.daily_export,
      excludesD: true,
      translationFailuresTracked: false,
    },
    weeklyAssets: { updated: false },
    zoteroWriteback: { mcpOnly: true, tagCleanupUsesWriteTag: true, migrationTracked: true },
  });

  await fs.writeFile(path.join(pipeDir, "rss_items.json"), JSON.stringify(rss.items, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "db_items.json"), JSON.stringify(db.items, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "merged_items.json"), JSON.stringify(merged, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "triaged_items.json"), JSON.stringify(triagedAll, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "triaged_export_items.json"), JSON.stringify(triaged, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "writeback_ready_items.json"), JSON.stringify(writebackReady, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "daily_failed_feeds.json"), JSON.stringify({
    date: dateStr,
    failed_count: rss.failed.length,
    failed_feeds: rss.failed,
  }, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "pending_zotero_writeback.json"), JSON.stringify(report.pending_zotero_writeback, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "run_report.json"), JSON.stringify(report, null, 2), "utf8");

  const desktopJsonPath = path.join(pipeDir, "desktop_daily_review_source.json");
  await fs.writeFile(desktopJsonPath, JSON.stringify({
    date: dateStr,
    triaged: abcAllItems,
    reportContext: {
      feedbackLearning: report.steps.feedback_learning,
      preferenceLearningAudit: preferenceAuditWithImpact,
      translation: report.steps.translation,
      connector: report.steps.connector,
      counts: report.counts,
      failures: report.failures,
      skillAlignment: report.steps.skill_alignment,
    },
  }, null, 2), "utf8");
  report.steps.med_weekly_synthesis = { ok: false, deferred_until: "finalize_research_os_exports" };
  report.stage_timings.total = { status: "completed", ms: Date.now() - totalStarted };
  await fs.writeFile(path.join(pipeDir, "skill_alignment.json"), JSON.stringify(report.steps.skill_alignment, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "run_report.json"), JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({ ok: true, output_dir: pipeDir, counts: report.counts, connector_ok: report.steps.connector.ok }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runResearchOsPipeline().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
