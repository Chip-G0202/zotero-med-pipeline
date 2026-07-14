// preference_cluster_builder.mjs
// Pure logic for building, merging, finalizing preference clusters from evidence.

import { nowIso, clamp, uniq, normalizeList, slugify, stableHash, sortByOrder } from "./preference_utils.mjs";
import { pickTopicLabels, pickScopeLabels } from "./preference_feedback_samples.mjs";

// ─── Constants ───────────────────────────────────────────────────────

const TOPIC_PATTERNS = [
  { tag: "sglt2", label: "SGLT2", pattern: /\bsglt-?2\b/i },
  { tag: "glp-1", label: "GLP-1", pattern: /\bglp-?1\b/i },
  { tag: "diabetes", label: "diabetes", pattern: /\bdiabet/i },
  { tag: "obesity", label: "obesity", pattern: /\bobes/i },
  { tag: "heart_failure", label: "heart failure", pattern: /heart failure|心衰/i },
  { tag: "cardiovascular", label: "cardiovascular disease", pattern: /cardiovascular|心血管/i },
  { tag: "ckd", label: "CKD", pattern: /\bckd\b|chronic kidney disease|慢性肾病/i },
  { tag: "renal", label: "renal outcomes", pattern: /\brenal\b|kidney|肾/i },
  { tag: "hypertension", label: "hypertension", pattern: /hypertension|blood pressure|高血压/i },
  { tag: "mortality", label: "mortality", pattern: /mortality|death|死亡/i },
  { tag: "hospitalization", label: "hospitalization", pattern: /hospitali[sz]ation|住院/i },
  { tag: "safety", label: "safety outcomes", pattern: /safety|adverse|不良反应|安全性/i },
];

const TOPIC_ORDER = ["sglt2", "glp-1", "diabetes", "obesity", "heart_failure", "cardiovascular", "ckd", "renal", "hypertension", "mortality", "hospitalization", "safety"];
const SCOPE_ORDER = ["clinical_outcome", "human_outcome", "randomized_trial", "meta_analysis", "cohort", "guideline", "case_report", "animal_only", "animal_study", "in_vitro_only", "in_vitro", "basic_mechanism_only", "mechanistic_study", "irrelevant_disease_context", "low_evidence", "non_medical"];

// ─── Cluster Functions ───────────────────────────────────────────────

