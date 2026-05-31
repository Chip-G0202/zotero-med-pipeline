import fs from "node:fs";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

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

const STUDY_PATTERNS = [
  { tag: "randomized_trial", label: "randomized trial", pattern: /randomi[sz]ed|clinical trial|试验/i },
  { tag: "meta_analysis", label: "meta-analysis", pattern: /meta-analysis|systematic review|系统综述|荟萃/i },
  { tag: "cohort", label: "cohort", pattern: /cohort|registry|队列/i },
  { tag: "guideline", label: "guideline", pattern: /guideline|consensus|指南|共识/i },
  { tag: "case_report", label: "case report", pattern: /case report|病例/i },
  { tag: "animal_study", label: "animal study", pattern: /animal|mouse|mice|rat|rats|zebrafish|小鼠|大鼠|斑马鱼/i },
  { tag: "in_vitro", label: "in vitro", pattern: /in vitro|cell line|细胞/i },
  { tag: "mechanistic_study", label: "mechanistic study", pattern: /mechanis|pathway|signaling|通路|机制/i },
  { tag: "human_outcome", label: "human clinical outcome", pattern: /patient|human|clinical outcome|hard endpoint|人群|临床结局|硬终点/i },
];

const EXCLUSION_PATTERNS = [
  { tag: "animal_only", label: "animal-only", pattern: /仅动物|animal only|animal study|动物实验|动物研究|动物|mouse|mice|rat|rats|zebrafish|小鼠|大鼠|斑马鱼/i },
  { tag: "in_vitro_only", label: "in-vitro only", pattern: /in vitro|cell line|细胞/i },
  { tag: "basic_mechanism_only", label: "basic mechanism only", pattern: /基础机制|mechanis|pathway|signaling|通路|机制/i },
  { tag: "irrelevant_disease_context", label: "irrelevant disease context", pattern: /无关|不相关|irrelevant/i },
  { tag: "low_evidence", label: "low evidence", pattern: /low evidence|证据弱|证据不足/i },
  { tag: "non_medical", label: "non-medical", pattern: /architecture|social media|digital media|虚拟建筑|社交媒体|心理学/i },
];

const TOPIC_ORDER = ["sglt2", "glp-1", "diabetes", "obesity", "heart_failure", "cardiovascular", "ckd", "renal", "hypertension", "mortality", "hospitalization", "safety"];
const SCOPE_ORDER = ["clinical_outcome", "human_outcome", "randomized_trial", "meta_analysis", "cohort", "guideline", "case_report", "animal_only", "animal_study", "in_vitro_only", "in_vitro", "basic_mechanism_only", "mechanistic_study", "irrelevant_disease_context", "low_evidence", "non_medical"];

function nowIso(input) {
  return input || new Date().toISOString();
}

function normalizeFeedback(value) {
  return String(value || "").trim().toLowerCase();
}

