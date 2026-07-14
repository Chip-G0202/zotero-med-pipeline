// preference_store_sheets.mjs
// Logic for building preference store sheets (preferences, evidence, clusters, meta_preference_evidence).

import { normalizeList } from "./preference_utils.mjs";

// ─── Helper Functions ────────────────────────────────────────────────

function createEmptyStore() {
  return {
    loaded: true,
    source: "empty_initialized",
    warnings: [],
    preferences: [],
    evidence: [],
    clusters: [],
    meta_preference_evidence: [],
  };
}

export function normalizeExistingStore(existingStore = {}, options = {}) {
  if (existingStore && (Array.isArray(existingStore.clusters) || Array.isArray(existingStore.preferences) || Array.isArray(existingStore.evidence))) {
    return {
      loaded: existingStore.loaded !== false,
      source: existingStore.source || "in_memory",
      warnings: Array.isArray(existingStore.warnings) ? [...existingStore.warnings] : [],
      preferences: Array.isArray(existingStore.preferences) ? existingStore.preferences.map((entry) => ({ ...entry })) : [],
      evidence: Array.isArray(existingStore.evidence) ? existingStore.evidence.map((entry) => ({ ...entry })) : [],
      clusters: Array.isArray(existingStore.clusters) ? existingStore.clusters.map((entry) => ({ ...entry })) : [],
      meta_preference_evidence: Array.isArray(existingStore.meta_preference_evidence) ? existingStore.meta_preference_evidence.map((entry) => ({ ...entry })) : [],
    };
  }
  return createEmptyStore();
}

// ─── Exported Functions ──────────────────────────────────────────────

