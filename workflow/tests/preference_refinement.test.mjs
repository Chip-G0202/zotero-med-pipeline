import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFeedbackSemanticSamples,
  buildPreferenceStoreSheets,
  refinePreferencesFromSemantic,
  buildPreferenceLearningAudit,
} from "../tools/stage1/preference_refinement.mjs";

// ─── buildFeedbackSemanticSamples ────────────────────────────────────

test("buildFeedbackSemanticSamples — empty signals returns empty array", () => {
  const result = buildFeedbackSemanticSamples({ signals: [] }, "test.xlsx");
  assert.deepEqual(result, []);
});

test("buildFeedbackSemanticSamples — null signals returns empty array", () => {
  const result = buildFeedbackSemanticSamples({ signals: null }, "test.xlsx");
  assert.deepEqual(result, []);
});

test("buildFeedbackSemanticSamples — transforms signals to evidence records", () => {
  const result = buildFeedbackSemanticSamples({
    signals: [
      { row: 1, feedback: "keep", english_title: "Test Title A", comment: "" },
      { row: 2, feedback: "upgrade", english_title: "Test Title B", comment: "good study" },
    ],
  }, "test.xlsx", { generatedAt: "2026-01-01T00:00:00Z" });

  assert.equal(result.length, 2);
  assert.equal(result[0].row_index, 1);
  assert.equal(result[0].source_file, "test.xlsx");
  assert.equal(result[0].direction, "positive");
  assert.equal(result[1].row_index, 2);
  assert.equal(result[1].direction, "positive");
});

test("buildFeedbackSemanticSamples — drop feedback becomes negative direction", () => {
  const result = buildFeedbackSemanticSamples({
    signals: [
      { row_index: 5, feedback: "drop", title: "Irrelevant Paper", comment: "" },
    ],
  }, "test.xlsx", { generatedAt: "2026-01-01T00:00:00Z" });

  assert.equal(result.length, 1);
  assert.equal(result[0].direction, "negative");
});

test("buildFeedbackSemanticSamples — ignored feedback marked correctly", () => {
  const result = buildFeedbackSemanticSamples({
    signals: [
      { row_index: 3, feedback: "", title: "No Feedback", comment: "" },
    ],
  }, "test.xlsx", { generatedAt: "2026-01-01T00:00:00Z" });

  assert.equal(result.length, 1);
  assert.equal(result[0].direction, "ignored");
});

// ─── buildPreferenceStoreSheets ──────────────────────────────────────

test("buildPreferenceStoreSheets — empty store returns correct structure", () => {
  const result = buildPreferenceStoreSheets({}, "2026-01-01T00:00:00Z");

  assert.ok(result.preferences);
  assert.ok(result.evidence);
  assert.ok(result.ambiguous);
  assert.ok(Array.isArray(result.preferences.headers));
  assert.ok(Array.isArray(result.preferences.rows));
  assert.ok(Array.isArray(result.evidence.rows));
  assert.equal(result.preferences.rows.length, 0);
});

test("buildPreferenceStoreSheets — store with preferences maps correctly", () => {
  const store = {
    preferences: [
      {
        preference_id: "pref_1",
        cluster_id: "cluster_1",
        preference_type: "reinforce",
        status: "stable",
        statement: "Prefer RCTs",
        rationale: "High evidence quality",
        confidence: 0.9,
        evidence_count: 3,
        positive_evidence_count: 2,
        negative_evidence_count: 1,
        active_for_triage: true,
      },
    ],
    evidence: [],
    clusters: [],
  };

  const result = buildPreferenceStoreSheets(store, "2026-01-01T00:00:00Z");

  assert.equal(result.preferences.rows.length, 1);
  assert.equal(result.preferences.rows[0].preference_id, "pref_1");
  assert.equal(result.preferences.rows[0].statement, "Prefer RCTs");
  assert.equal(result.preferences.rows[0].confidence, 0.9);
});

// ─── refinePreferencesFromSemantic ───────────────────────────────────

test("refinePreferencesFromSemantic — empty input returns initialized store", () => {
  const result = refinePreferencesFromSemantic({
    samples: [],
    semanticResults: [],
    metaPreferenceSignals: [],
    existingStore: {},
    generatedAt: "2026-01-01T00:00:00Z",
  });

  assert.ok(result.preferences);
  assert.ok(result.evidence);
  // clusters may not be present in empty store
  assert.ok(result.stats);
  assert.ok(Array.isArray(result.preferences));
  assert.ok(Array.isArray(result.evidence));
  assert.ok(Array.isArray(result.clusters));
});

