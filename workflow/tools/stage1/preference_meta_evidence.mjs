/**
 * Meta preference evidence extraction and application.
 *
 * This module handles summary-level feedback signals (e.g., from
 * screening_standards.docx evaluation area) and applies them to
 * existing preference clusters.
 */

import { clamp, uniq, normalizeList, stableHash, nowIso } from "./preference_utils.mjs";

function tokenizeForMatch(text = "") {
  const lowered = String(text || "").toLowerCase();
  const english = lowered.match(/[a-z0-9_-]{3,}/g) || [];
  const chinese = String(text || "").match(/[\u4e00-\u9fff]{2,8}/g) || [];
  return uniq([...english, ...chinese]);
}

export { tokenizeForMatch };

export function normalizeSummaryFeedback(value = "") {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();
  const aliasMap = new Map([
    ["准确", "accurate"], ["accurate", "accurate"],
    ["太宽泛", "too_broad"], ["too_broad", "too_broad"],
    ["太窄", "too_narrow"], ["too_narrow", "too_narrow"],
    ["重点错了", "wrong_focus"], ["wrong_focus", "wrong_focus"],
    ["缺少重点", "missing_priority"], ["missing_priority", "missing_priority"],
    ["过度排除", "over_excluding"], ["over_excluding", "over_excluding"],
    ["排除不足", "under_excluding"], ["under_excluding", "under_excluding"],
    ["需要更偏临床", "needs_more_clinical_focus"], ["needs_more_clinical_focus", "needs_more_clinical_focus"],
    ["其他", "other"], ["other", "other"],
  ]);
  const exact = aliasMap.get(raw) || aliasMap.get(lower);
  if (exact) return exact;
  if (/太宽泛|过于宽泛|范围太大|too\s*broad/.test(raw)) return "too_broad";
  if (/太窄|漏掉了|范围太小|too\s*narrow/.test(raw)) return "too_narrow";
  if (/重点不对|关注错了|重点错了|wrong\s*focus/.test(raw)) return "wrong_focus";
  if (/缺少重点|应该更关注|missing\s*priority/.test(raw)) return "missing_priority";
  if (/过度排除|不要一概排除|不[要能]一概排除|over[-_\s]*excluding/.test(raw)) return "over_excluding";
  if (/排除不足|应该排除更多|under[-_\s]*excluding/.test(raw)) return "under_excluding";
  if (/更偏临床|更关注临床结局|临床结局|needs_more_clinical_focus/.test(raw)) return "needs_more_clinical_focus";
  if (/可以|准确|基本正确|没问题|accurate/.test(raw)) return "accurate";
  return raw ? "other" : "";
}

export function chooseCorrectionDirection(issueType) {
  if (issueType === "accurate") return "reinforce";
  if (issueType === "too_broad") return "narrow_scope";
  if (issueType === "too_narrow") return "broaden_scope";
  if (issueType === "wrong_focus") return "weaken";
  if (issueType === "missing_priority") return "needs_more_feedback";
  if (issueType === "over_excluding") return "add_caveat";
  if (issueType === "under_excluding") return "reinforce";
  if (issueType === "needs_more_clinical_focus") return "reinforce";
  return "needs_more_feedback";
}

export function chooseAffectedSummarySection(signal = {}) {
  if (signal.source_section) return signal.source_section;
  const issue = normalizeSummaryFeedback(signal.user_feedback_on_summary || signal.inferred_issue_type || signal.user_evaluation_text);
  if (["over_excluding", "under_excluding"].includes(issue)) return "current_downrank_summary";
  if (["wrong_focus", "missing_priority", "needs_more_clinical_focus", "too_narrow"].includes(issue)) return "current_priority_summary";
  if (issue === "too_broad") return "caveats";
  return "one_sentence_summary";
}

export function pickCandidateClusters(clusters = [], affectedSection = "") {
  if (affectedSection === "current_priority_summary") return clusters.filter((c) => ["strong_positive", "soft_positive"].includes(c.preference_type) || c.active_for_triage);
  if (affectedSection === "current_downrank_summary") return clusters.filter((c) => ["negative_preference", "exclusion_hint"].includes(c.preference_type));
  if (affectedSection === "uncertain_boundaries") return clusters.filter((c) => ["ambiguous", "needs_more_feedback"].includes(c.status));
  if (affectedSection === "caveats") return clusters.filter((c) => c.caveat);
  return clusters.filter((c) => c.active_for_triage || c.status === "stable");
}