function directionFromFeedback(feedback) {
  if (feedback === "keep" || feedback === "upgrade") return "positive";
  if (feedback === "drop" || feedback === "downgrade") return "negative";
  if (!feedback) return "ignored";
  return "ignored";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

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

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function stableHash(value) {
  return createHash("sha1").update(String(value || "")).digest("hex").slice(0, 12);
}

function sortByOrder(values, order) {
  const priority = new Map(order.map((entry, idx) => [entry, idx]));
  return [...values].sort((left, right) => {
    const leftScore = priority.has(left) ? priority.get(left) : Number.MAX_SAFE_INTEGER;
    const rightScore = priority.has(right) ? priority.get(right) : Number.MAX_SAFE_INTEGER;
    return leftScore - rightScore || String(left).localeCompare(String(right));
  });
}

function matchTags(text, patterns) {
  const haystack = String(text || "");
  return patterns.filter((entry) => entry.pattern.test(haystack)).map((entry) => entry.tag);
}

function pickTopicLabels(tags) {
  const lookup = new Map(TOPIC_PATTERNS.map((entry) => [entry.tag, entry.label]));
  return tags.map((tag) => lookup.get(tag) || tag);
}

function pickScopeLabels(tags) {
  const studyLookup = new Map(STUDY_PATTERNS.map((entry) => [entry.tag, entry.label]));
  const exclusionLookup = new Map(EXCLUSION_PATTERNS.map((entry) => [entry.tag, entry.label]));
  return tags.map((tag) => studyLookup.get(tag) || exclusionLookup.get(tag) || tag);
}

function summarizeNeighbors(results = []) {
  return (results || []).slice(0, 3).map((entry) => entry?.title).filter(Boolean).join(" | ");
}

function inferEvidenceFeatures({
  comment = "",
  titleContext = "",
  englishTitle = "",
  titleTranslation = "",
  direction = "ignored",
}) {
  const commentText = String(comment || "").trim();
  const titleText = [titleContext, titleTranslation, englishTitle].filter(Boolean).join(" ");
  const fullText = [commentText, titleText].filter(Boolean).join(" ");
  const topicTags = uniq([
    ...matchTags(commentText, TOPIC_PATTERNS),
    ...matchTags(titleText, TOPIC_PATTERNS),
  ]);
  const studyTags = uniq([
    ...matchTags(commentText, STUDY_PATTERNS),
    ...matchTags(titleText, STUDY_PATTERNS),
  ]);
  const exclusionTags = uniq([
    ...matchTags(commentText, EXCLUSION_PATTERNS),
    ...matchTags(titleText, EXCLUSION_PATTERNS),
  ]);
  const keyTerms = uniq([...topicTags, ...studyTags, ...exclusionTags]);
  const clinicalFocus = topicTags.some((tag) => ["heart_failure", "cardiovascular", "renal", "ckd", "mortality", "hospitalization", "safety"].includes(tag))
    || studyTags.includes("human_outcome")
    || /clinical outcome|hard endpoint|临床结局|硬终点/i.test(fullText);
  const prefersClinicalOverMechanism = direction === "positive" && /人群结局|临床结局|硬终点|比机制更重要|关注.*结局/i.test(commentText);
  const titleOnly = !commentText;
  let scopeTags = uniq([
    ...studyTags.filter((tag) => ["randomized_trial", "meta_analysis", "cohort", "guideline", "case_report", "animal_study", "in_vitro", "mechanistic_study", "human_outcome"].includes(tag)),
    ...exclusionTags,
    ...(clinicalFocus ? ["clinical_outcome"] : []),
  ]);
  if (prefersClinicalOverMechanism) {
    scopeTags = scopeTags.filter((tag) => !["mechanistic_study", "basic_mechanism_only"].includes(tag));
  }
  const extractedReason = commentText || titleContext || titleTranslation || englishTitle || "";
  const extractedTerms = uniq([
    ...pickTopicLabels(topicTags),
    ...pickScopeLabels(scopeTags),
  ]);

  let preferenceHint = "needs_more_feedback";
  if (direction === "positive") {
    preferenceHint = clinicalFocus ? "strong_positive" : "soft_positive";
  } else if (direction === "negative") {
    preferenceHint = exclusionTags.length ? "negative_preference" : "exclusion_hint";
  } else if (direction === "ambiguous") {
    preferenceHint = "ambiguous";
  }

  return {
    topic_tags: topicTags,
    study_tags: studyTags,
    exclusion_tags: exclusionTags,
    scope_tags: scopeTags,
    key_terms: keyTerms,
    extracted_terms: extractedTerms,
    extracted_reason: extractedReason,
    clinical_focus: clinicalFocus,
    title_only: titleOnly,
    preference_hint: preferenceHint,
  };
}

function buildEvidenceId(sourceFile, row, feedback, titleContext, comment) {
  return `evidence-${stableHash([sourceFile, row, feedback, titleContext, comment].join("|"))}`;
}

function buildEvidenceRecord(signal, sourceFile, generatedAt) {
  const feedback = normalizeFeedback(signal.feedback);
  const direction = signal.ambiguous_reason ? "ambiguous" : directionFromFeedback(feedback);
  const comment = String(signal.comment || "").trim();
  const englishTitle = String(signal.english_title || "").trim();
  const titleTranslation = String(signal.title_translation || "").trim();
  const titleContext = String(signal.title_context || titleTranslation || englishTitle || "").trim();
  const titleTranslationMissing = Boolean(signal.title_translation_missing || !titleTranslation);
  const commentEmpty = !comment;
  const acceptedForLearning = direction === "positive" || direction === "negative" || direction === "ambiguous";
  let confidence = 0.58;
  if (direction === "positive" || direction === "negative") confidence += 0.08;
  if (!commentEmpty) confidence += 0.1;
  if (titleTranslationMissing) confidence -= 0.09;
  if (commentEmpty) confidence -= 0.12;
  if (direction === "ambiguous") confidence -= 0.14;
  if (direction === "ignored") confidence = 0;

  const features = inferEvidenceFeatures({
    comment,
    titleContext,
    englishTitle,
    titleTranslation,
    direction,
  });

  const evidenceId = buildEvidenceId(sourceFile, signal.row || -1, feedback, titleContext, comment);
  return {
    evidence_id: evidenceId,
    row_index: Number(signal.row || -1),
    source_file: sourceFile,
    source_sheet: "每日反馈",
    source_row: Number(signal.row || -1),
    feedback,
    comment,
    english_title: englishTitle,
    title_translation: titleTranslation,
    title_context: titleContext,
    title_context_source: titleTranslation ? "title_translation" : "english_title_fallback",
    direction,
    confidence: clamp(Number(confidence.toFixed(2)), 0, 0.95),
    extracted_terms: features.extracted_terms,
    extracted_reason: features.extracted_reason,
    comment_empty: commentEmpty,
    title_translation_missing: titleTranslationMissing,
    accepted_for_learning: acceptedForLearning,
    accepted_for_preference_update: acceptedForLearning,
    ignored_reason: acceptedForLearning ? "" : (feedback ? "unsupported_feedback_value" : "missing_feedback"),
    ambiguous_reason: String(signal.ambiguous_reason || ((direction === "ignored" && feedback) ? "unrecognized_feedback" : "")).trim(),
    created_at: nowIso(generatedAt),
    semantic_query: [titleContext, comment].filter(Boolean).join("; "),
    evidence_fields: {
      used_title_translation: Boolean(titleTranslation),
      used_english_title_fallback: !titleTranslation,
      used_comment: !commentEmpty,
    },
    missing_title_translation: titleTranslationMissing,
    preference_type: features.preference_hint,
    topic_tags: features.topic_tags,
    study_tags: features.study_tags,
    exclusion_tags: features.exclusion_tags,
    scope_tags: features.scope_tags,
    key_terms: features.key_terms,
    title_only: features.title_only,
  };
}

export function buildFeedbackSemanticSamples(feedbackLearning = {}, sourceFile = "", options = {}) {
  const signals = Array.isArray(feedbackLearning.signals) ? feedbackLearning.signals : [];
  const generatedAt = nowIso(options.generatedAt);
  return signals.map((signal) => buildEvidenceRecord(signal, sourceFile, generatedAt));
}

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

function colRefToIndex(ref = "") {
  const letters = String(ref).match(/[A-Z]+/i)?.[0] || "";
  if (!letters) return -1;
  let out = 0;
  for (const ch of letters.toUpperCase()) out = out * 26 + (ch.charCodeAt(0) - 64);
  return out - 1;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function parseZipEntries(buffer) {
  const entries = new Map();
  let pos = 0;
  while (pos + 30 <= buffer.length) {
    if (buffer.readUInt32LE(pos) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(pos + 8);
    const compressedSize = buffer.readUInt32LE(pos + 18);
    const nameLength = buffer.readUInt16LE(pos + 26);
    const extraLength = buffer.readUInt16LE(pos + 28);
    const name = buffer.slice(pos + 30, pos + 30 + nameLength).toString("utf8");
    const dataStart = pos + 30 + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const compressed = buffer.slice(dataStart, dataEnd);
    const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : Buffer.alloc(0);
    entries.set(name, data.toString("utf8"));
    pos = dataEnd;
  }
  return entries;
}

function parseSharedStrings(sharedXml) {
  return Array.from(String(sharedXml || "").matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)).map((entry) => {
    return Array.from(String(entry[1] || "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
      .map((match) => escapeXml(match[1]))
      .join("");
  });
}

function parseRelationshipTargets(relsXml) {
  const relMap = new Map();
  for (const match of String(relsXml || "").matchAll(/<Relationship([^>]*)\/?>/g)) {
    const attrs = match[1] || "";
    const id = (attrs.match(/\bId="([^"]+)"/) || [])[1] || "";
    const target = (attrs.match(/\bTarget="([^"]+)"/) || [])[1] || "";
    if (id && target) relMap.set(id, target.replace(/^\//, ""));
  }
  return relMap;
}

function readWorkbookSheets(filePath) {
  const entries = parseZipEntries(fs.readFileSync(filePath));
  const workbook = entries.get("xl/workbook.xml");
  if (!workbook) throw new Error("workbook_xml_missing");
  const rels = entries.get("xl/_rels/workbook.xml.rels") || "";
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml") || "");
  const sheetDefs = Array.from(workbook.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/?>/g))
    .map((match) => ({ name: match[1], rid: match[2] }));
  const relMap = new Map(Array.from(parseRelationshipTargets(rels).entries())
    .map(([id, target]) => [id, target.startsWith("xl/") ? target : `xl/${target}`]));
  const workbookRows = new Map();

  for (const sheet of sheetDefs) {
    const target = relMap.get(sheet.rid);
    if (!target) continue;
    const xml = entries.get(target);
    if (!xml) continue;
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const rowXml = rowMatch[1];
      const cells = [];
      for (const cell of rowXml.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
        const attrs = cell[1] || cell[3] || "";
        const inner = cell[2] || "";
        const ref = (attrs.match(/\br="([^"]+)"/) || [])[1] || "";
        const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || "";
        const colIdx = colRefToIndex(ref);
        if (colIdx < 0) continue;
        const rawValue = (inner.match(/<v[^>]*>([\s\S]*?)<\/v>/) || [])[1] || "";
        let value = "";
        if (type === "s") value = sharedStrings[Number(rawValue) || 0] || "";
        else if (type === "inlineStr") value = Array.from(inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((match) => escapeXml(match[1])).join("");
        else value = escapeXml(rawValue || (inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || "");
        cells[colIdx] = value;
      }
      rows.push(cells.map((entry) => entry == null ? "" : String(entry)));
    }
    workbookRows.set(sheet.name, rows);
  }

  return workbookRows;
}

function rowsToObjects(rows = []) {
  if (!rows.length) return [];
  const headers = (rows[0] || []).map((value) => String(value || "").trim());
  return rows.slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row) => Object.fromEntries(headers.map((header, idx) => [header, row[idx] ?? ""])));
}

function normalizeExistingStore(existingStore = {}, options = {}) {
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

function buildClusterSeed(evidence) {
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

function buildConflictClusterId(topicTags) {
  const topicSlug = slugify(topicTags.join("-")) || stableHash(topicTags.join("|"));
  return `cluster-ambiguous-${topicSlug}`;
}

function createClusterFromSeed(seed, generatedAt) {
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

function mergeEvidenceIntoCluster(cluster, evidence, generatedAt) {
  if (cluster.evidence_ids.includes(evidence.evidence_id)) return false;
  cluster.evidence_ids = uniq([...cluster.evidence_ids, evidence.evidence_id]);
  cluster.source_rows = uniq([...cluster.source_rows, String(evidence.source_row)]);
  cluster.representative_titles = uniq([...cluster.representative_titles, evidence.title_translation || evidence.english_title]).slice(0, 8);
  cluster.representative_comments = uniq([...cluster.representative_comments, evidence.comment]).slice(0, 8);
  cluster.key_terms = uniq([...cluster.key_terms, ...normalizeList(evidence.key_terms), ...normalizeList(evidence.extracted_terms)]).slice(0, 24);
  cluster.evidence_count += 1;
  if (evidence.direction === "positive") cluster.positive_evidence_count += 1;
  if (evidence.direction === "negative") cluster.negative_evidence_count += 1;
  if (!evidence.comment_empty) cluster.comment_support_count = Number(cluster.comment_support_count || 0) + 1;
  if (evidence.title_translation_missing) cluster.title_translation_missing_count = Number(cluster.title_translation_missing_count || 0) + 1;
  if (evidence.comment_empty) cluster.title_only_count = Number(cluster.title_only_count || 0) + 1;
  cluster.updated_at = nowIso(generatedAt);
  cluster.last_seen_at = nowIso(generatedAt);
  cluster.rationale = cluster.rationale || evidence.extracted_reason || evidence.comment || "";
  cluster.caveat = cluster.caveat || "";
  return true;
}

function finalizeCluster(cluster) {
  const total = Number(cluster.evidence_count || cluster.evidence_ids?.length || 0);
  const positive = Number(cluster.positive_evidence_count || 0);
  const negative = Number(cluster.negative_evidence_count || 0);
  const commentSupport = Number(cluster.comment_support_count || cluster.representative_comments?.filter(Boolean).length || 0);
  const translationMissing = Number(cluster.title_translation_missing_count || 0);
  const titleOnly = Number(cluster.title_only_count || 0);
  const dominant = Math.max(positive, negative, total > 0 && cluster.preference_type === "ambiguous" ? total : 0);
  const consistency = total > 0 ? dominant / total : 0;
  const specificity = cluster.key_terms?.length ? Math.min(1, cluster.key_terms.length / 4) : 0;
  let confidence = 0.22
    + Math.min(0.3, total * 0.08)
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

function buildPreferenceRule(cluster, previousByCluster = new Map(), generatedAt) {
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

function detectConflictGroups(clusters) {
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

function buildAmbiguousClusters(conflicts, generatedAt, existingById) {
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

function summarizeStats({
  store,
  previousStore,
  touchedExistingClusterIds,
  createdClusterIds,
  conflictClusters,
  metaAdjustment = { stats: {} },
  generatedAt,
}) {
  const currentPreferenceByCluster = new Map(store.preferences.map((entry) => [entry.cluster_id, entry]));
  const previousPreferenceByCluster = new Map((previousStore.preferences || []).map((entry) => [entry.cluster_id, entry]));
  let preferencesAdded = 0;
  let preferencesUpdated = 0;
  let preferencesReinforced = 0;
  let preferencesMarkedAmbiguous = 0;
  let preferencesNeedingMoreFeedback = 0;

  for (const pref of store.preferences) {
    const previous = previousPreferenceByCluster.get(pref.cluster_id);
    if (!previous) {
      preferencesAdded += 1;
    } else if (pref.status === "ambiguous" && previous.status !== "ambiguous") {
      preferencesMarkedAmbiguous += 1;
      preferencesUpdated += 1;
    } else if (pref.status === "needs_more_feedback") {
      preferencesNeedingMoreFeedback += 1;
      if (pref.evidence_count !== previous.evidence_count || pref.confidence !== previous.confidence) preferencesUpdated += 1;
    } else if (pref.evidence_count > Number(previous.evidence_count || 0) || pref.confidence > Number(previous.confidence || 0)) {
      preferencesReinforced += 1;
      preferencesUpdated += 1;
    } else if (pref.status !== previous.status || pref.statement !== previous.statement || pref.preference_type !== previous.preference_type) {
      preferencesUpdated += 1;
    }
    if (pref.status === "ambiguous" && !previous) preferencesMarkedAmbiguous += 1;
    if (pref.status === "needs_more_feedback" && !previous) preferencesNeedingMoreFeedback += 1;
  }

  const clusters = store.clusters;
  const summaryEvaluationEvidence = (store.meta_preference_evidence || []).filter((entry) => String(entry.user_evaluation_text || "").trim());
  const stats = {
    generated_at: nowIso(generatedAt),
    clustering_executed: true,
    evidence_total: store.evidence.length,
    evidence_positive: store.evidence.filter((entry) => entry.direction === "positive").length,
    evidence_negative: store.evidence.filter((entry) => entry.direction === "negative").length,
    evidence_ambiguous: store.evidence.filter((entry) => entry.direction === "ambiguous").length,
    evidence_ignored: store.evidence.filter((entry) => entry.direction === "ignored" || !entry.accepted_for_learning).length,
    new_evidence_count: store.evidence.filter((entry) => entry.created_at === nowIso(generatedAt)).length,
    historical_evidence_count: (previousStore.evidence || []).length,
    clusters_total: clusters.length,
    clusters_existing_matched: touchedExistingClusterIds.size,
    clusters_created: createdClusterIds.size,
    clusters_updated: touchedExistingClusterIds.size,
    clusters_stable: clusters.filter((entry) => entry.status === "stable").length,
    clusters_tentative: clusters.filter((entry) => entry.status === "tentative").length,
    clusters_ambiguous: clusters.filter((entry) => entry.status === "ambiguous").length,
    clusters_needing_more_feedback: clusters.filter((entry) => entry.status === "needs_more_feedback").length,
    preferences_added: preferencesAdded,
    preferences_updated: preferencesUpdated,
    preferences_reinforced: preferencesReinforced,
    preferences_marked_ambiguous: preferencesMarkedAmbiguous,
    preferences_needing_more_feedback: preferencesNeedingMoreFeedback,
    conflicts_detected: conflictClusters.length,
    standard_summary_feedback_read: store.meta_preference_evidence.length > 0,
    standard_summary_feedback_used: store.meta_preference_evidence.some((entry) => entry.accepted_for_learning),
    standard_summary_feedback_rows: store.meta_preference_evidence.length,
    meta_preference_evidence_count: store.meta_preference_evidence.length,
    primary_rationale_source: summaryEvaluationEvidence.length ? "standard_summary_my_evaluation" : "daily_feedback_comment_or_title",
    standard_summary_my_evaluation_rows: summaryEvaluationEvidence.length,
    global_meta_feedback_count: Number(metaAdjustment.stats.global_meta_feedback_count || 0),
    clusters_adjusted_by_summary_feedback: Number(metaAdjustment.stats.clusters_adjusted_by_summary_feedback || 0),
    clusters_reinforced_by_summary_feedback: Number(metaAdjustment.stats.clusters_reinforced_by_summary_feedback || 0),
    clusters_weakened_by_summary_feedback: Number(metaAdjustment.stats.clusters_weakened_by_summary_feedback || 0),
    clusters_scope_narrowed_by_summary_feedback: Number(metaAdjustment.stats.clusters_scope_narrowed_by_summary_feedback || 0),
    clusters_scope_broadened_by_summary_feedback: Number(metaAdjustment.stats.clusters_scope_broadened_by_summary_feedback || 0),
    clusters_marked_ambiguous_by_summary_feedback: Number(metaAdjustment.stats.clusters_marked_ambiguous_by_summary_feedback || 0),
    clusters_retired_by_summary_feedback: Number(metaAdjustment.stats.clusters_retired_by_summary_feedback || 0),
    summary_feedback_mapping_failures: Number(metaAdjustment.stats.summary_feedback_mapping_failures || 0),
    clustering_warning: "",
    evidence_to_cluster_map_available: store.evidence.some((entry) => entry.cluster_id),
    warnings: [...(store.warnings || [])],
  };

  if (stats.preferences_added === stats.evidence_total && stats.evidence_total > 1) {
    stats.warnings.push("preferences_equal_evidence_total");
  }
  if (stats.clusters_total === stats.new_evidence_count && stats.new_evidence_count > 1) {
    stats.warnings.push("clustering_insufficient");
  }
  stats.clustering_warning = stats.warnings.join(" | ");
  return stats;
}

function buildPreferenceChangeRows({ currentPreferences = [], previousPreferences = [] } = {}) {
  const previousByCluster = new Map((previousPreferences || []).map((entry) => [entry.cluster_id, entry]));
  const rows = [];
  for (const pref of currentPreferences) {
    const previous = previousByCluster.get(pref.cluster_id);
    let changeType = "added";
    if (previous) {
      if (pref.status === "ambiguous" && previous.status !== "ambiguous") changeType = "marked_ambiguous";
      else if (pref.evidence_count > Number(previous.evidence_count || 0) || pref.confidence > Number(previous.confidence || 0)) changeType = "reinforced";
      else changeType = "updated";
    }
    rows.push({
      cluster_id: pref.cluster_id,
      preference_id: pref.preference_id,
      change_type: changeType,
      preference_type: pref.preference_type,
      status: pref.status,
      statement: pref.statement,
      confidence_before: previous?.confidence ?? null,
      confidence_after: pref.confidence ?? null,
      evidence_count: pref.evidence_count,
      positive_evidence_count: pref.positive_evidence_count,
      negative_evidence_count: pref.negative_evidence_count,
      rationale: pref.rationale,
      caveat: pref.caveat,
    });
  }
  if (!rows.length) {
    rows.push({
      cluster_id: "",
      preference_id: "",
      change_type: "unchanged",
      preference_type: "needs_more_feedback",
      status: "needs_more_feedback",
      statement: "",
      confidence_before: null,
      confidence_after: null,
      evidence_count: 0,
      positive_evidence_count: 0,
      negative_evidence_count: 0,
      rationale: "no preference changes generated",
      caveat: "no_feedback_or_no_accepted_samples",
    });
  }
  return rows;
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
      final_level: item["推荐等级"] || item.grade_label || "",
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

function normalizeSummaryFeedback(value = "") {
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

function tokenizeForMatch(text = "") {
  const lowered = String(text || "").toLowerCase();
  const english = lowered.match(/[a-z0-9_-]{3,}/g) || [];
  const chinese = String(text || "").match(/[\u4e00-\u9fff]{2,8}/g) || [];
  return uniq([...english, ...chinese]);
}

function chooseCorrectionDirection(issueType) {
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

function chooseAffectedSummarySection(signal = {}) {
  if (signal.source_section) return signal.source_section;
  const issue = normalizeSummaryFeedback(signal.user_feedback_on_summary || signal.inferred_issue_type || signal.user_evaluation_text);
  if (["over_excluding", "under_excluding"].includes(issue)) return "current_downrank_summary";
  if (["wrong_focus", "missing_priority", "needs_more_clinical_focus", "too_narrow"].includes(issue)) return "current_priority_summary";
  if (issue === "too_broad") return "caveats";
  return "one_sentence_summary";
}

function pickCandidateClusters(clusters = [], affectedSection = "") {
  if (affectedSection === "current_priority_summary") return clusters.filter((c) => ["strong_positive", "soft_positive"].includes(c.preference_type) || c.active_for_triage);
  if (affectedSection === "current_downrank_summary") return clusters.filter((c) => ["negative_preference", "exclusion_hint"].includes(c.preference_type));
  if (affectedSection === "uncertain_boundaries") return clusters.filter((c) => ["ambiguous", "needs_more_feedback"].includes(c.status));
  if (affectedSection === "caveats") return clusters.filter((c) => c.caveat);
  return clusters.filter((c) => c.active_for_triage || c.status === "stable");
}

function scoreClusterMatch(cluster, tokens = []) {
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

function buildMetaEvidenceId(signal = {}) {
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

function buildMetaPreferenceEvidence(signal, clusters = [], generatedAt) {
  const userEvaluationText = String(signal.user_evaluation_text || signal.user_comment_on_summary || signal.user_correction_hint || "").trim();
  const standardSummaryText = String(signal.standard_summary_text || [
    signal.one_sentence_summary,
    signal.current_priority_summary,
    signal.current_downrank_summary,
    signal.uncertain_boundaries,
    signal.caveats,
  ].filter(Boolean).join("\n")).trim();
  const issueType = normalizeSummaryFeedback(signal.user_feedback_on_summary || signal.inferred_issue_type || userEvaluationText);
  const affectedSummarySection = chooseAffectedSummarySection(signal);
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

function applyMetaPreferenceEvidence(clusters = [], metaEvidence = [], generatedAt) {
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

export function buildPreferenceStoreSheets(store = {}, generatedAt = "") {
  const safeStore = normalizeExistingStore(store);
  return {
    preferences: {
      headers: [
        "preference_id", "cluster_id", "preference_type", "status", "statement", "rationale", "confidence",
        "evidence_count", "positive_evidence_count", "negative_evidence_count", "active_for_triage",
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
        "title_context_source", "direction", "confidence", "accepted_for_learning", "ignored_reason", "ambiguous_reason",
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

export function refinePreferencesFromSemantic({
  samples = [],
  semanticResults = [],
  metaPreferenceSignals = [],
  existingStore = {},
  screeningPreferencePath = "",
  screeningStandards = {},
  generatedAt,
} = {}) {
  const timestamp = nowIso(generatedAt);
  const previousStore = normalizeExistingStore(existingStore, { workbookPath: screeningPreferencePath });
  const workingStore = normalizeExistingStore(previousStore);
  const previousPreferenceByCluster = new Map(workingStore.preferences.map((entry) => [entry.cluster_id, entry]));
  const clusterById = new Map(workingStore.clusters.map((entry) => [
    entry.cluster_id,
    {
      ...entry,
      source_rows: normalizeList(entry.source_rows),
      evidence_ids: normalizeList(entry.evidence_ids),
      representative_titles: normalizeList(entry.representative_titles),
      representative_comments: normalizeList(entry.representative_comments),
      key_terms: normalizeList(entry.key_terms),
    },
  ]));

  const semanticByRow = new Map((semanticResults || []).map((entry) => [entry?.source_sample?.row_index, entry]));
  const newEvidence = [];
  const evidenceToClusterMap = [];
  const touchedExistingClusterIds = new Set();
  const createdClusterIds = new Set();

  for (const sample of samples) {
    const semantic = semanticByRow.get(sample.row_index);
    const evidence = {
      ...sample,
      semantic_result_count: semantic?.results?.length || 0,
      semantic_summary: summarizeNeighbors(semantic?.results || []),
      created_at: timestamp,
    };
    newEvidence.push(evidence);
    if (!evidence.accepted_for_learning || evidence.direction === "ignored") {
      workingStore.evidence.push({ ...evidence, cluster_id: "" });
      continue;
    }

    const seed = buildClusterSeed(evidence);
    const existing = clusterById.get(seed.cluster_id);
    const cluster = existing ? { ...existing } : createClusterFromSeed(seed, timestamp);
    if (existing) touchedExistingClusterIds.add(seed.cluster_id);
    else createdClusterIds.add(seed.cluster_id);

    mergeEvidenceIntoCluster(cluster, evidence, timestamp);
    clusterById.set(seed.cluster_id, cluster);
    evidence.cluster_id = seed.cluster_id;
    evidenceToClusterMap.push({ evidence_id: evidence.evidence_id, cluster_id: seed.cluster_id });
    workingStore.evidence.push(evidence);
  }

  const finalizedClusters = Array.from(clusterById.values()).map((cluster) => finalizeCluster(cluster));
  const conflictClusters = buildAmbiguousClusters(detectConflictGroups(finalizedClusters), timestamp, clusterById);
  for (const cluster of conflictClusters) {
    clusterById.set(cluster.cluster_id, cluster);
    if (workingStore.clusters.some((entry) => entry.cluster_id === cluster.cluster_id)) touchedExistingClusterIds.add(cluster.cluster_id);
    else createdClusterIds.add(cluster.cluster_id);
  }

  workingStore.clusters = Array.from(clusterById.values()).map((cluster) => finalizeCluster(cluster));
  const metaEvidence = (metaPreferenceSignals || []).map((signal) => buildMetaPreferenceEvidence(signal, workingStore.clusters, timestamp));
  workingStore.meta_preference_evidence = uniq([...(workingStore.meta_preference_evidence || []).map((entry) => entry.meta_evidence_id), ...metaEvidence.map((entry) => entry.meta_evidence_id)])
    .map((id) => ([...(workingStore.meta_preference_evidence || []), ...metaEvidence].find((entry) => entry.meta_evidence_id === id)))
    .filter(Boolean);
  const metaAdjustment = applyMetaPreferenceEvidence(workingStore.clusters, metaEvidence, timestamp);
  workingStore.clusters = metaAdjustment.clusters;
  workingStore.preferences = workingStore.clusters.map((cluster) => buildPreferenceRule(cluster, previousPreferenceByCluster, timestamp));
  workingStore.loaded = previousStore.loaded;
  workingStore.source = previousStore.source;

  const stats = summarizeStats({
    store: workingStore,
    previousStore,
    touchedExistingClusterIds,
    createdClusterIds,
    conflictClusters,
    metaAdjustment,
    generatedAt: timestamp,
  });
  if (screeningStandards?.loaded) {
    stats.screening_standards_loaded = true;
    stats.screening_standards_path = screeningStandards.path || "";
    stats.screening_standards_cleaned = Boolean(screeningStandards.cleaned);
    stats.screening_standards_primary_rationale_source = true;
    stats.primary_rationale_source = "screening_standards_md";
  }

  const changeRows = buildPreferenceChangeRows({
    currentPreferences: workingStore.preferences,
    previousPreferences: previousStore.preferences || [],
  });

  return {
    store: workingStore,
    preferences: workingStore.preferences,
    evidence: workingStore.evidence,
    clusters: workingStore.clusters,
    cluster_changes: changeRows,
    summary_change_log: metaAdjustment.changeLog,
    meta_preference_evidence: workingStore.meta_preference_evidence,
    evidence_to_cluster_map: evidenceToClusterMap,
    conflicts: conflictClusters.map((cluster) => ({
      cluster_id: cluster.cluster_id,
      statement: cluster.statement,
      evidence_count: cluster.evidence_count,
    })),
    stats,
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