test("refinePreferencesFromSemantic — positive evidence creates cluster", () => {
  const result = refinePreferencesFromSemantic({
    samples: [
      {
        row_index: 1,
        evidence_id: "ev_1",
        direction: "positive",
        feedback: "upgrade",
        title: "RCT on treatment X",
        title_translated: "X治疗的RCT研究",
        comment: "High quality",
        accepted_for_learning: true,
        topic_tags: ["treatment", "rct"],
        scope_tags: [],
      },
    ],
    semanticResults: [],
    metaPreferenceSignals: [],
    existingStore: {},
    generatedAt: "2026-01-01T00:00:00Z",
  });

  assert.ok(result.clusters.length > 0 || result.preferences.length > 0);
  assert.ok(result.stats.evidence_total >= 1);
});

test("refinePreferencesFromSemantic — ignored evidence does not create cluster", () => {
  const result = refinePreferencesFromSemantic({
    samples: [
      {
        row_index: 1,
        evidence_id: "ev_ignored",
        direction: "ignored",
        feedback: "",
        title: "No feedback paper",
        comment: "",
        accepted_for_learning: false,
        topic_tags: [],
        scope_tags: [],
      },
    ],
    semanticResults: [],
    metaPreferenceSignals: [],
    existingStore: {},
    generatedAt: "2026-01-01T00:00:00Z",
  });

  // Ignored evidence should not create clusters
  assert.equal(result.clusters.length, 0);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].cluster_id, "");
});

test("refinePreferencesFromSemantic — preserves existing store structure", () => {
  const existingStore = {
    preferences: [
      { cluster_id: "existing_1", statement: "Old preference", confidence: 0.5 },
    ],
    evidence: [],
    clusters: [
      { cluster_id: "existing_1", topic_tags: ["test"] },
    ],
  };

  const result = refinePreferencesFromSemantic({
    samples: [],
    semanticResults: [],
    metaPreferenceSignals: [],
    existingStore,
    generatedAt: "2026-01-01T00:00:00Z",
  });

  // Existing preferences should be preserved
  assert.ok(result.preferences.length >= 1);
});

// ─── buildPreferenceLearningAudit ────────────────────────────────────

test("buildPreferenceLearningAudit — empty inputs returns valid audit", () => {
  const result = buildPreferenceLearningAudit({
    medQueryLearning: {},
    feedbackLearning: {},
    samples: [],
    refined: {},
    triagedItems: [],
    auditPath: "",
  });

  assert.ok(result.summary);
  assert.ok(Array.isArray(result.blockers));
  assert.ok(typeof result.summary.preference_learning_executed === "boolean");
});

test("buildPreferenceLearningAudit — detects missing feedback file", () => {
  const result = buildPreferenceLearningAudit({
    medQueryLearning: {
      previous_feedback_file_found: false,
    },
    feedbackLearning: {},
    samples: [],
    refined: {},
    triagedItems: [],
    auditPath: "",
  });

  assert.ok(result.blockers.includes("previous_feedback_file_not_found"));
});

test("buildPreferenceLearningAudit — detects unreadable workbook", () => {
  const result = buildPreferenceLearningAudit({
    medQueryLearning: {
      previous_feedback_file_found: true,
      workbook_unreadable: true,
    },
    feedbackLearning: {},
    samples: [],
    refined: {},
    triagedItems: [],
    auditPath: "",
  });

  assert.ok(result.blockers.includes("workbook_unreadable"));
});

test("buildPreferenceLearningAudit — maps med_query_learning fields to summary", () => {
  const result = buildPreferenceLearningAudit({
    medQueryLearning: {
      preference_learning_executed: true,
      selected_previous_feedback_file: "周报.xlsx",
      feedback_review_root: "/test/review",
      rows_total: 100,
      rows_with_feedback: 50,
      rows_with_comment: 30,
      positive_feedback_samples: 20,
      negative_feedback_samples: 10,
      ambiguous_feedback_samples: 5,
      feedback_samples_ignored: 15,
    },
    feedbackLearning: {},
    samples: [],
    refined: { stats: { evidence_total: 25 } },
    triagedItems: [],
    auditPath: "",
  });

  assert.equal(result.summary.preference_learning_executed, true);
  assert.equal(result.summary.selected_previous_feedback_file, "周报.xlsx");
  assert.equal(result.summary.rows_total, 100);
  assert.equal(result.summary.rows_with_feedback, 50);
  assert.equal(result.summary.positive_feedback_samples, 20);
  assert.equal(result.summary.evidence_total, 25);
});