export function scoreClusterMatch(cluster, tokens = []) {
  if (!tokens.length) return 0;
  const haystack = tokenizeForMatch([
    cluster.statement,
    cluster.rationale,
    cluster.caveat,
    normalizeList(cluster.key_terms).join(" "),
    normalizeList(cluster.representative_titles).join(" "),
    normalizeList(cluster.representative_comments).join(" "),
  ].join(" "));
  return tokens.filter((token) => haystack.includes(token)).length;
}

export function buildMetaEvidenceId(signal = {}) {
  return `meta-${stableHash([
    signal.source_file,
    signal.source_row,
    signal.standard_summary_text,
    signal.user_evaluation_text,
    signal.user_feedback_on_summary,
    signal.user_comment_on_summary,
    signal.user_correction_hint,
  ].join("|"))}`;
}

export function buildMetaPreferenceEvidence(signal, clusters = [], generatedAt) {
  const userEvaluationText = String(signal.user_evaluation_text || signal.user_comment_on_summary || signal.user_correction_hint || "").trim();
  const standardSummaryText = String(signal.standard_summary_text || [
    signal.one_sentence_summary,
    signal.current_priority_summary,
    signal.current_downrank_summary,
    signal.uncertain_boundaries,
    signal.caveats,
  ].filter(Boolean).join(" | ") || "").trim();
  const issueType = normalizeSummaryFeedback(signal.user_feedback_on_summary || signal.inferred_issue_type || userEvaluationText);
  const affectedSummarySection = chooseAffectedSummarySection({ ...signal, user_evaluation_text: userEvaluationText });
  let candidateClusters = pickCandidateClusters(clusters, affectedSummarySection);
  if (issueType === "needs_more_clinical_focus") {
    candidateClusters = clusters.filter((cluster) => {
      const terms = normalizeList(cluster.key_terms);
      return ["strong_positive", "soft_positive", "negative_preference", "exclusion_hint"].includes(cluster.preference_type)
        || terms.some((term) => ["clinical_outcome", "human_outcome", "randomized_trial", "meta_analysis", "cohort", "animal_only", "basic_mechanism_only", "in_vitro_only"].includes(term));
    });
  }
  const matchTokens = tokenizeForMatch([
    standardSummaryText,
    userEvaluationText,
    signal.user_comment_on_summary,
    signal.user_correction_hint,
    signal.current_priority_summary,
    signal.current_downrank_summary,
    signal.uncertain_boundaries,
    signal.caveats,
  ].join(" "));
  const scored = candidateClusters.map((cluster) => ({ cluster, score: scoreClusterMatch(cluster, matchTokens) }))
    .filter((entry) => entry.score > 0);
  const selected = (scored.length ? scored : candidateClusters.slice(0, issueType === "accurate" ? 3 : 2).map((cluster) => ({ cluster, score: 0 })))
    .filter((entry) => {
      if (issueType === "over_excluding") return ["negative_preference", "exclusion_hint"].includes(entry.cluster.preference_type);
      if (issueType === "needs_more_clinical_focus") return true;
      return true;
    })
    .slice(0, 4)
    .map((entry) => entry.cluster);
  const isGlobal = selected.length === 0 || issueType === "other" && scored.length === 0;
  const acceptedForLearning = Boolean(issueType) && (issueType !== "other" || scored.length > 0);
  return {
    meta_evidence_id: buildMetaEvidenceId(signal),
    source_file: signal.source_file || "",
    source_sheet: signal.source_sheet || "当前筛选标准摘要",
    source_row: Number(signal.source_row || 0),
    source_section: signal.source_section || "",
    standard_summary_text: standardSummaryText,
    user_evaluation_text: userEvaluationText,
    user_feedback_on_summary: issueType,
    user_comment_on_summary: String(signal.user_comment_on_summary || userEvaluationText || "").trim(),
    user_correction_hint: String(signal.user_correction_hint || "").trim(),
    affected_summary_section: affectedSummarySection,
    inferred_issue_type: issueType || "other",
    target_cluster_ids: isGlobal ? [] : selected.map((cluster) => cluster.cluster_id),
    target_reason_categories: uniq(selected.flatMap((cluster) => normalizeList(cluster.key_terms)).slice(0, 8)),
    target_scope: uniq(selected.flatMap((cluster) => normalizeList(cluster.key_terms)).slice(0, 6)).join("|"),
    correction_direction: chooseCorrectionDirection(issueType || "other"),
    confidence: clamp(Number((acceptedForLearning ? 0.66 + Math.min(0.16, scored.length * 0.05) : 0.32).toFixed(2)), 0.2, 0.9),
    accepted_for_learning: acceptedForLearning,
    blocker: acceptedForLearning ? "" : "global_meta_feedback_unmapped",
    created_at: nowIso(generatedAt),
    global_meta_feedback: isGlobal,
  };
}