export function buildPreferenceStoreSheets(store = {}, generatedAt = "") {
  const safeStore = normalizeExistingStore(store);
  return {
    preferences: {
      headers: [
        "preference_id", "cluster_id", "preference_type", "status", "statement", "rationale", "confidence",
        "evidence_count", "positive_evidence_count", "negative_evidence_count", "positive_evidence_weight", "negative_evidence_weight", "active_for_triage",
        "reinforced_count", "weakened_count", "contradiction_count", "summary_feedback_count", "last_summary_feedback_at", "retired",
        "source_rows", "evidence_ids", "representative_titles", "representative_comments", "key_terms",
        "caveat", "created_at", "updated_at", "last_seen_at",
      ],
      rows: safeStore.preferences.map((entry) => ({
        preference_id: entry.preference_id,
        cluster_id: entry.cluster_id,
        preference_type: entry.preference_type,
        status: entry.status,
        statement: entry.statement,
        rationale: entry.rationale,
        confidence: entry.confidence,
        evidence_count: entry.evidence_count,
        positive_evidence_count: entry.positive_evidence_count,
        negative_evidence_count: entry.negative_evidence_count,
        positive_evidence_weight: Number(entry.positive_evidence_weight || 0),
        negative_evidence_weight: Number(entry.negative_evidence_weight || 0),
        active_for_triage: entry.active_for_triage,
        reinforced_count: Number(entry.reinforced_count || 0),
        weakened_count: Number(entry.weakened_count || 0),
        contradiction_count: Number(entry.contradiction_count || 0),
        summary_feedback_count: Number(entry.summary_feedback_count || 0),
        last_summary_feedback_at: entry.last_summary_feedback_at || "",
        retired: Boolean(entry.retired),
        source_rows: normalizeList(entry.source_rows).join("|"),
        evidence_ids: normalizeList(entry.evidence_ids).join("|"),
        representative_titles: normalizeList(entry.representative_titles).join("|"),
        representative_comments: normalizeList(entry.representative_comments).join("|"),
        key_terms: normalizeList(entry.key_terms).join("|"),
        caveat: entry.caveat,
        created_at: entry.created_at,
        updated_at: entry.updated_at || generatedAt,
        last_seen_at: entry.last_seen_at || generatedAt,
      })),
    },
    meta_preference_evidence: {
      headers: [
        "meta_evidence_id", "source_file", "source_sheet", "source_row", "standard_summary_text", "user_evaluation_text",
        "inferred_issue_type", "target_cluster_ids", "correction_direction", "confidence", "accepted_for_learning", "blocker", "created_at",
        "source_section", "user_feedback_on_summary", "user_comment_on_summary", "user_correction_hint", "affected_summary_section",
        "target_reason_categories", "target_scope",
      ],
      rows: (safeStore.meta_preference_evidence || []).map((entry) => ({
        meta_evidence_id: entry.meta_evidence_id || "",
        source_file: entry.source_file || "",
        source_sheet: entry.source_sheet || "当前筛选标准摘要",
        source_row: Number(entry.source_row || 0),
        standard_summary_text: entry.standard_summary_text || "",
        user_evaluation_text: entry.user_evaluation_text || "",
        inferred_issue_type: entry.inferred_issue_type || "other",
        target_cluster_ids: normalizeList(entry.target_cluster_ids).join("|"),
        correction_direction: entry.correction_direction || "needs_more_feedback",
        confidence: Number(entry.confidence || 0),
        accepted_for_learning: Boolean(entry.accepted_for_learning),
        blocker: entry.blocker || "",
        created_at: entry.created_at || generatedAt,
        source_section: entry.source_section || "",
        user_feedback_on_summary: entry.user_feedback_on_summary || "",
        user_comment_on_summary: entry.user_comment_on_summary || "",
        user_correction_hint: entry.user_correction_hint || "",
        affected_summary_section: entry.affected_summary_section || "",
        target_reason_categories: normalizeList(entry.target_reason_categories).join("|"),
        target_scope: entry.target_scope || "",
      })),
    },
    evidence: {
      headers: [
        "evidence_id", "cluster_id", "source_file", "source_row", "feedback", "comment", "english_title", "title_translation",
        "title_context_source", "direction", "feedback_strength", "feedback_weight", "confidence", "accepted_for_learning", "ignored_reason", "ambiguous_reason",
        "created_at", "extracted_terms", "extracted_reason", "comment_empty", "title_translation_missing",
      ],
      rows: safeStore.evidence.map((entry) => ({
        evidence_id: entry.evidence_id,
        cluster_id: entry.cluster_id || "",
        source_file: entry.source_file,
        source_row: entry.source_row,
        feedback: entry.feedback,
        comment: entry.comment,
        english_title: entry.english_title,
        title_translation: entry.title_translation,
        title_context_source: entry.title_context_source || "",
        direction: entry.direction,
        feedback_strength: entry.feedback_strength || "",
        feedback_weight: Number(entry.feedback_weight || 0),
        confidence: entry.confidence,
        accepted_for_learning: entry.accepted_for_learning,
        ignored_reason: entry.ignored_reason || "",
        ambiguous_reason: entry.ambiguous_reason || "",
        created_at: entry.created_at,
        extracted_terms: normalizeList(entry.extracted_terms).join("|"),
        extracted_reason: entry.extracted_reason || "",
        comment_empty: Boolean(entry.comment_empty),
        title_translation_missing: Boolean(entry.title_translation_missing),
      })),
    },
    ambiguous: {
      headers: [
        "cluster_id", "statement", "status", "reason", "positive_evidence_count", "negative_evidence_count",
        "evidence_count", "caveat", "source_rows",
      ],
      rows: safeStore.clusters
        .filter((entry) => entry.status === "ambiguous" || entry.status === "needs_more_feedback")
        .map((entry) => ({
          cluster_id: entry.cluster_id,
          statement: entry.statement,
          status: entry.status,
          reason: entry.status === "ambiguous" ? "conflicting_feedback" : "needs_more_feedback",
          positive_evidence_count: entry.positive_evidence_count,
          negative_evidence_count: entry.negative_evidence_count,
          evidence_count: entry.evidence_count,
          caveat: entry.caveat,
          source_rows: normalizeList(entry.source_rows).join("|"),
        })),
    },
  };
}