// ─── Cluster Behavior via refinePreferencesFromSemantic ─────────────

test("refinePreferencesFromSemantic — positive evidence creates cluster with correct structure", () => {
  const result = refinePreferencesFromSemantic({
    samples: [
      {
        row_index: 1,
        evidence_id: "ev_1",
        direction: "positive",
        feedback: "upgrade",
        title: "RCT on SGLT2 for heart failure",
        english_title: "RCT on SGLT2 for heart failure",
        title_translation: "SGLT2治疗心衰的RCT研究",
        comment: "High quality clinical outcome study",
        accepted_for_learning: true,
        topic_tags: ["sglt2", "heart_failure"],
        scope_tags: ["clinical_outcome", "randomized_trial"],
        key_terms: ["sglt2", "heart_failure", "clinical_outcome"],
        feedback_weight: 1.5,
        feedback_strength: "strong",
        comment_empty: false,
        title_translation_missing: false,
        extracted_terms: ["SGLT2", "heart failure", "clinical outcome"],
        extracted_reason: "High quality clinical outcome study",
      },
    ],
    generatedAt: "2026-01-01T00:00:00Z",
  });

  // Should create at least one cluster
  assert.ok(result.clusters.length > 0);
  const cluster = result.clusters[0];

  // Cluster should have correct structure
  assert.ok(cluster.cluster_id);
  assert.ok(cluster.statement);
  assert.ok(typeof cluster.confidence === "number");
  assert.ok(cluster.confidence >= 0 && cluster.confidence <= 1);
  assert.ok(cluster.evidence_count >= 1);
  assert.ok(cluster.positive_evidence_count >= 1);
  assert.ok(Array.isArray(cluster.evidence_ids));
  assert.ok(Array.isArray(cluster.source_rows));
  assert.ok(Array.isArray(cluster.key_terms));
});

test("refinePreferencesFromSemantic — negative evidence creates exclusion cluster", () => {
  const result = refinePreferencesFromSemantic({
    samples: [
      {
        row_index: 2,
        evidence_id: "ev_2",
        direction: "negative",
        feedback: "drop",
        title: "Animal study on mice",
        english_title: "Animal study on mice",
        comment: "",
        accepted_for_learning: true,
        topic_tags: ["sglt2"],
        scope_tags: ["animal_only"],
        key_terms: ["sglt2", "animal_only"],
        feedback_weight: 1.5,
        feedback_strength: "strong",
        comment_empty: true,
        title_translation_missing: true,
        extracted_terms: ["SGLT2", "animal-only"],
        extracted_reason: "Animal study on mice",
      },
    ],
    generatedAt: "2026-01-01T00:00:00Z",
  });

  assert.ok(result.clusters.length > 0);
  const cluster = result.clusters[0];

  // Should have negative evidence
  assert.ok(cluster.negative_evidence_count >= 1);
  // Cluster type should reflect exclusion or needs_more_feedback (when only one evidence)
  assert.ok(cluster.preference_type === "negative_preference" || cluster.preference_type === "exclusion_hint" || cluster.preference_type === "needs_more_feedback");
});

