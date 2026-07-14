/**
 * Preference learning audit/report helpers.
 * Kept separate from evidence extraction and cluster synthesis.
 */

function uniq(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function splitList(value) {
  if (Array.isArray(value)) return uniq(value.map((entry) => String(entry).trim()).filter(Boolean));
  return uniq(String(value || "").split(/[|,]/).map((entry) => entry.trim()).filter(Boolean));
}

function normalizeList(value) {
  return uniq((Array.isArray(value) ? value : [value]).flatMap((entry) => splitList(entry)));
}

function buildTriageImpactRows({ triagedItems = [], preferences = [] } = {}) {
  const activePreferences = (preferences || []).filter((entry) => entry.active_for_triage);
  return (triagedItems || []).map((item) => {
    const title = String(item.title || "");
    const titleLc = title.toLowerCase();
    const hits = activePreferences.filter((pref) => normalizeList(pref.key_terms).some((term) => term && titleLc.includes(term.replace(/_/g, " "))));
    const positiveHits = hits.filter((entry) => entry.preference_type === "strong_positive" || entry.preference_type === "soft_positive");
    const negativeHits = hits.filter((entry) => entry.preference_type === "negative_preference" || entry.preference_type === "exclusion_hint");
    return {
      candidate_id: item.itemKey || item.dedupe_key || "",
      english_title: title,
      title_translation: item["标题翻译"] || item["中文标题"] || "",
      baseline_level: null,
      final_level: item.final_grade || item["推荐等级"] || item.grade_label || "",
      preference_impact: "impact_unknown",
      matched_preferences: uniq(hits.map((entry) => entry.cluster_id)).join(" | "),
      positive_preference_hits: positiveHits.length,
      negative_preference_hits: negativeHits.length,
      ambiguity_flags: hits.some((entry) => entry.status === "ambiguous") ? "ambiguous_cluster_present" : "",
      baseline_score: null,
      final_score: null,
      explanation: hits.length ? "matched cluster-level hints; score delta unavailable" : "no direct cluster-level preference match; score delta unavailable",
      score_delta_unavailable: true,
    };
  });
}

export function buildStandardSummary(clusters = [], changeRows = []) {
  const active = clusters.filter((c) => c.status === "stable" || (c.status === "tentative" && Number(c.confidence || 0) >= 0.7));
  const positives = active.filter((c) => c.preference_type === "strong_positive" || c.preference_type === "soft_positive");
  const negatives = active.filter((c) => c.preference_type === "negative_preference" || c.preference_type === "exclusion_hint");
  const ambiguous = clusters.filter((c) => c.status === "ambiguous");
  const oneSentence = active.length
    ? `当前优先关注${positives.length ? "人群临床结局相关证据" : "有明确临床相关性的证据"}，并对${negatives.length ? "低证据/机制或范围外研究降权" : "边界不清证据保持谨慎"}。`
    : "当前稳定筛选标准有限，以下为暂定理解。";
  return {
    summary_version: "v1",
    one_sentence_summary: oneSentence,
    priority_summary: positives.slice(0, 5).map((c) => c.statement).join("；"),
    downrank_summary: negatives.slice(0, 5).map((c) => `${c.statement}${c.caveat ? `（${c.caveat}）` : ""}`).join("；"),
    uncertain_boundaries: ambiguous.slice(0, 5).map((c) => c.statement).join("；"),
    recent_changes: (changeRows || []).slice(0, 5)
      .map((r) => {
        const detail = r?.statement || r?.rationale || r?.cluster_id || "";
        return detail ? `${r.change_type}:${detail}` : "";
      })
      .filter(Boolean)
      .join("；"),
    caveats: negatives.slice(0, 5).map((c) => c.caveat).filter(Boolean).join("；"),
    confidence_summary: `active=${active.length}; ambiguous=${ambiguous.length}`,
    based_on_clusters_count: clusters.length,
    active_clusters_count: active.length,
    tentative_clusters_count: clusters.filter((c) => c.status === "tentative").length,
    ambiguous_clusters_count: ambiguous.length,
  };
}

export function buildPreferenceLearningAudit({
  medQueryLearning = {},
  feedbackLearning = {},
  samples = [],
  refined = {},
  triagedItems = [],
  auditPath = "",
} = {}) {
  const blockers = [];
  if (!medQueryLearning.previous_feedback_file_found) blockers.push("previous_feedback_file_not_found");
  if (medQueryLearning.workbook_unreadable) blockers.push("workbook_unreadable");
  if (!medQueryLearning.workbook_unreadable && (medQueryLearning.detected_headers || []).length > 0 && !medQueryLearning.feedback_column_detected) blockers.push("feedback_column_missing");

  const stats = refined.stats || {};
  const impactRows = buildTriageImpactRows({
    triagedItems,
    preferences: refined.preferences || [],
  });
  const summaryRow = {
    preference_learning_executed: Boolean(medQueryLearning.preference_learning_executed),
    selected_previous_feedback_file: medQueryLearning.selected_previous_feedback_file || "",
    feedback_review_root: medQueryLearning.feedback_review_root || "",
    previous_feedback_sheet_name: medQueryLearning.previous_feedback_sheet_name || "",
    rows_total: Number(medQueryLearning.rows_total || feedbackLearning?.diagnostics?.counts?.total_rows || 0),
    rows_with_feedback: Number(medQueryLearning.rows_with_feedback || 0),
    rows_with_comment: Number(medQueryLearning.rows_with_comment || 0),
    positive_feedback_samples: Number(medQueryLearning.positive_feedback_samples || 0),
    negative_feedback_samples: Number(medQueryLearning.negative_feedback_samples || 0),
    ambiguous_feedback_samples: Number(medQueryLearning.ambiguous_feedback_samples || 0),
    ignored_feedback_samples: Number(medQueryLearning.feedback_samples_ignored || 0),
    evidence_total: Number(stats.evidence_total || 0),
    new_evidence_count: Number(stats.new_evidence_count || 0),
    historical_evidence_count: Number(stats.historical_evidence_count || 0),
    clusters_total: Number(stats.clusters_total || 0),
    clusters_existing_matched: Number(stats.clusters_existing_matched || 0),
    clusters_created: Number(stats.clusters_created || 0),
    clusters_updated: Number(stats.clusters_updated || 0),
    clusters_stable: Number(stats.clusters_stable || 0),
    clusters_tentative: Number(stats.clusters_tentative || 0),
    clusters_ambiguous: Number(stats.clusters_ambiguous || 0),
    clusters_needing_more_feedback: Number(stats.clusters_needing_more_feedback || 0),
    preferences_added: Number(medQueryLearning.preferences_added ?? stats.preferences_added ?? 0),
    preferences_updated: Number(medQueryLearning.preferences_updated ?? stats.preferences_updated ?? 0),
    preferences_reinforced: Number(medQueryLearning.preferences_reinforced ?? stats.preferences_reinforced ?? 0),
    preferences_marked_ambiguous: Number(medQueryLearning.preferences_marked_ambiguous ?? stats.preferences_marked_ambiguous ?? 0),
    preferences_needing_more_feedback: Number(medQueryLearning.preferences_needing_more_feedback ?? stats.preferences_needing_more_feedback ?? 0),
    screening_preference_output_path: "",
    screening_preference_loaded_before_triage: false,
    screening_standards_path: medQueryLearning.screening_standards_path || stats.screening_standards_path || "",
    screening_standards_loaded: Boolean(medQueryLearning.screening_standards_loaded ?? stats.screening_standards_loaded),
    screening_standards_cleaned: Boolean(medQueryLearning.screening_standards_cleaned ?? stats.screening_standards_cleaned),
    screening_standards_primary_rationale_source: Boolean(medQueryLearning.screening_standards_primary_rationale_source ?? stats.screening_standards_primary_rationale_source),
    screening_standards_change_markup_applied: Boolean(medQueryLearning.screening_standards_change_markup_applied),
    screening_standards_additions_count: Number(medQueryLearning.screening_standards_additions_count || 0),
    screening_standards_deletions_count: Number(medQueryLearning.screening_standards_deletions_count || 0),
    screening_standards_docx_path: medQueryLearning.screening_standards_docx_path || "",
    screening_standards_docx_synced: Boolean(medQueryLearning.screening_standards_docx_synced),
    standard_summary_generated: true,
    standard_summary_feedback_read: Boolean(medQueryLearning.standard_summary_feedback_read ?? stats.standard_summary_feedback_read),
    standard_summary_feedback_used: Boolean(medQueryLearning.standard_summary_feedback_used ?? stats.standard_summary_feedback_used),
    standard_summary_feedback_rows: Number(medQueryLearning.standard_summary_feedback_rows ?? stats.standard_summary_feedback_rows ?? 0),
    meta_preference_evidence_count: Number(stats.meta_preference_evidence_count || 0),
    primary_rationale_source: medQueryLearning.primary_rationale_source || stats.primary_rationale_source || "daily_feedback_comment_or_title",
    standard_summary_my_evaluation_rows: Number(medQueryLearning.standard_summary_my_evaluation_rows ?? stats.standard_summary_my_evaluation_rows ?? 0),
    clusters_adjusted_by_summary_feedback: Number(stats.clusters_adjusted_by_summary_feedback || 0),
    clusters_reinforced_by_summary_feedback: Number(stats.clusters_reinforced_by_summary_feedback || 0),
    clusters_weakened_by_summary_feedback: Number(stats.clusters_weakened_by_summary_feedback || 0),
    clusters_scope_narrowed_by_summary_feedback: Number(stats.clusters_scope_narrowed_by_summary_feedback || 0),
    clusters_marked_ambiguous_by_summary_feedback: Number(stats.clusters_marked_ambiguous_by_summary_feedback || 0),
    blockers: blockers.join(" | "),
    degraded_reason: medQueryLearning.degraded_reason || medQueryLearning.semantic_degrade_reason || "",
    clustering_warning: stats.clustering_warning || "",
  };

  const evidenceSource = Array.isArray(refined.store?.evidence) && refined.store.evidence.length
    ? refined.store.evidence
    : samples;
  const evidenceRows = (evidenceSource || []).map((sample) => ({
    evidence_id: sample.evidence_id,
    cluster_id: sample.cluster_id || "",
    cluster_status: refined.clusters?.find((cluster) => cluster.cluster_id === sample.cluster_id)?.status || "",
    cluster_statement: refined.clusters?.find((cluster) => cluster.cluster_id === sample.cluster_id)?.statement || "",
    source_file: sample.source_file || "",
    source_row: sample.source_row,
    feedback: sample.feedback,
    comment: sample.comment,
    title: sample.title_translation || sample.english_title || sample.title_context || "",
    english_title: sample.english_title,
    title_translation: sample.title_translation,
    title_context_source: sample.title_context_source,
    direction: sample.direction,
    confidence: sample.confidence,
    extracted_terms: normalizeList(sample.extracted_terms).join("|"),
    extracted_reason: sample.extracted_reason || "",
    accepted_for_learning: Boolean(sample.accepted_for_learning),
    ignored_reason: sample.ignored_reason || "",
    ambiguous_reason: sample.ambiguous_reason || "",
    comment_empty: Boolean(sample.comment_empty),
    title_translation_missing: Boolean(sample.title_translation_missing),
  }));

  const summaryChangeRows = (refined.summary_change_log || []).map((row) => ({ ...row }));
  const changeRows = [
    ...(refined.cluster_changes || []).map((row) => ({ ...row })),
    ...summaryChangeRows.map((row) => ({
      cluster_id: row.cluster_id,
      preference_id: "",
      change_type: row.change_type,
      preference_type: "",
      status: row.after_status,
      statement: row.rationale,
      confidence_before: row.before_confidence,
      confidence_after: row.after_confidence,
      evidence_count: "",
      positive_evidence_count: "",
      negative_evidence_count: "",
      rationale: row.rationale,
      caveat: row.after_caveat || "",
      meta_evidence_id: row.meta_evidence_id,
      before_status: row.before_status,
      after_status: row.after_status,
      before_caveat: row.before_caveat,
      after_caveat: row.after_caveat,
    })),
  ];
  const currentStandardSummary = buildStandardSummary(refined.clusters || [], changeRows);
  const warnings = uniq([...(stats.warnings || []), ...blockers]);

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    selected_previous_feedback_file: medQueryLearning.selected_previous_feedback_file || "",
    summary: summaryRow,
    samples: evidenceRows,
    store: refined.store || { preferences: refined.preferences || [], evidence: samples || [], clusters: refined.clusters || [] },
    clusters: refined.clusters || [],
    cluster_changes: changeRows,
    preference_changes: changeRows,
    triage_impact: impactRows,
    blockers,
    warnings,
    standard_summary_generated: true,
    standard_summary_path: medQueryLearning.standard_summary_path || "",
    standard_summary_sheet: "当前筛选标准摘要",
    screening_preference_output_path: "",
    screening_preference_loaded_before_triage: false,
    screening_standards_path: medQueryLearning.screening_standards_path || stats.screening_standards_path || "",
    screening_standards_loaded: Boolean(medQueryLearning.screening_standards_loaded ?? stats.screening_standards_loaded),
    screening_standards_cleaned: Boolean(medQueryLearning.screening_standards_cleaned ?? stats.screening_standards_cleaned),
    screening_standards_primary_rationale_source: Boolean(medQueryLearning.screening_standards_primary_rationale_source ?? stats.screening_standards_primary_rationale_source),
    screening_standards_change_markup_applied: Boolean(medQueryLearning.screening_standards_change_markup_applied),
    screening_standards_additions_count: Number(medQueryLearning.screening_standards_additions_count || 0),
    screening_standards_deletions_count: Number(medQueryLearning.screening_standards_deletions_count || 0),
    screening_standards_docx_path: medQueryLearning.screening_standards_docx_path || "",
    screening_standards_docx_synced: Boolean(medQueryLearning.screening_standards_docx_synced),
    standard_summary_feedback_read: Boolean(medQueryLearning.standard_summary_feedback_read),
    standard_summary_feedback_used: Boolean(medQueryLearning.standard_summary_feedback_used),
    standard_summary_feedback_rows: Number(medQueryLearning.standard_summary_feedback_rows || 0),
    meta_preference_evidence_count: Number(medQueryLearning.meta_preference_evidence_count || refined.store?.meta_preference_evidence?.length || 0),
    primary_rationale_source: medQueryLearning.primary_rationale_source || stats.primary_rationale_source || "daily_feedback_comment_or_title",
    standard_summary_my_evaluation_rows: Number(medQueryLearning.standard_summary_my_evaluation_rows || stats.standard_summary_my_evaluation_rows || 0),
    meta_preference_evidence: refined.store?.meta_preference_evidence || [],
    global_meta_feedback_count: Number(stats.global_meta_feedback_count || 0),
    clusters_reinforced_by_summary_feedback: Number(stats.clusters_reinforced_by_summary_feedback || 0),
    clusters_weakened_by_summary_feedback: Number(stats.clusters_weakened_by_summary_feedback || 0),
    clusters_scope_narrowed_by_summary_feedback: Number(stats.clusters_scope_narrowed_by_summary_feedback || 0),
    clusters_scope_broadened_by_summary_feedback: Number(stats.clusters_scope_broadened_by_summary_feedback || 0),
    clusters_marked_ambiguous_by_summary_feedback: Number(stats.clusters_marked_ambiguous_by_summary_feedback || 0),
    clusters_retired_by_summary_feedback: Number(stats.clusters_retired_by_summary_feedback || 0),
    summary_feedback_mapping_failures: Number(stats.summary_feedback_mapping_failures || 0),
    standard_summary_sheet_schema: "zh_two_column",
    summary_change_log: summaryChangeRows,
    clusters_adjusted_by_summary_feedback: Number(medQueryLearning.clusters_adjusted_by_summary_feedback || stats.clusters_adjusted_by_summary_feedback || 0),
    clusters_weakened_by_summary_feedback: Number(medQueryLearning.clusters_weakened_by_summary_feedback || stats.clusters_weakened_by_summary_feedback || 0),
    clusters_scope_narrowed_by_summary_feedback: Number(medQueryLearning.clusters_scope_narrowed_by_summary_feedback || stats.clusters_scope_narrowed_by_summary_feedback || 0),
    clusters_scope_broadened_by_summary_feedback: Number(medQueryLearning.clusters_scope_broadened_by_summary_feedback || stats.clusters_scope_broadened_by_summary_feedback || 0),
    clusters_marked_ambiguous_by_summary_feedback: Number(medQueryLearning.clusters_marked_ambiguous_by_summary_feedback || stats.clusters_marked_ambiguous_by_summary_feedback || 0),
    current_standard_summary: currentStandardSummary,
    detected_headers: medQueryLearning.previous_feedback_headers || medQueryLearning.detected_headers || [],
    expected_feedback_aliases: ["feedback", "Feedback", "反馈", "用户反馈"],
    expected_comment_aliases: ["comment", "Comment", "备注", "评价备注"],
    missing_columns: medQueryLearning.missing_columns || [],
    degraded_reason: summaryRow.degraded_reason || null,
    evidence_total: Number(stats.evidence_total || 0),
    evidence_positive: Number(stats.evidence_positive || 0),
    evidence_negative: Number(stats.evidence_negative || 0),
    evidence_ambiguous: Number(stats.evidence_ambiguous || 0),
    evidence_ignored: Number(stats.evidence_ignored || 0),
    new_evidence_count: Number(stats.new_evidence_count || 0),
    historical_evidence_count: Number(stats.historical_evidence_count || 0),
    clusters_total: Number(stats.clusters_total || 0),
    clusters_existing_matched: Number(stats.clusters_existing_matched || 0),
    clusters_created: Number(stats.clusters_created || 0),
    clusters_updated: Number(stats.clusters_updated || 0),
    clusters_stable: Number(stats.clusters_stable || 0),
    clusters_tentative: Number(stats.clusters_tentative || 0),
    clusters_ambiguous: Number(stats.clusters_ambiguous || 0),
    clusters_needing_more_feedback: Number(stats.clusters_needing_more_feedback || 0),
    preferences_added: Number(summaryRow.preferences_added || 0),
    preferences_updated: Number(summaryRow.preferences_updated || 0),
    preferences_reinforced: Number(summaryRow.preferences_reinforced || 0),
    preferences_marked_ambiguous: Number(summaryRow.preferences_marked_ambiguous || 0),
    preferences_needing_more_feedback: Number(summaryRow.preferences_needing_more_feedback || 0),
    evidence_to_cluster_map: refined.evidence_to_cluster_map || [],
    sheets: {
      summary: [summaryRow],
      evidence: evidenceRows,
      changes: changeRows,
      impact: impactRows,
      standard_summary: [{
        "当前筛选标准": [
          currentStandardSummary.one_sentence_summary,
          currentStandardSummary.priority_summary ? `优先关注：${currentStandardSummary.priority_summary}` : "",
          currentStandardSummary.downrank_summary ? `相对降权：${currentStandardSummary.downrank_summary}` : "",
          currentStandardSummary.uncertain_boundaries ? `不确定边界：${currentStandardSummary.uncertain_boundaries}` : "",
          currentStandardSummary.caveats ? `注意：${currentStandardSummary.caveats}` : "",
        ].filter(Boolean).join("\n"),
        "我的评价": "",
      }],
    },
    preference_learning_audit_path: auditPath,
    triage_impact_available: false,
    score_delta_available: false,
  };
}