export function buildClusterSeed(evidence) {
  const topicTags = evidence.topic_tags || [];
  const scopeTags = evidence.scope_tags || [];
  const keyTerms = evidence.key_terms || [];
  const direction = evidence.direction || "ignored";
  const clinicalPreference = topicTags.includes("heart_failure") || topicTags.includes("cardiovascular") || scopeTags.includes("clinical_outcome") || scopeTags.includes("human_outcome");
  let clusterFamily = "needs_more_feedback";
  if (direction === "positive") clusterFamily = clinicalPreference ? "strong_positive" : "soft_positive";
  else if (direction === "negative") clusterFamily = scopeTags.some((tag) => ["animal_only", "in_vitro_only", "basic_mechanism_only", "irrelevant_disease_context", "non_medical"].includes(tag))
    ? "negative_preference"
    : "exclusion_hint";
  else if (direction === "ambiguous") clusterFamily = "ambiguous";

  const positiveTopics = sortByOrder(uniq(topicTags.filter((tag) => ["sglt2", "glp-1", "diabetes", "obesity", "heart_failure", "cardiovascular", "ckd", "renal", "hypertension"].includes(tag))), TOPIC_ORDER);
  const groupedNegativeScopeTags = uniq([
    (scopeTags.includes("animal_only") || scopeTags.includes("animal_study")) ? "animal_only" : null,
    (scopeTags.includes("in_vitro_only") || scopeTags.includes("in_vitro")) ? "in_vitro_only" : null,
    (scopeTags.includes("basic_mechanism_only") || scopeTags.includes("mechanistic_study")) ? "basic_mechanism_only" : null,
    scopeTags.includes("low_evidence") ? "low_evidence" : null,
    scopeTags.includes("non_medical") ? "non_medical" : null,
  ]);
  const negativeScopeTags = sortByOrder(groupedNegativeScopeTags, SCOPE_ORDER);
  const positiveScopeTags = sortByOrder(scopeTags.filter((tag) => ["clinical_outcome"].includes(tag)), SCOPE_ORDER);
  const idTokens = uniq(direction === "negative"
    ? [...positiveTopics, ...negativeScopeTags]
    : direction === "positive"
      ? [...positiveTopics, ...positiveScopeTags]
      : [...positiveTopics, ...scopeTags.filter((tag) => !["human_outcome"].includes(tag))]);
  const statementTopic = pickTopicLabels(topicTags).join(", ");
  const statementScope = pickScopeLabels(scopeTags.filter((tag) => tag !== "human_outcome" && tag !== "clinical_outcome")).join(", ");
  const hasScope = scopeTags.length > 0;
  let statement = "Preference cluster awaiting clearer evidence boundary";
  let rationale = evidence.extracted_reason || evidence.comment || evidence.title_context || "";
  let caveat = "";

  if (clusterFamily === "strong_positive" || clusterFamily === "soft_positive") {
    statement = statementTopic
      ? `Prefer human clinical outcome studies for ${statementTopic}${statementScope ? ` with ${statementScope} context` : ""}`
      : `Prefer human clinical outcome studies${statementScope ? ` with ${statementScope} context` : ""}`;
    caveat = clusterFamily === "soft_positive" ? "title-context support only; more feedback required before stable triage impact" : "";
  } else if (clusterFamily === "negative_preference" || clusterFamily === "exclusion_hint") {
    const scopePart = statementScope || "limited-clinical-relevance";
    statement = statementTopic
      ? `Downrank ${scopePart} studies for ${statementTopic}`
      : `Downrank ${scopePart} studies in unrelated contexts`;
    caveat = scopeTags.length
      ? `Apply only within ${pickScopeLabels(scopeTags).join(", ")} contexts; do not generalize to the whole topic`
      : "Apply only when explicit exclusion boundary is present";
  } else if (clusterFamily === "ambiguous") {
    statement = statementTopic
      ? `Conflicting feedback for ${statementTopic}; refine boundary before using in triage`
      : "Conflicting feedback cluster; refine boundary before using in triage";
    caveat = "Positive and negative evidence overlap in the same topic family";
  } else if (!hasScope && keyTerms.length === 0) {
    statement = "Insufficient evidence to derive a reusable screening preference";
    caveat = "Title-only evidence or broad theme requires more feedback";
  }

  const seedSlug = slugify(idTokens.join("-")) || stableHash(`${statement}|${clusterFamily}`);
  const clusterId = `cluster-${clusterFamily}-${seedSlug}`;
  return {
    cluster_id: clusterId,
    cluster_family: clusterFamily,
    topic_tags: topicTags,
    scope_tags: scopeTags,
    key_terms: uniq([...keyTerms, ...idTokens]),
    statement,
    rationale,
    caveat,
  };
}

export function buildConflictClusterId(topicTags) {
  const topicSlug = slugify(topicTags.join("-")) || stableHash(topicTags.join("|"));
  return `cluster-ambiguous-${topicSlug}`;
}

export function createClusterFromSeed(seed, generatedAt) {
  return {
    cluster_id: seed.cluster_id,
    preference_type: seed.cluster_family,
    status: "needs_more_feedback",
    statement: seed.statement,
    rationale: seed.rationale || "",
    confidence: 0.2,
    evidence_count: 0,
    positive_evidence_count: 0,
    negative_evidence_count: 0,
    positive_evidence_weight: 0,
    negative_evidence_weight: 0,
    source_rows: [],
    evidence_ids: [],
    representative_titles: [],
    representative_comments: [],
    key_terms: [...seed.key_terms],
    caveat: seed.caveat || "",
    created_at: nowIso(generatedAt),
    updated_at: nowIso(generatedAt),
    last_seen_at: nowIso(generatedAt),
    comment_support_count: 0,
    title_translation_missing_count: 0,
    title_only_count: 0,
    run_keys: [],
    reinforced_count: 0,
    weakened_count: 0,
    contradiction_count: 0,
    summary_feedback_count: 0,
    last_summary_feedback_at: "",
    retired: false,
  };
}