export function applyMetaPreferenceEvidence(clusters = [], metaEvidence = [], generatedAt) {
  const clusterById = new Map(clusters.map((cluster) => [cluster.cluster_id, cluster]));
  const changeLog = [];
  const stats = {
    global_meta_feedback_count: 0,
    clusters_adjusted_by_summary_feedback: 0,
    clusters_reinforced_by_summary_feedback: 0,
    clusters_weakened_by_summary_feedback: 0,
    clusters_scope_narrowed_by_summary_feedback: 0,
    clusters_scope_broadened_by_summary_feedback: 0,
    clusters_marked_ambiguous_by_summary_feedback: 0,
    clusters_retired_by_summary_feedback: 0,
    summary_feedback_mapping_failures: 0,
  };

  for (const evidence of metaEvidence) {
    if (!evidence.accepted_for_learning || evidence.global_meta_feedback || !evidence.target_cluster_ids.length) {
      if (evidence.global_meta_feedback) stats.global_meta_feedback_count += 1;
      if (!evidence.target_cluster_ids.length) stats.summary_feedback_mapping_failures += 1;
      changeLog.push({
        cluster_id: "",
        change_type: "unchanged_global_feedback",
        before_confidence: null,
        after_confidence: null,
        before_status: "",
        after_status: "",
        before_caveat: "",
        after_caveat: "",
        meta_evidence_id: evidence.meta_evidence_id,
        rationale: evidence.blocker || "global_meta_feedback",
      });
      continue;
    }

    for (const clusterId of evidence.target_cluster_ids) {
      const cluster = clusterById.get(clusterId);
      if (!cluster) {
        stats.summary_feedback_mapping_failures += 1;
        continue;
      }
      const before = {
        confidence: Number(cluster.confidence || 0),
        status: cluster.status || "",
        caveat: cluster.caveat || "",
      };
      cluster.summary_feedback_count = Number(cluster.summary_feedback_count || 0) + 1;
      cluster.last_summary_feedback_at = nowIso(generatedAt);
      let changeType = "unchanged_global_feedback";

      if (evidence.inferred_issue_type === "accurate") {
        cluster.reinforced_count = Number(cluster.reinforced_count || 0) + 1;
        cluster.confidence = clamp(Number((cluster.confidence + 0.04).toFixed(2)), 0.05, 0.95);
        changeType = "summary_reinforced";
        stats.clusters_reinforced_by_summary_feedback += 1;
      } else if (evidence.inferred_issue_type === "too_broad") {
        cluster.weakened_count = Number(cluster.weakened_count || 0) + 1;
        cluster.contradiction_count = Number(cluster.contradiction_count || 0) + 1;
        cluster.confidence = clamp(Number((cluster.confidence - 0.12).toFixed(2)), 0.05, 0.95);
        cluster.caveat = cluster.caveat || "Summary feedback asked to narrow scope before strong triage use";
        if (cluster.status === "stable") cluster.status = "tentative";
        else cluster.status = "needs_more_feedback";
        changeType = "scope_narrowed";
        stats.clusters_scope_narrowed_by_summary_feedback += 1;
        stats.clusters_weakened_by_summary_feedback += 1;
      } else if (evidence.inferred_issue_type === "too_narrow") {
        cluster.confidence = clamp(Number((cluster.confidence + (cluster.evidence_count >= 2 ? 0.03 : -0.03)).toFixed(2)), 0.05, 0.95);
        if (cluster.evidence_count < 2) cluster.status = "needs_more_feedback";
        changeType = "scope_broadened";
        stats.clusters_scope_broadened_by_summary_feedback += 1;
      } else if (evidence.inferred_issue_type === "wrong_focus") {
        cluster.weakened_count = Number(cluster.weakened_count || 0) + 1;
        cluster.contradiction_count = Number(cluster.contradiction_count || 0) + 1;
        cluster.confidence = clamp(Number((cluster.confidence - 0.1).toFixed(2)), 0.05, 0.95);
        cluster.status = cluster.contradiction_count >= 2 ? "ambiguous" : "tentative";
        changeType = cluster.status === "ambiguous" ? "marked_ambiguous" : "summary_weakened";
        stats.clusters_weakened_by_summary_feedback += 1;
        if (cluster.status === "ambiguous") stats.clusters_marked_ambiguous_by_summary_feedback += 1;
      } else if (evidence.inferred_issue_type === "missing_priority") {
        cluster.status = "needs_more_feedback";
        changeType = "marked_needs_more_feedback";
      } else if (evidence.inferred_issue_type === "over_excluding") {
        cluster.weakened_count = Number(cluster.weakened_count || 0) + 1;
        cluster.contradiction_count = Number(cluster.contradiction_count || 0) + 1;
        cluster.confidence = clamp(Number((cluster.confidence - 0.08).toFixed(2)), 0.05, 0.95);
        cluster.caveat = cluster.caveat || "Summary feedback requested narrower exclusion boundary";
        if (cluster.preference_type === "negative_preference" || cluster.preference_type === "exclusion_hint") {
          changeType = "caveat_added";
        } else {
          changeType = "summary_weakened";
        }
        stats.clusters_weakened_by_summary_feedback += 1;
        stats.clusters_scope_narrowed_by_summary_feedback += 1;
      } else if (evidence.inferred_issue_type === "under_excluding") {
        cluster.reinforced_count = Number(cluster.reinforced_count || 0) + 1;
        cluster.confidence = clamp(Number((cluster.confidence + (cluster.evidence_count >= 2 ? 0.03 : 0)).toFixed(2)), 0.05, 0.95);
        if (cluster.evidence_count < 2) cluster.status = "needs_more_feedback";
        changeType = cluster.evidence_count >= 2 ? "summary_reinforced" : "marked_needs_more_feedback";
        if (cluster.evidence_count >= 2) stats.clusters_reinforced_by_summary_feedback += 1;
      } else if (evidence.inferred_issue_type === "needs_more_clinical_focus") {
        const clinicalCluster = cluster.preference_type === "strong_positive" || cluster.preference_type === "soft_positive";
        const mechanismCluster = ["negative_preference", "exclusion_hint"].includes(cluster.preference_type);
        if (clinicalCluster && (cluster.key_terms || []).some((term) => ["clinical_outcome", "human_outcome", "randomized_trial", "meta_analysis", "cohort"].includes(term))) {
          cluster.reinforced_count = Number(cluster.reinforced_count || 0) + 1;
          cluster.confidence = clamp(Number((cluster.confidence + 0.05).toFixed(2)), 0.05, 0.95);
          changeType = "summary_reinforced";
          stats.clusters_reinforced_by_summary_feedback += 1;
        } else if (mechanismCluster) {
          cluster.weakened_count = Number(cluster.weakened_count || 0) + 1;
          cluster.confidence = clamp(Number((cluster.confidence - 0.06).toFixed(2)), 0.05, 0.95);
          cluster.caveat = cluster.caveat || "Prefer mechanism-related exclusions only within explicit low-clinical-relevance contexts";
          changeType = "caveat_added";
          stats.clusters_weakened_by_summary_feedback += 1;
        } else {
          cluster.status = "needs_more_feedback";
          changeType = "marked_needs_more_feedback";
        }
      } else if (evidence.inferred_issue_type === "other") {
        changeType = "split_suggested";
      }

      if (cluster.weakened_count >= 2 && cluster.confidence < 0.55 && cluster.status === "stable") cluster.status = "tentative";
      if (cluster.contradiction_count >= 2 && cluster.status !== "needs_more_feedback") cluster.status = "ambiguous";
      if (cluster.contradiction_count >= 3 && cluster.weakened_count >= 3) {
        cluster.retired = true;
        cluster.status = "needs_more_feedback";
        changeType = "retired";
        stats.clusters_retired_by_summary_feedback += 1;
      }

      changeLog.push({
        cluster_id: cluster.cluster_id,
        change_type: changeType,
        before_confidence: before.confidence,
        after_confidence: cluster.confidence,
        before_status: before.status,
        after_status: cluster.status,
        before_caveat: before.caveat,
        after_caveat: cluster.caveat,
        meta_evidence_id: evidence.meta_evidence_id,
        rationale: evidence.user_evaluation_text || evidence.user_comment_on_summary || evidence.user_correction_hint || evidence.user_feedback_on_summary,
      });
      stats.clusters_adjusted_by_summary_feedback += 1;
    }
  }

  return { clusters: Array.from(clusterById.values()), stats, changeLog };
}