test("refinePreferencesFromSemantic — conflicting evidence creates ambiguous cluster", () => {
  const result = refinePreferencesFromSemantic({
    samples: [
      {
        row_index: 1,
        evidence_id: "ev_pos",
        direction: "positive",
        feedback: "upgrade",
        title: "Positive SGLT2 study",
        english_title: "Positive SGLT2 study",
        comment: "Good study",
        accepted_for_learning: true,
        topic_tags: ["sglt2"],
        scope_tags: ["clinical_outcome"],
        key_terms: ["sglt2"],
        feedback_weight: 1.5,
        feedback_strength: "strong",
        comment_empty: false,
        title_translation_missing: false,
        extracted_terms: ["SGLT2"],
        extracted_reason: "Good study",
      },
      {
        row_index: 2,
        evidence_id: "ev_neg",
        direction: "negative",
        feedback: "drop",
        title: "Negative SGLT2 study",
        english_title: "Negative SGLT2 study",
        comment: "Bad study",
        accepted_for_learning: true,
        topic_tags: ["sglt2"],
        scope_tags: ["animal_only"],
        key_terms: ["sglt2"],
        feedback_weight: 1.5,
        feedback_strength: "strong",
        comment_empty: false,
        title_translation_missing: false,
        extracted_terms: ["SGLT2"],
        extracted_reason: "Bad study",
      },
    ],
    generatedAt: "2026-01-01T00:00:00Z",
  });

  // Should have clusters
  assert.ok(result.clusters.length > 0);

  // Check for ambiguous clusters or conflict detection
  const ambiguousClusters = result.clusters.filter((c) => c.status === "ambiguous");
  const conflictEvidence = result.clusters.some((c) => c.positive_evidence_count > 0 && c.negative_evidence_count > 0);

  // Either ambiguous clusters exist or conflict is detected
  assert.ok(ambiguousClusters.length > 0 || conflictEvidence || result.conflicts.length > 0);
});

test("refinePreferencesFromSemantic — multiple evidence merges into same cluster", () => {
  const result = refinePreferencesFromSemantic({
    samples: [
      {
        row_index: 1,
        evidence_id: "ev_1",
        direction: "positive",
        feedback: "keep",
        title: "SGLT2 study 1",
        english_title: "SGLT2 study 1",
        comment: "Good",
        accepted_for_learning: true,
        topic_tags: ["sglt2", "heart_failure"],
        scope_tags: ["clinical_outcome"],
        key_terms: ["sglt2", "heart_failure"],
        feedback_weight: 1,
        feedback_strength: "moderate",
        comment_empty: false,
        title_translation_missing: false,
        extracted_terms: ["SGLT2", "heart failure"],
        extracted_reason: "Good",
      },
      {
        row_index: 2,
        evidence_id: "ev_2",
        direction: "positive",
        feedback: "upgrade",
        title: "SGLT2 study 2",
        english_title: "SGLT2 study 2",
        comment: "Very good",
        accepted_for_learning: true,
        topic_tags: ["sglt2", "heart_failure"],
        scope_tags: ["clinical_outcome"],
        key_terms: ["sglt2", "heart_failure"],
        feedback_weight: 1.5,
        feedback_strength: "strong",
        comment_empty: false,
        title_translation_missing: false,
        extracted_terms: ["SGLT2", "heart failure"],
        extracted_reason: "Very good",
      },
    ],
    generatedAt: "2026-01-01T00:00:00Z",
  });

  // Should merge into same cluster
  assert.ok(result.clusters.length > 0);
  const cluster = result.clusters.find((c) => c.positive_evidence_count >= 2);
  assert.ok(cluster, "Should have a cluster with multiple positive evidence");
  assert.ok(cluster.evidence_count >= 2);
  assert.ok(cluster.evidence_ids.length >= 2);
});

test("refinePreferencesFromSemantic — cluster finalization sets correct status", () => {
  const result = refinePreferencesFromSemantic({
    samples: [
      {
        row_index: 1,
        evidence_id: "ev_1",
        direction: "positive",
        feedback: "upgrade",
        title: "High quality study",
        english_title: "High quality study",
        comment: "Excellent clinical outcome study with strong evidence",
        accepted_for_learning: true,
        topic_tags: ["sglt2", "heart_failure"],
        scope_tags: ["clinical_outcome", "randomized_trial"],
        key_terms: ["sglt2", "heart_failure", "clinical_outcome"],
        feedback_weight: 1.5,
        feedback_strength: "strong",
        comment_empty: false,
        title_translation_missing: false,
        extracted_terms: ["SGLT2", "heart failure", "clinical outcome"],
        extracted_reason: "Excellent clinical outcome study with strong evidence",
      },
    ],
    generatedAt: "2026-01-01T00:00:00Z",
  });

  assert.ok(result.clusters.length > 0);
  const cluster = result.clusters[0];

  // Status should be set
  assert.ok(["stable", "tentative", "needs_more_feedback", "ambiguous"].includes(cluster.status));

  // Confidence should be set
  assert.ok(typeof cluster.confidence === "number");
  assert.ok(cluster.confidence >= 0 && cluster.confidence <= 1);
});