export function mergeEvidenceIntoCluster(cluster, evidence, generatedAt) {
  if (cluster.evidence_ids.includes(evidence.evidence_id)) return false;
  cluster.evidence_ids = uniq([...cluster.evidence_ids, evidence.evidence_id]);
  cluster.source_rows = uniq([...cluster.source_rows, String(evidence.source_row)]);
  cluster.representative_titles = uniq([...cluster.representative_titles, evidence.title_translation || evidence.english_title]).slice(0, 8);
  cluster.representative_comments = uniq([...cluster.representative_comments, evidence.comment]).slice(0, 8);
  cluster.key_terms = uniq([...cluster.key_terms, ...normalizeList(evidence.key_terms), ...normalizeList(evidence.extracted_terms)]).slice(0, 24);
  cluster.evidence_count += 1;
  if (evidence.direction === "positive") cluster.positive_evidence_count += 1;
  if (evidence.direction === "negative") cluster.negative_evidence_count += 1;
  const evidenceWeight = Number(evidence.feedback_weight || 1);
  if (evidence.direction === "positive") cluster.positive_evidence_weight = Number(cluster.positive_evidence_weight || 0) + evidenceWeight;
  if (evidence.direction === "negative") cluster.negative_evidence_weight = Number(cluster.negative_evidence_weight || 0) + evidenceWeight;
  if (!evidence.comment_empty) cluster.comment_support_count = Number(cluster.comment_support_count || 0) + 1;
  if (evidence.title_translation_missing) cluster.title_translation_missing_count = Number(cluster.title_translation_missing_count || 0) + 1;
  if (evidence.comment_empty) cluster.title_only_count = Number(cluster.title_only_count || 0) + 1;
  cluster.updated_at = nowIso(generatedAt);
  cluster.last_seen_at = nowIso(generatedAt);
  cluster.rationale = cluster.rationale || evidence.extracted_reason || evidence.comment || "";
  cluster.caveat = cluster.caveat || "";
  return true;
}

export function finalizeCluster(cluster) {
  const total = Number(cluster.evidence_count || cluster.evidence_ids?.length || 0);
  const positive = Number(cluster.positive_evidence_count || 0);
  const negative = Number(cluster.negative_evidence_count || 0);
  const positiveWeight = Number(cluster.positive_evidence_weight || positive || 0);
  const negativeWeight = Number(cluster.negative_evidence_weight || negative || 0);
  const weightedTotal = Math.max(positiveWeight + negativeWeight, total);
  const commentSupport = Number(cluster.comment_support_count || cluster.representative_comments?.filter(Boolean).length || 0);
  const translationMissing = Number(cluster.title_translation_missing_count || 0);
  const titleOnly = Number(cluster.title_only_count || 0);
  const dominant = Math.max(positiveWeight, negativeWeight, total > 0 && cluster.preference_type === "ambiguous" ? weightedTotal : 0);
  const consistency = weightedTotal > 0 ? dominant / weightedTotal : 0;
  const specificity = cluster.key_terms?.length ? Math.min(1, cluster.key_terms.length / 4) : 0;
  let confidence = 0.22
    + Math.min(0.3, weightedTotal * 0.08)
    + Math.min(0.18, commentSupport * 0.06)
    + Math.max(0, (consistency - 0.5) * 0.24)
    + specificity * 0.08
    - translationMissing * 0.03
    - titleOnly * 0.04;

  if (positive > 0 && negative > 0) confidence -= 0.22;
  if (total <= 1) confidence -= 0.12;
  if (commentSupport === 0) confidence -= 0.1;
  confidence = clamp(Number(confidence.toFixed(2)), 0.05, 0.98);

  let status = "needs_more_feedback";
  let preferenceType = cluster.preference_type || "needs_more_feedback";
  if (positive > 0 && negative > 0) {
    status = "ambiguous";
    preferenceType = "ambiguous";
    cluster.caveat = cluster.caveat || "Positive and negative evidence coexist; narrow the scope before triage use";
  } else if (total >= 3 && consistency >= 0.75 && commentSupport >= 2 && specificity >= 0.5) {
    status = "stable";
    if (preferenceType === "soft_positive" && confidence >= 0.78) preferenceType = "strong_positive";
    if (preferenceType === "exclusion_hint" && confidence >= 0.75) preferenceType = "negative_preference";
  } else if (total >= 2 && consistency >= 0.66) {
    status = "tentative";
  } else if (total >= 1) {
    status = "needs_more_feedback";
    preferenceType = "needs_more_feedback";
  }

  cluster.status = status;
  cluster.preference_type = preferenceType;
  cluster.confidence = confidence;
  return cluster;
}

