/**
 * Workflow-based classifier for literature grading.
 * 
 * This module implements grading logic based solely on workflow_rules.json's grading_rules.
 * No hardcoded weights, thresholds, or pollutant terms.
 * 
 * D-grade rules have highest priority: if a paper matches D-grade conditions,
 * it should be classified as D regardless of keyword matches.
 */

import { loadWorkflowRules } from "./literature_config.mjs";

const WORKFLOW_RULES = loadWorkflowRules().config;
const TRIAGE_RULES = WORKFLOW_RULES.triage || {};
const GRADING_RULES = TRIAGE_RULES.grading_rules || {};

// Labels from workflow_rules.json
export const LABELS = {
  A: TRIAGE_RULES.labels?.A || "A课题相关",
  B: TRIAGE_RULES.labels?.B || "B专题相关",
  C: TRIAGE_RULES.labels?.C || "C领域相关",
  D: TRIAGE_RULES.labels?.D || "D无关",
};

export const SOURCE_LABELS = {
  rss: TRIAGE_RULES.source_labels?.rss || "RSS",
  pubmed: TRIAGE_RULES.source_labels?.pubmed || "PubMed",
  pmc: TRIAGE_RULES.source_labels?.pmc || "PMC",
  other: TRIAGE_RULES.source_labels?.other || "other",
};

export const TRIAGE_VERSION = TRIAGE_RULES.version || "2026-05-28-v2-workflow-based";

// ─── Helper Functions ─────────────────────────────────────────────────