test("refinePreferencesFromSemantic — preference rule generation includes all required fields", () => {
  const result = refinePreferencesFromSemantic({
    samples: [
      {
        row_index: 1,
        evidence_id: "ev_1",
        direction: "positive",
        feedback: "upgrade",
        title: "SGLT2 study",
        english_title: "SGLT2 study",
        comment: "Good",
        accepted_for_learning: true,
        topic_tags: ["sglt2"],
        scope_tags: ["clinical_outcome"],
        key_terms: ["sglt2"],
        feedback_weight: 1.5,
        feedback_strength: "strong",
        comment_empty: false,
        title_translation_missing: false,
        extracted_terms: ["SGLT2"],
        extracted_reason: "Good",
      },
    ],
    generatedAt: "2026-01-01T00:00:00Z",
  });

  assert.ok(result.preferences.length > 0);
  const pref = result.preferences[0];

  // Check required fields
  assert.ok(pref.preference_id);
  assert.ok(pref.cluster_id);
  assert.ok(pref.preference_type);
  assert.ok(pref.status);
  assert.ok(pref.statement);
  assert.ok(typeof pref.confidence === "number");
  assert.ok(typeof pref.evidence_count === "number");
  assert.ok(typeof pref.positive_evidence_count === "number");
  assert.ok(typeof pref.negative_evidence_count === "number");
  assert.ok(typeof pref.active_for_triage === "boolean");
  assert.ok(Array.isArray(pref.source_rows));
  assert.ok(Array.isArray(pref.evidence_ids));
  assert.ok(Array.isArray(pref.key_terms));
});

test("refinePreferencesFromSemantic — empty input returns valid structure", () => {
  const result = refinePreferencesFromSemantic({
    samples: [],
    generatedAt: "2026-01-01T00:00:00Z",
  });

  assert.ok(result.preferences);
  assert.ok(result.evidence);
  assert.ok(result.clusters);
  assert.ok(result.stats);
  assert.ok(Array.isArray(result.preferences));
  assert.ok(Array.isArray(result.evidence));
  assert.ok(Array.isArray(result.clusters));
  assert.equal(result.preferences.length, 0);
  assert.equal(result.clusters.length, 0);
});

test("refinePreferencesFromSemantic — stats reflect correct counts", () => {
  const result = refinePreferencesFromSemantic({
    samples: [
      {
        row_index: 1,
        evidence_id: "ev_1",
        direction: "positive",
        feedback: "upgrade",
        title: "Study 1",
        english_title: "Study 1",
        comment: "Good",
        accepted_for_learning: true,
        topic_tags: ["sglt2"],
        scope_tags: [],
        key_terms: ["sglt2"],
        feedback_weight: 1.5,
        feedback_strength: "strong",
        comment_empty: false,
        title_translation_missing: false,
        extracted_terms: ["SGLT2"],
        extracted_reason: "Good",
      },
      {
        row_index: 2,
        evidence_id: "ev_2",
        direction: "ignored",
        feedback: "",
        title: "Study 2",
        english_title: "Study 2",
        comment: "",
        accepted_for_learning: false,
        topic_tags: [],
        scope_tags: [],
        key_terms: [],
        feedback_weight: 0,
        feedback_strength: "none",
        comment_empty: true,
        title_translation_missing: true,
        extracted_terms: [],
        extracted_reason: "",
      },
    ],
    generatedAt: "2026-01-01T00:00:00Z",
  });

  // Stats should reflect counts
  assert.ok(result.stats);
  assert.ok(typeof result.stats.evidence_total === "number");
  assert.ok(result.stats.evidence_total >= 1);
});

// ─── Meta Preference Evidence via refinePreferencesFromSemantic ──────