export function buildPreferenceRule(cluster, previousByCluster = new Map(), generatedAt) {
  const previous = previousByCluster.get(cluster.cluster_id);
  const activeForTriage = !cluster.retired && (cluster.status === "stable" || (cluster.status === "tentative" && cluster.confidence >= 0.7));
  return {
    preference_id: previous?.preference_id || `pref-${cluster.cluster_id}`,
    cluster_id: cluster.cluster_id,
    preference_type: cluster.preference_type,
    status: cluster.status,
    statement: cluster.statement,
    rationale: cluster.rationale,
    confidence: cluster.confidence,
    evidence_count: cluster.evidence_count,
    positive_evidence_count: cluster.positive_evidence_count,
    negative_evidence_count: cluster.negative_evidence_count,
    positive_evidence_weight: Number(cluster.positive_evidence_weight || 0),
    negative_evidence_weight: Number(cluster.negative_evidence_weight || 0),
    caveat: cluster.caveat,
    active_for_triage: activeForTriage && !["ambiguous", "needs_more_feedback"].includes(cluster.status),
    stable_or_tentative: ["stable", "tentative"].includes(cluster.status) ? cluster.status : cluster.status,
    reinforced_count: Number(cluster.reinforced_count || 0),
    weakened_count: Number(cluster.weakened_count || 0),
    contradiction_count: Number(cluster.contradiction_count || 0),
    summary_feedback_count: Number(cluster.summary_feedback_count || 0),
    last_summary_feedback_at: cluster.last_summary_feedback_at || "",
    retired: Boolean(cluster.retired),
    created_at: previous?.created_at || nowIso(generatedAt),
    updated_at: nowIso(generatedAt),
    last_seen_at: cluster.last_seen_at || nowIso(generatedAt),
    source_rows: cluster.source_rows,
    evidence_ids: cluster.evidence_ids,
    representative_titles: cluster.representative_titles,
    representative_comments: cluster.representative_comments,
    key_terms: cluster.key_terms,
  };
}

export function detectConflictGroups(clusters) {
  const directional = clusters.filter((cluster) => cluster.positive_evidence_count > 0 || cluster.negative_evidence_count > 0);
  const out = [];
  for (let i = 0; i < directional.length; i++) {
    for (let j = i + 1; j < directional.length; j++) {
      const left = directional[i];
      const right = directional[j];
      const leftPositive = left.positive_evidence_count > 0;
      const rightPositive = right.positive_evidence_count > 0;
      if (leftPositive === rightPositive) continue;
      const sharedTopics = uniq((left.key_terms || []).filter((term) => (right.key_terms || []).includes(term) && TOPIC_PATTERNS.some((entry) => entry.tag === term)));
      if (!sharedTopics.length) continue;
      out.push({ left, right, sharedTopics });
    }
  }
  return out;
}

export function buildAmbiguousClusters(conflicts, generatedAt, existingById) {
  const out = [];
  for (const conflict of conflicts) {
    const clusterId = buildConflictClusterId(conflict.sharedTopics);
    const existing = existingById.get(clusterId);
    const cluster = existing ? { ...existing } : createClusterFromSeed({
      cluster_id: clusterId,
      cluster_family: "ambiguous",
      key_terms: conflict.sharedTopics,
      statement: `Conflicting feedback for ${pickTopicLabels(conflict.sharedTopics).join(", ")}; refine boundary before using in triage`,
      rationale: "Positive and negative clusters overlap on topic tags",
      caveat: "Conflict across cluster boundaries; keep tentative until more scoped evidence arrives",
    }, generatedAt);

    cluster.preference_type = "ambiguous";
    cluster.status = "ambiguous";
    cluster.confidence = clamp(Number(((conflict.left.confidence + conflict.right.confidence) / 2 - 0.18).toFixed(2)), 0.2, 0.82);
    cluster.statement = `Conflicting feedback for ${pickTopicLabels(conflict.sharedTopics).join(", ")}; refine boundary before using in triage`;
    cluster.rationale = "Positive and negative clusters overlap on topic tags";
    cluster.caveat = "Keep topic-level preference ambiguous; apply only scoped cluster rules";
    cluster.evidence_count = uniq([...(conflict.left.evidence_ids || []), ...(conflict.right.evidence_ids || [])]).length;
    cluster.positive_evidence_count = conflict.left.positive_evidence_count + conflict.right.positive_evidence_count;
    cluster.negative_evidence_count = conflict.left.negative_evidence_count + conflict.right.negative_evidence_count;
    cluster.source_rows = uniq([...(conflict.left.source_rows || []), ...(conflict.right.source_rows || [])]);
    cluster.evidence_ids = uniq([...(conflict.left.evidence_ids || []), ...(conflict.right.evidence_ids || [])]);
    cluster.representative_titles = uniq([...(conflict.left.representative_titles || []), ...(conflict.right.representative_titles || [])]).slice(0, 8);
    cluster.representative_comments = uniq([...(conflict.left.representative_comments || []), ...(conflict.right.representative_comments || [])]).slice(0, 8);
    cluster.key_terms = uniq([...(conflict.left.key_terms || []), ...(conflict.right.key_terms || [])]);
    cluster.updated_at = nowIso(generatedAt);
    cluster.last_seen_at = nowIso(generatedAt);
    out.push(cluster);
  }
  return out;
}