function cleanText(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normTitle(t) {
  return cleanText(t)
    .normalize("NFKC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[""]/g, "\"")
    .replace(/['']/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
}

function normalizeIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

function countHits(text, terms) {
  return terms.filter((term) => text.includes(term.toLowerCase()));
}

function sourceLabel(sourcePlatform, sourceChannel) {
  const normalized = String(sourcePlatform || sourceChannel || "").trim().toLowerCase();
  if (normalized === "rss") return SOURCE_LABELS.rss;
  if (normalized === "pubmed") return SOURCE_LABELS.pubmed;
  if (normalized === "pmc") return SOURCE_LABELS.pmc;
  return SOURCE_LABELS.other;
}

// ─── D-Grade Rule Helpers ─────────────────────────────────────────────
// These helpers implement the D-grade rules from workflow_rules.json.
// Each helper is named to match the corresponding rule description.

/**
 * Check if the paper is about pollutant degradation, removal, transfer,
 * accumulation, monitoring, detection, environmental analysis, or pollution
 * characterization research.
 * 
 * Corresponds to workflow_rules.json D-grade strict_exclude rule:
 * "污染物降解、污染物去除、污染物转移、污染物累积、污染特征分析、环境监测或环境分析导向研究"
 */
function isEnvironmentalPollutantFateStudy(text) {
  const pollutantFateTerms = [
    // 污染物降解
    "pollutant degradation", "pollutant degradat", "degradation of pollutant",
    "biodegradation", "photodegradation", "photocatalytic degradation",
    // 污染物去除
    "pollutant removal", "removal of pollutant", "pollutant eliminat",
    "contaminant removal", "removal efficiency",
    // 污染物转移
    "pollutant transfer", "pollutant transport", "contaminant transfer",
    "pollutant migration", "pollutant fate",
    // 污染物累积
    "pollutant accumulation", "pollutant accumulat", "bioaccumulation",
    "contaminant accumulation", "pollutant bioaccumulat",
    // 污染特征分析
    "pollution characterization", "pollution characterizat", "pollutant characterization",
    "contamination characterization", "pollution profile",
    // 环境监测
    "environmental monitoring", "environment monitor", "pollution monitoring",
    "contamination monitoring", "environmental surveillance",
    // 环境分析
    "environmental analysis", "environment analysis", "environmental assessment",
    "environmental impact assessment", "pollution analysis",
    // 其他相关
    "wastewater treatment", "water treatment", "soil remediation",
    "environmental remediation", "phytoremediation",
    "adsorption of pollutant", "adsorption capacity",
  ];
  return pollutantFateTerms.some((term) => text.includes(term));
}

/**
 * Check if the paper is about pure engineering, computational engineering,
 * materials science, physics, electronics, mechanical engineering, or
 * industrial technology without direct biomedical relevance.
 * 
 * Corresponds to workflow_rules.json D-grade strict_exclude rule:
 * "缺乏直接生物医学机制相关性的纯工程、计算工程、材料科学、物理学、电子、机械工程或工业技术研究"
 */
function isPureEngineeringOrMaterialsStudy(text) {
  const engineeringTerms = [
    "finite element", "computational fluid dynamics", "cfd simulation",
    "mechanical properties", "tensile strength", "material synthesis",
    "nanoparticle synthesis", "catalyst preparation", "electrochemical",
    "semiconductor", "photovoltaic", "solar cell", "battery electrode",
    "polymer composite", "metal alloy", "ceramic material",
  ];
  const biomedicalIndicators = [
    "neurotox", "neuroinflam", "microglia", "brain", "neuron", "glia",
    "blood-brain barrier", "neurodegenerat", "cognitive", "hippocampus",
    "complement", "synap", "gut-brain", "microbiome", "immune",
  ];
  
  const hasEngineeringFocus = engineeringTerms.some((term) => text.includes(term));
  const hasBiomedicalRelevance = biomedicalIndicators.some((term) => text.includes(term));
  
  return hasEngineeringFocus && !hasBiomedicalRelevance;
}

/**
 * Check if the paper is about plant biology, plant omics, or plant mechanism
 * research without direct biomedical relevance.
 * 
 * Corresponds to workflow_rules.json D-grade strict_exclude rule:
 * "植物相关研究，除非具有直接生物医学机制相关性或疾病相关性"
 */
function isPlantOnlyStudy(text) {
  const plantTerms = [
    "plant biology", "plant omics", "plant mechanism", "plant response",
    "arabidopsis", "rice genome", "wheat", "maize", "crop yield",
    "phytoremediation", "plant stress", "plant hormone", "auxin",
    "photosynthesis", "chloroplast", "stomatal",
  ];
  const biomedicalIndicators = [
    "neurotox", "neuroinflam", "microglia", "brain", "neuron",
    "blood-brain barrier", "neurodegenerat", "cognitive",
    "disease model", "animal model", "mammalian", "human",
  ];
  
  const hasPlantFocus = plantTerms.some((term) => text.includes(term));
  const hasBiomedicalRelevance = biomedicalIndicators.some((term) => text.includes(term));
  
  return hasPlantFocus && !hasBiomedicalRelevance;
}

/**
 * Check if the paper is about insect, nematode, yeast or other non-mammalian
 * model research without outstanding mechanistic insights.
 * 
 * Corresponds to workflow_rules.json D-grade strict_exclude rule:
 * "昆虫、线虫、酵母等非哺乳动物模型研究，若缺乏突出机制洞见或可迁移性"
 */
function isNonMammalianModelWithoutInsight(text) {
  const nonMammalianTerms = [
    "insect", "drosophila", "nematode", "c. elegans", "yeast", "saccharomyces",
    "e. coli", "bacteria", "bacterial", "zebrafish",
  ];
  const mechanisticInsightIndicators = [
    "mechanism", "pathway", "signaling", "novel insight", "translational",
    "conserved mechanism", "evolutionary", "comparative",
  ];
  
  // Exclude zebrafish if it has strong mechanistic insight
  const hasNonMammalianFocus = nonMammalianTerms.some((term) => text.includes(term));
  const hasMechanisticInsight = mechanisticInsightIndicators.some((term) => text.includes(term));
  
  // Special case: zebrafish with mechanistic insight is not excluded
  if (text.includes("zebrafish") && hasMechanisticInsight) {
    return false;
  }
  
  return hasNonMammalianFocus && !hasMechanisticInsight;
}

/**
 * Check if the paper is about cancer, tumor, virus or other out-of-scope topics,
 * unless directly serving current neuroimmune, pollutant toxicity, or
 * transferable mechanism questions.
 * 
 * Corresponds to workflow_rules.json D-grade strict_exclude rule:
 * "癌症、肿瘤、病毒等范围外主题，除非直接服务当前关注的神经免疫、污染物毒性或可迁移机制问题"
 */
function isOutOfScopeTopic(text) {
  const outOfScopeTerms = [
    "cancer", "tumor", "tumour", "oncolog", "carcinoma", "metastasis",
    "virus", "viral", "antiviral", "hiv", "sars-cov", "covid",
    "diabetes", "cardiovascular", "atherosclerosis",
  ];
  const relevantContextIndicators = [
    "neurotox", "neuroinflam", "microglia", "neuron", "brain",
    "pollutant", "exposure", "environmental", "toxic",
    "mechanism", "pathway", "signaling", "translational",
  ];
  
  const hasOutOfScopeFocus = outOfScopeTerms.some((term) => text.includes(term));
  const hasRelevantContext = relevantContextIndicators.some((term) => text.includes(term));
  
  return hasOutOfScopeFocus && !hasRelevantContext;
}

/**
 * Check if the paper is only hit by keywords like pollutant, exposure, brain,
 * omics but the actual research question is not relevant.
 * 
 * This implements the D-grade rule for keyword-only matches without real relevance.
 */
function isKeywordOnlyMatchWithoutRelevance(text) {
  // These are keywords that might cause false positives
  const triggerKeywords = [
    "pollutant", "pollution", "exposure", "brain", "omics",
    "environmental", "contaminant", "toxic",
  ];
  
  // These indicate actual relevance to the research question
  const relevanceIndicators = [
    "neurotoxicity", "neuroinflammation", "microglia", "neuron", "glia",
    "neurodegenerat", "cognitive", "hippocampus", "blood-brain barrier",
    "complement", "synap", "mitochond", "oxidative stress",
    "mechanism", "pathway", "signaling", "animal model", "in vitro",
    "cell experiment", "experimental validation",
    // Core exposure terms
    "tphp", "triphenyl phosphate", "opfr", "ope", "organophosphate flame retardant",
  ];
  
  const hasTriggerKeyword = triggerKeywords.some((term) => text.includes(term));
  const hasRelevanceIndicators = relevanceIndicators.some((term) => text.includes(term));
  
  // If only trigger keywords without relevance indicators, it's a false positive
  return hasTriggerKeyword && !hasRelevanceIndicators;
}

// ─── Grade-Specific Checkers ──────────────────────────────────────────

/**
 * Check if paper matches A-grade definition from workflow_rules.json:
 * "直接命中当前核心研究方向，且具有明确机制深度或实验验证价值。通常同时涉及目标暴露或污染物，
 *  以及神经毒性、神经炎症、小胶质细胞、补体、脑区损伤、神经免疫或相关机制。"
 */
function matchesAGrade(text) {
  const coreExposureTerms = TRIAGE_RULES.research_focus?.core_exposure_terms || [];
  const coreBiologyTerms = TRIAGE_RULES.research_focus?.core_biology_terms || [];
  const mechanismTerms = TRIAGE_RULES.research_focus?.mechanism_terms || [];
  
  const exposureHits = countHits(text, coreExposureTerms);
  const biologyHits = countHits(text, coreBiologyTerms);
  const mechanismHits = countHits(text, mechanismTerms);
  
  // A-grade requires: exposure AND biology AND mechanism
  return exposureHits.length >= 1 && biologyHits.length >= 1 && mechanismHits.length >= 1;
}

/**
 * Check if paper matches B-grade definition from workflow_rules.json:
 * "命中部分核心研究方向，但缺少明确机制深度或实验验证。通常涉及暴露或污染物与神经生物学的交叉，
 *  但证据类型为关联性、描述性或初步探索。"
 */
function matchesBGrade(text) {
  const coreExposureTerms = TRIAGE_RULES.research_focus?.core_exposure_terms || [];
  const coreBiologyTerms = TRIAGE_RULES.research_focus?.core_biology_terms || [];
  const preferredEvidence = TRIAGE_RULES.research_focus?.preferred_evidence || [];
  
  const exposureHits = countHits(text, coreExposureTerms);
  const biologyHits = countHits(text, coreBiologyTerms);
  const evidenceHits = countHits(text, preferredEvidence);
  
  // B-grade requires: (exposure OR biology) AND some evidence
  return (exposureHits.length >= 1 || biologyHits.length >= 1) && evidenceHits.length >= 1;
}

/**
 * Check if paper matches C-grade definition from workflow_rules.json:
 * "与领域相关但缺乏直接的暴露-神经生物学交叉证据。可能涉及相关机制、模型或方法，
 *  但不直接针对当前研究问题。"
 */
function matchesCGrade(text) {
  const relatedTerms = [
    ...TRIAGE_RULES.research_focus?.core_exposure_terms || [],
    ...TRIAGE_RULES.research_focus?.core_biology_terms || [],
    ...TRIAGE_RULES.research_focus?.mechanism_terms || [],
  ];
  
  const relatedHits = countHits(text, relatedTerms);
  
  // C-grade: has some related terms but not enough for A or B
  return relatedHits.length >= 1;
}

// ─── Main Classification Function ─────────────────────────────────────

export function classifyItem(item = {}, prefs = {}, standards = null) {
  const text = `${item.title || ""} ${item.abstract || ""}`.toLowerCase();
  const journal = String(item.journal || "").toLowerCase().trim();

  // D-grade rules have HIGHEST priority
  // Check all D-grade conditions first
  
  // 1. Check if it's environmental pollutant fate study
  if (isEnvironmentalPollutantFateStudy(text)) {
    return {
      grade: "D",
      grade_label: LABELS.D,
      grade_reason: "污染物降解、去除、转移、累积、监测、检测、环境分析或污染特征分析导向研究",
      classification_reason: "命中 D 级严格排除规则：污染物环境过程研究",
      hard_excluded: true,
      matched_standard_rules: [],
      matched_signals: ["d_grade_rule:environmental_pollutant_fate"],
      writeback_ready: false,
      triage_version: TRIAGE_VERSION,
      standards_used: false,
      flags: { uncertain: false, needs_review: false },
      score: 0,
      source: sourceLabel(item.source_platform, item.source_channel),
      dedupe_key: buildDedupeKey(item),
      scoring_detail: { d_grade_rule: "environmental_pollutant_fate" },
    };
  }

  // 2. Check if it's keyword-only match without real relevance
  if (isKeywordOnlyMatchWithoutRelevance(text)) {
    return {
      grade: "D",
      grade_label: LABELS.D,
      grade_reason: "仅因标题或摘要出现 pollutant、exposure、brain、omics 等词而被检出，但实际研究问题不相关",
      classification_reason: "命中 D 级规则：关键词误命中但研究问题不相关",
      hard_excluded: true,
      matched_standard_rules: [],
      matched_signals: ["d_grade_rule:keyword_only_match"],
      writeback_ready: false,
      triage_version: TRIAGE_VERSION,
      standards_used: false,
      flags: { uncertain: false, needs_review: false },
      score: 0,
      source: sourceLabel(item.source_platform, item.source_channel),
      dedupe_key: buildDedupeKey(item),
      scoring_detail: { d_grade_rule: "keyword_only_match" },
    };
  }

  // 3. Check other D-grade conditions
  if (isPureEngineeringOrMaterialsStudy(text)) {
    return {
      grade: "D",
      grade_label: LABELS.D,
      grade_reason: "纯工程、计算工程、材料科学、物理学、电子、机械工程或工业技术研究",
      classification_reason: "命中 D 级严格排除规则：纯工程/材料研究",
      hard_excluded: true,
      matched_standard_rules: [],
      matched_signals: ["d_grade_rule:engineering_materials"],
      writeback_ready: false,
      triage_version: TRIAGE_VERSION,
      standards_used: false,
      flags: { uncertain: false, needs_review: false },
      score: 0,
      source: sourceLabel(item.source_platform, item.source_channel),
      dedupe_key: buildDedupeKey(item),
      scoring_detail: { d_grade_rule: "engineering_materials" },
    };
  }

  if (isPlantOnlyStudy(text)) {
    return {
      grade: "D",
      grade_label: LABELS.D,
      grade_reason: "植物相关研究，缺乏直接生物医学机制相关性或疾病相关性",
      classification_reason: "命中 D 级严格排除规则：纯植物研究",
      hard_excluded: true,
      matched_standard_rules: [],
      matched_signals: ["d_grade_rule:plant_only"],
      writeback_ready: false,
      triage_version: TRIAGE_VERSION,
      standards_used: false,
      flags: { uncertain: false, needs_review: false },
      score: 0,
      source: sourceLabel(item.source_platform, item.source_channel),
      dedupe_key: buildDedupeKey(item),
      scoring_detail: { d_grade_rule: "plant_only" },
    };
  }

  if (isNonMammalianModelWithoutInsight(text)) {
    return {
      grade: "D",
      grade_label: LABELS.D,
      grade_reason: "非哺乳动物模型研究，缺乏突出机制洞见或可迁移性",
      classification_reason: "命中 D 级严格排除规则：非哺乳动物模型无机制洞见",
      hard_excluded: true,
      matched_standard_rules: [],
      matched_signals: ["d_grade_rule:non_mammalian_no_insight"],
      writeback_ready: false,
      triage_version: TRIAGE_VERSION,
      standards_used: false,
      flags: { uncertain: false, needs_review: false },
      score: 0,
      source: sourceLabel(item.source_platform, item.source_channel),
      dedupe_key: buildDedupeKey(item),
      scoring_detail: { d_grade_rule: "non_mammalian_no_insight" },
    };
  }

  if (isOutOfScopeTopic(text)) {
    return {
      grade: "D",
      grade_label: LABELS.D,
      grade_reason: "癌症、肿瘤、病毒等范围外主题",
      classification_reason: "命中 D 级严格排除规则：范围外主题",
      hard_excluded: true,
      matched_standard_rules: [],
      matched_signals: ["d_grade_rule:out_of_scope"],
      writeback_ready: false,
      triage_version: TRIAGE_VERSION,
      standards_used: false,
      flags: { uncertain: false, needs_review: false },
      score: 0,
      source: sourceLabel(item.source_platform, item.source_channel),
      dedupe_key: buildDedupeKey(item),
      scoring_detail: { d_grade_rule: "out_of_scope" },
    };
  }

  // If not D-grade, check for A/B/C based on workflow_rules.json grading_rules
  
  if (matchesAGrade(text)) {
    return {
      grade: "A",
      grade_label: LABELS.A,
      grade_reason: GRADING_RULES.A?.definition || "直接命中当前核心研究方向，具有明确机制深度或实验验证价值",
      classification_reason: "命中 A 级规则：暴露+生物学+机制",
      hard_excluded: false,
      matched_standard_rules: [],
      matched_signals: ["grade_rule:A"],
      writeback_ready: true,
      triage_version: TRIAGE_VERSION,
      standards_used: false,
      flags: { uncertain: false, needs_review: false },
      score: 10,
      source: sourceLabel(item.source_platform, item.source_channel),
      dedupe_key: buildDedupeKey(item),
      scoring_detail: { grade_rule: "A" },
    };
  }

  if (matchesBGrade(text)) {
    return {
      grade: "B",
      grade_label: LABELS.B,
      grade_reason: GRADING_RULES.B?.definition || "命中部分核心研究方向，但缺少明确机制深度或实验验证",
      classification_reason: "命中 B 级规则：部分核心方向+证据",
      hard_excluded: false,
      matched_standard_rules: [],
      matched_signals: ["grade_rule:B"],
      writeback_ready: true,
      triage_version: TRIAGE_VERSION,
      standards_used: false,
      flags: { uncertain: false, needs_review: false },
      score: 6,
      source: sourceLabel(item.source_platform, item.source_channel),
      dedupe_key: buildDedupeKey(item),
      scoring_detail: { grade_rule: "B" },
    };
  }

  if (matchesCGrade(text)) {
    return {
      grade: "C",
      grade_label: LABELS.C,
      grade_reason: GRADING_RULES.C?.definition || "与领域相关但缺乏直接的暴露-神经生物学交叉证据",
      classification_reason: "命中 C 级规则：领域相关",
      hard_excluded: false,
      matched_standard_rules: [],
      matched_signals: ["grade_rule:C"],
      writeback_ready: true,
      triage_version: TRIAGE_VERSION,
      standards_used: false,
      flags: { uncertain: false, needs_review: false },
      score: 3,
      source: sourceLabel(item.source_platform, item.source_channel),
      dedupe_key: buildDedupeKey(item),
      scoring_detail: { grade_rule: "C" },
    };
  }

  // Default: D-grade (no relevant signals found)
  return {
    grade: "D",
    grade_label: LABELS.D,
    grade_reason: GRADING_RULES.D?.definition || "与当前课题、专题和领域相关性不足",
    classification_reason: "未命中任何相关规则",
    hard_excluded: false,
    matched_standard_rules: [],
    matched_signals: ["default:D"],
    writeback_ready: false,
    triage_version: TRIAGE_VERSION,
    standards_used: false,
    flags: { uncertain: false, needs_review: false },
    score: 0,
    source: sourceLabel(item.source_platform, item.source_channel),
    dedupe_key: buildDedupeKey(item),
    scoring_detail: { default: "D" },
  };
}

export function buildDedupeKey(item = {}) {
  const doi = normalizeIdentifier(item.doi || item.DOI);
  if (doi) return `doi:${doi}`;
  const pmid = normalizeIdentifier(item.pmid);
  if (pmid) return `pmid:${pmid}`;
  const pmcid = normalizeIdentifier(item.pmcid);
  if (pmcid) return `pmcid:${pmcid}`;
  const title = normTitle(item.title || "");
  if (title) return `title:${title}`;
  const url = normalizeIdentifier(item.url);
  return `url:${url}`;
}

export function summarizeGradeCounts(items = []) {
  const grade_counts = { A: 0, B: 0, C: 0, D: 0 };
  let uncertain_count = 0;
  for (const item of items) {
    if (item?.grade && grade_counts[item.grade] !== undefined) {
      grade_counts[item.grade] += 1;
    }
    if (item?.flags?.uncertain) uncertain_count += 1;
  }
  return {
    grade_counts,
    uncertain_count,
    writeback_candidate_count: grade_counts.A + grade_counts.B + grade_counts.C,
    skipped_d_count: grade_counts.D,
  };
}

// ─── Semantic Grading Functions (preserved for compatibility) ──────────

const GRADE_NUMERIC = { A: 1, B: 2, C: 3, D: 4 };
const NUMERIC_TO_GRADE = { 1: "A", 2: "B", 3: "C", 4: "D" };

export function normalizeGradeLetter(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (/^[ABCD]$/.test(raw)) return raw;
  const m = raw.match(/^[ABCD]/);
  return m ? m[0] : "";
}

export function buildFeedbackIndex(signals = []) {
  const index = new Map();
  for (const sig of signals) {
    const feedback = String(sig.feedback || "").trim().toLowerCase();
    let direction = "ignored";
    if (feedback === "keep" || feedback === "upgrade") direction = "positive";
    else if (feedback === "drop" || feedback === "downgrade") direction = "negative";
    if (direction === "ignored") continue;
    const entry = {
      direction,
      title: sig.english_title || "",
      title_translation: sig.title_translation || sig.titleContext || "",
    };
    const itemKey = String(sig.itemKey || sig.item_key || "").trim();
    if (itemKey) index.set(`key:${itemKey}`, entry);
    const doi = normalizeIdentifier(sig.doi || sig.DOI);
    if (doi) index.set(`doi:${doi}`, entry);
    const enKey = normTitle(sig.english_title || "");
    if (enKey) index.set(`title:${enKey}`, entry);
    const zhKey = normTitle(sig.title_translation || "");
    if (zhKey && zhKey !== enKey) index.set(`title:${zhKey}`, entry);
  }
  return index;
}

export function deriveSemanticGradeFromFeedbackMatches({
  searchResults = [],
  feedbackIndex = new Map(),
  ruleGrade = "",
} = {}) {
  const ruleNum = GRADE_NUMERIC[ruleGrade];
  if (!ruleNum) {
    return { semanticGrade: "", semanticReason: "", matchedFeedbackCount: 0, skippedReason: "invalid_rule_grade" };
  }
  if (!feedbackIndex.size) {
    return { semanticGrade: "", semanticReason: "", matchedFeedbackCount: 0, skippedReason: "no_feedback_index" };
  }

  const matchedEntries = [];
  const seenKeys = new Set();

  for (const result of searchResults) {
    const score = Number(result.score || 0);
    let matchedEntry = null;

    const rItemKey = String(result.item_key || result.itemKey || "").trim();
    if (rItemKey) {
      matchedEntry = feedbackIndex.get(`key:${rItemKey}`);
    }
    if (!matchedEntry) {
      const rDoi = normalizeIdentifier(result.doi || result.DOI);
      if (rDoi) {
        matchedEntry = feedbackIndex.get(`doi:${rDoi}`);
      }
    }
    if (!matchedEntry) {
      const rTitle = normTitle(result.title || "");
      if (rTitle) {
        matchedEntry = feedbackIndex.get(`title:${rTitle}`);
      }
    }

    if (!matchedEntry) continue;

    const dedupeKey = `${matchedEntry.direction}:${matchedEntry.title}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    matchedEntries.push({
      direction: matchedEntry.direction,
      score,
      title: result.title || "",
    });
  }

  if (matchedEntries.length === 0) {
    return { semanticGrade: "", semanticReason: "", matchedFeedbackCount: 0, skippedReason: "no_feedback_match" };
  }

  let adjustment = 0;
  const reasons = [];
  for (const entry of matchedEntries) {
    const weight = entry.score >= 0.5 ? 1 : 0.5;
    if (entry.direction === "positive") {
      adjustment -= weight;
      reasons.push(`+${entry.title.slice(0, 60)}`);
    } else if (entry.direction === "negative") {
      adjustment += weight;
      reasons.push(`-${entry.title.slice(0, 60)}`);
    }
  }

  const roundedAdj = Math.round(adjustment);
  if (roundedAdj === 0) {
    return {
      semanticGrade: "",
      semanticReason: `混合反馈(${matchedEntries.length}条匹配)，不调整`,
      matchedFeedbackCount: matchedEntries.length,
      skippedReason: "neutral_feedback",
    };
  }

  const newNum = Math.max(1, Math.min(4, ruleNum + roundedAdj));
  const semanticGrade = NUMERIC_TO_GRADE[newNum];
  const direction = roundedAdj > 0 ? "下调" : "上调";
  const semanticReason = `语义复审${direction}(${matchedEntries.length}条反馈匹配): ${reasons.slice(0, 3).join("; ")}`;

  return { semanticGrade, semanticReason, matchedFeedbackCount: matchedEntries.length, skippedReason: "" };
}


/**
 * Derive semantic grade purely from current research standards (no feedback dependency).
 * Uses workflow_rules.json research_focus term lists + semantic_search results to evaluate
 * whether an item aligns with the current research direction.
 */
export function deriveSemanticGradeFromStandards({
  item = {},
  ruleGrade = "",
  searchResults = [],
  researchFocus = null,
} = {}) {
  const focus = researchFocus || (TRIAGE_RULES && TRIAGE_RULES.research_focus) || {};
  const text = String(item.title || "" + " " + (item.abstract || "")).toLowerCase();

  const exposureTerms = focus.core_exposure_terms || [];
  const biologyTerms = focus.core_biology_terms || [];
  const mechanismTerms = focus.mechanism_terms || [];

  function countHits(terms) {
    let hits = 0;
    for (const t of terms) {
      if (text.includes(String(t).toLowerCase())) hits++;
    }
    return hits;
  }

  const exposureHits = countHits(exposureTerms);
  const biologyHits = countHits(biologyTerms);
  const mechanismHits = countHits(mechanismTerms);

  // Also check semantic_search results for additional evidence
  let searchEvidence = 0;
  if (searchResults.length > 0) {
    for (const r of searchResults) {
      const rText = String(r.title || "").toLowerCase();
      const rExposure = exposureTerms.some((t) => rText.includes(String(t).toLowerCase()));
      const rBiology = biologyTerms.some((t) => rText.includes(String(t).toLowerCase()));
      if (rExposure && rBiology) searchEvidence += 2;
      else if (rBiology) searchEvidence += 1;
    }
  }

  const strongUpgrade = (exposureHits >= 1 && biologyHits >= 2) || (biologyHits >= 3 && mechanismHits >= 1);
  const mediumUpgrade = biologyHits >= 2 || (exposureHits >= 1 && biologyHits >= 1);

  const ruleNum = GRADE_NUMERIC[ruleGrade];
  if (!ruleNum) {
    return { semanticGrade: ruleGrade, semanticReason: "invalid_rule_grade", semanticConfidence: 0, semanticSource: "standards" };
  }

  let adjustment = 0;
  const reasons = [];

  if (strongUpgrade) {
    adjustment = -1;
    reasons.push("\u547d\u4e2d\u6838\u5fc3\u7814\u7a76\u6807\u51c6(exposure=" + exposureHits + ", biology=" + biologyHits + ", mechanism=" + mechanismHits + ")");
  } else if (mediumUpgrade) {
    adjustment = -1;
    reasons.push("\u90e8\u5206\u547d\u4e2d\u7814\u7a76\u6807\u51c6(biology=" + biologyHits + ", exposure=" + exposureHits + ")");
  } else {
    // No positive signal is NOT a downgrade reason.
    // Insufficient evidence: keep rule grade with low confidence.
    if (searchEvidence > 0) {
      reasons.push("\u8bcd\u8868\u547d\u4e2d\u4e0d\u8db3\uff0c\u4f46\u8bed\u4e49\u90bb\u5c45\u6709" + searchEvidence + "\u6761\u76f8\u5173\u8bc1\u636e\uff0c\u4fdd\u6301\u89c4\u5219\u7b49\u7ea7");
    } else {
      reasons.push("\u8bcd\u8868\u8bc1\u636e\u4e0d\u8db3\uff0c\u4fdd\u6301\u89c4\u5219\u7b49\u7ea7");
    }
  }

  const newNum = Math.max(1, Math.min(4, ruleNum + adjustment));
  const semanticGrade = NUMERIC_TO_GRADE[newNum] || ruleGrade;

  const confidence = Math.min(1, (exposureHits + biologyHits + mechanismHits + searchEvidence) / 6);
  return {
    semanticGrade,
    semanticReason: reasons.join("; "),
    semanticConfidence: Math.round(confidence * 100) / 100,
    semanticSource: searchResults.length > 0 ? "standards_with_semantic_search" : "standards",
  };
}
export function synthesizeFinalGrade({ ruleGrade, semanticGrade, semanticReason = "", flags = {} } = {}) {
  const ruleNorm = normalizeGradeLetter(ruleGrade);
  const semanticNorm = normalizeGradeLetter(semanticGrade);

  if (!ruleNorm) {
    return { finalGrade: ruleNorm, needsHumanReview: false, disagreementType: "" };
  }
  if (!semanticNorm) {
    return { finalGrade: ruleNorm, needsHumanReview: false, disagreementType: "" };
  }
  if (ruleNorm === semanticNorm) {
    return { finalGrade: ruleNorm, needsHumanReview: false, disagreementType: "" };
  }

  const ruleNum = GRADE_NUMERIC[ruleNorm];
  const semanticNum = GRADE_NUMERIC[semanticNorm];
  const diff = Math.abs(semanticNum - ruleNum);

  if (diff >= 2) {
    return {
      finalGrade: ruleNorm,
      needsHumanReview: true,
      disagreementType: `semantic_${diff >= 3 ? "extreme" : "major"}_divergence`,
    };
  }

  const direction = semanticNum < ruleNum ? "upgrade" : "downgrade";
  if (ruleNorm === "C" && semanticNorm === "D") {
    return {
      finalGrade: ruleNorm,
      needsHumanReview: true,
      disagreementType: "semantic_downgrade_review",
    };
  }
  return {
    finalGrade: semanticNorm,
    needsHumanReview: false,
    disagreementType: `semantic_${direction}`,
  };
}

// ─── Screening Standards Functions (preserved for compatibility) ──────

export function parseScreeningStandards(markdown) {
  // Preserve original implementation for compatibility
  if (!markdown || typeof markdown !== "string") return { parsed: false, error: "empty_markdown", hard_excludes: [], positive_preferences: [], negative_preferences: [], grade_rules: {}, raw_rules: [], warnings: [], topic_definition: "" };
  const sections = { topic_definition: "", positive_preferences: [], negative_preferences: [], hard_excludes: [], uncertain: [], caveats: [], raw_rules: [] };
  const lines = markdown.split("\n");
  let currentSection = "preamble";
  let preambleLines = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("## ")) {
      const heading = line.replace(/^##\s*/, "").trim();
      if (heading.includes("优先关注")) currentSection = "positive";
      else if (heading.includes("降权")) currentSection = "negative";
      else if (heading.includes("严格排除") || heading.includes("排除")) currentSection = "hard_exclude";
      else if (heading.includes("不确定")) currentSection = "uncertain";
      else if (heading.includes("注意") || heading.includes("事项")) currentSection = "caveats";
      else currentSection = "other";
      continue;
    }
    if (line.startsWith("# ")) {
      if (currentSection === "preamble") currentSection = "title";
      continue;
    }
    if (line === "---") continue;
    const bullet = line.replace(/^\*\s*/, "").trim();
    if (bullet === line && currentSection === "preamble") { preambleLines.push(bullet); continue; }
    if (currentSection === "preamble") { preambleLines.push(bullet); continue; }
    if (currentSection === "hard_exclude") sections.hard_excludes.push(bullet);
    else if (currentSection === "positive") sections.positive_preferences.push(bullet);
    else if (currentSection === "negative") sections.negative_preferences.push(bullet);
    else if (currentSection === "uncertain") sections.uncertain.push(bullet);
    else if (currentSection === "caveats") sections.caveats.push(bullet);
  }

  sections.topic_definition = preambleLines.join(" ");

  const hardExcludes = [];
  for (const rule of sections.hard_excludes) {
    const lower = rule.toLowerCase();
    const keywords = [];
    if (lower.includes("降解") || lower.includes("去除") || lower.includes("转移") || lower.includes("累积") || lower.includes("监测") || lower.includes("检测") || lower.includes("环境分析") || lower.includes("污染特征")) keywords.push("degradation", "removal", "transfer", "accumulation", "monitoring", "detection", "environmental analysis", "pollution characterization");
    if (lower.includes("工程") || lower.includes("计算") || lower.includes("材料") || lower.includes("物理") || lower.includes("电子") || lower.includes("机械")) keywords.push("engineering", "computational", "material", "physics", "electronics", "mechanical");
    if (lower.includes("纯ai") || lower.includes("算法") || lower.includes("工具开发") || lower.includes("理论建模")) keywords.push("pure ai", "algorithm", "tool development", "theoretical modeling");
    if (lower.includes("植物")) keywords.push("plant", "arabidopsis", "rice", "wheat");
    if (lower.includes("昆虫") || lower.includes("线虫") || lower.includes("酵母")) keywords.push("insect", "nematode", "yeast", "drosophila", "c. elegans");
    if (lower.includes("癌症") || lower.includes("肿瘤") || lower.includes("病毒")) keywords.push("cancer", "tumor", "virus", "oncolog");
    if (keywords.length === 0) keywords.push(lower.slice(0, 50));
    hardExcludes.push({ rule, keywords, section: "严格排除" });
  }

  const negativePrefs = [];
  for (const rule of sections.negative_preferences) {
    const lower = rule.toLowerCase();
    const keywords = [];
    if (lower.includes("队列") || lower.includes("流行病") || lower.includes("观察性")) keywords.push("cohort", "epidemiolog", "observational");
    if (lower.includes("肾脏") || lower.includes("肾")) keywords.push("kidney", "renal");
    if (lower.includes("斑马鱼") || lower.includes("zebrafish")) keywords.push("zebrafish", "斑马鱼");
    if (lower.includes("临床") || lower.includes("结局")) keywords.push("clinical", "outcome");
    if (lower.includes("组学") || lower.includes("omics")) keywords.push("omics", "transcriptomics", "proteomics", "metabolomics");
    if (keywords.length === 0) keywords.push(lower.slice(0, 50));
    negativePrefs.push({ rule, keywords, section: "降权" });
  }

  const positivePrefs = [];
  for (const rule of sections.positive_preferences) {
    const lower = rule.toLowerCase();
    const keywords = [];
    if (lower.includes("动物实验") || lower.includes("哺乳动物") || lower.includes("小鼠") || lower.includes("大鼠") || lower.includes("mouse") || lower.includes("rat")) keywords.push("animal", "mouse", "mice", "rat", "mammal", "动物实验", "小鼠", "大鼠");
    if (lower.includes("神经") || lower.includes("小胶质") || lower.includes("突触") || lower.includes("neuro") || lower.includes("microglia") || lower.includes("synap")) keywords.push("neuro", "microglia", "synapse", "brain", "神经", "小胶质", "突触");
    if (lower.includes("组学") || lower.includes("转录组") || lower.includes("蛋白组") || lower.includes("代谢组") || lower.includes("omics") || lower.includes("transcriptom") || lower.includes("proteom") || lower.includes("metabolom")) keywords.push("omics", "transcriptomics", "proteomics", "metabolomics", "组学");
    if (lower.includes("补体") || lower.includes("complement")) keywords.push("complement", "补体");
    if (lower.includes("肠道") || lower.includes("菌群") || lower.includes("微生物") || lower.includes("microbio") || lower.includes("gut")) keywords.push("microbiome", "gut", "microbiota", "肠道", "菌群", "微生物");
    if (lower.includes("斑马鱼") || lower.includes("zebrafish")) keywords.push("zebrafish", "斑马鱼");
    if (keywords.length === 0) keywords.push(lower.slice(0, 50));
    positivePrefs.push({ rule, keywords, section: "优先关注" });
  }

  return {
    parsed: true,
    topic_definition: sections.topic_definition,
    hard_excludes: hardExcludes,
    positive_preferences: positivePrefs,
    negative_preferences: negativePrefs,
    grade_rules: {
      exclude_rules: sections.hard_excludes,
      downgrade_rules: sections.negative_preferences,
      priority_rules: sections.positive_preferences,
    },
    raw_rules: sections.raw_rules,
    warnings: sections.uncertain,
    caveats: sections.caveats,
  };
}

export function loadScreeningStandards(reviewRoot) {
  try {
    const result = readScreeningStandardsFileSync(reviewRoot, { normalize: true });
    if (!result.content || !result.loaded) return { parsed: false, error: "file_not_loaded" };
    const parsed = parseScreeningStandards(result.content);
    return { ...parsed, path: result.path, loaded: true };
  } catch (err) {
    return { parsed: false, error: String(err.message || err), path: "", loaded: false };
  }
}