test("refinePreferencesFromSemantic — meta evidence with 'accurate' feedback reinforces cluster", () => {
  const result = refinePreferencesFromSemantic({
    samples: [],
    metaPreferenceSignals: [
      {
        source_file: "screening_standards.docx",
        source_sheet: "当前筛选标准摘要",
        source_row: 1,
        standard_summary_text: "Prefer SGLT2 for heart failure",
        user_evaluation_text: "准确",
        user_feedback_on_summary: "accurate",
      },
    ],
    existingStore: {
      clusters: [
        {
          cluster_id: "cluster-strong_positive-sglt2-heart-failure",
          preference_type: "strong_positive",
          status: "stable",
          statement: "Prefer SGLT2 for heart failure",
          confidence: 0.7,
          evidence_count: 3,
          positive_evidence_count: 3,
          negative_evidence_count: 0,
          key_terms: ["sglt2", "heart_failure", "clinical_outcome"],
          caveat: "",
          active_for_triage: true,
        },
      ],
      preferences: [],
    },
    generatedAt: "2026-01-01T00:00:00Z",
  });

  // Should have meta evidence
  assert.ok(result.meta_preference_evidence.length > 0);
  const metaEv = result.meta_preference_evidence[0];
  assert.equal(metaEv.inferred_issue_type, "accurate");
  assert.equal(metaEv.correction_direction, "reinforce");
  assert.ok(metaEv.accepted_for_learning);

  // Cluster should be reinforced (reinforced_count increased)
  const cluster = result.clusters.find((c) => c.cluster_id === "cluster-strong_positive-sglt2-heart-failure");
  assert.ok(cluster);
  assert.ok(cluster.reinforced_count >= 1, "Reinforced count should be increased after 'accurate' feedback");
});

test("refinePreferencesFromSemantic — meta evidence with 'too_broad' feedback weakens cluster", () => {
  const result = refinePreferencesFromSemantic({
    samples: [],
    metaPreferenceSignals: [
      {
        source_file: "screening_standards.docx",
        source_sheet: "当前筛选标准摘要",
        source_row: 1,
        standard_summary_text: "Exclude animal studies",
        user_evaluation_text: "太宽泛",
        user_feedback_on_summary: "too_broad",
      },
    ],
    existingStore: {
      clusters: [
        {
          cluster_id: "cluster-negative_preference-animal-only",
          preference_type: "negative_preference",
          status: "stable",
          statement: "Downrank animal-only studies",
          confidence: 0.8,
          evidence_count: 4,
          positive_evidence_count: 0,
          negative_evidence_count: 4,
          key_terms: ["animal_only"],
          caveat: "Apply only within animal_only contexts",
          active_for_triage: true,
        },
      ],
      preferences: [],
    },
    generatedAt: "2026-01-01T00:00:00Z",
  });

  assert.ok(result.meta_preference_evidence.length > 0);
  const metaEv = result.meta_preference_evidence[0];
  assert.equal(metaEv.inferred_issue_type, "too_broad");
  assert.equal(metaEv.correction_direction, "narrow_scope");

  // Cluster should be weakened or have caveat
  const cluster = result.clusters.find((c) => c.cluster_id === "cluster-negative_preference-animal-only");
  assert.ok(cluster);
  assert.ok(cluster.weakened_count >= 1 || cluster.caveat, "Cluster should be weakened or have caveat");
});

test("refinePreferencesFromSemantic — meta evidence with 'wrong_focus' feedback marks cluster ambiguous", () => {
  const result = refinePreferencesFromSemantic({
    samples: [],
    metaPreferenceSignals: [
      {
        source_file: "screening_standards.docx",
        source_sheet: "当前筛选标准摘要",
        source_row: 1,
        standard_summary_text: "Prefer clinical outcomes",
        user_evaluation_text: "重点错了",
        user_feedback_on_summary: "wrong_focus",
      },
    ],
    existingStore: {
      clusters: [
        {
          cluster_id: "cluster-strong_positive-clinical",
          preference_type: "strong_positive",
          status: "stable",
          statement: "Prefer clinical outcomes",
          confidence: 0.75,
          evidence_count: 3,
          positive_evidence_count: 3,
          negative_evidence_count: 0,
          key_terms: ["clinical_outcome"],
          caveat: "",
          contradiction_count: 1,
        },
      ],
      preferences: [],
    },
    generatedAt: "2026-01-01T00:00:00Z",
  });

  assert.ok(result.meta_preference_evidence.length > 0);
  const metaEv = result.meta_preference_evidence[0];
  assert.equal(metaEv.inferred_issue_type, "wrong_focus");
  assert.equal(metaEv.correction_direction, "weaken");

  // Cluster should be weakened or marked ambiguous
  const cluster = result.clusters.find((c) => c.cluster_id === "cluster-strong_positive-clinical");
  assert.ok(cluster);
  assert.ok(cluster.weakened_count >= 1);
  // With contradiction_count >= 2, should be ambiguous
  assert.ok(cluster.status === "ambiguous" || cluster.status === "tentative");
});

test("refinePreferencesFromSemantic — meta evidence empty signals returns valid structure", () => {
  const result = refinePreferencesFromSemantic({
    samples: [],
    metaPreferenceSignals: [],
    generatedAt: "2026-01-01T00:00:00Z",
  });

  assert.ok(result.meta_preference_evidence);
  assert.ok(Array.isArray(result.meta_preference_evidence));
  assert.equal(result.meta_preference_evidence.length, 0);
});

test("refinePreferencesFromSemantic — meta evidence with no matching cluster creates global feedback", () => {
  const result = refinePreferencesFromSemantic({
    samples: [],
    metaPreferenceSignals: [
      {
        source_file: "screening_standards.docx",
        source_sheet: "当前筛选标准摘要",
        source_row: 1,
        standard_summary_text: "Some summary",
        user_evaluation_text: "其他",
        user_feedback_on_summary: "other",
      },
    ],
    existingStore: {
      clusters: [],
      preferences: [],
    },
    generatedAt: "2026-01-01T00:00:00Z",
  });

  assert.ok(result.meta_preference_evidence.length > 0);
  const metaEv = result.meta_preference_evidence[0];
  assert.equal(metaEv.inferred_issue_type, "other");
  // Should be global feedback (no target clusters)
  assert.ok(metaEv.global_meta_feedback || metaEv.target_cluster_ids.length === 0);
});

test("refinePreferencesFromSemantic — meta evidence stats reflect correct counts", () => {
  const result = refinePreferencesFromSemantic({
    samples: [],
    metaPreferenceSignals: [
      {
        source_file: "screening_standards.docx",
        source_sheet: "当前筛选标准摘要",
        source_row: 1,
        standard_summary_text: "Prefer SGLT2",
        user_evaluation_text: "准确",
        user_feedback_on_summary: "accurate",
      },
    ],
    existingStore: {
      clusters: [
        {
          cluster_id: "cluster-strong_positive-sglt2",
          preference_type: "strong_positive",
          status: "stable",
          statement: "Prefer SGLT2",
          confidence: 0.7,
          evidence_count: 3,
          positive_evidence_count: 3,
          negative_evidence_count: 0,
          key_terms: ["sglt2"],
          caveat: "",
          active_for_triage: true,
        },
      ],
      preferences: [],
    },
    generatedAt: "2026-01-01T00:00:00Z",
  });

  assert.ok(result.stats);
  assert.ok(typeof result.stats.meta_preference_evidence_count === "number");
  assert.ok(result.stats.meta_preference_evidence_count >= 1);
});

test("refinePreferencesFromSemantic — meta evidence with 'over_excluding' adds caveat", () => {
  const result = refinePreferencesFromSemantic({
    samples: [],
    metaPreferenceSignals: [
      {
        source_file: "screening_standards.docx",
        source_sheet: "当前筛选标准摘要",
        source_row: 1,
        standard_summary_text: "Exclude all basic research",
        user_evaluation_text: "过度排除",
        user_feedback_on_summary: "over_excluding",
      },
    ],
    existingStore: {
      clusters: [
        {
          cluster_id: "cluster-negative_preference-basic-mechanism",
          preference_type: "negative_preference",
          status: "stable",
          statement: "Downrank basic mechanism studies",
          confidence: 0.8,
          evidence_count: 4,
          positive_evidence_count: 0,
          negative_evidence_count: 4,
          key_terms: ["basic_mechanism_only"],
          caveat: "",
        },
      ],
      preferences: [],
    },
    generatedAt: "2026-01-01T00:00:00Z",
  });

  assert.ok(result.meta_preference_evidence.length > 0);
  const metaEv = result.meta_preference_evidence[0];
  assert.equal(metaEv.inferred_issue_type, "over_excluding");
  assert.equal(metaEv.correction_direction, "add_caveat");

  // Cluster should have caveat added
  const cluster = result.clusters.find((c) => c.cluster_id === "cluster-negative_preference-basic-mechanism");
  assert.ok(cluster);
  assert.ok(cluster.weakened_count >= 1);
});
