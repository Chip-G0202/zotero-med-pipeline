import { loadWorkflowRules } from "./literature_config.mjs";

import { readScreeningStandardsFileSync } from "./screening_standards_file.mjs";

const WORKFLOW_RULES = loadWorkflowRules().config;
const TRIAGE_RULES = WORKFLOW_RULES.triage || {};

export const TRIAGE_VERSION = TRIAGE_RULES.version || "2026-05-21-v2";

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

const POLLUTANT_TERMS = TRIAGE_RULES.terms?.pollutant || ["pollution", "pollutant", "microplastic", "pm2.5", "pfas", "exposure", "toxic"];
const CORE_TOPIC_TERMS = TRIAGE_RULES.terms?.core_topic || ["microglia", "neuroinflamm", "brain", "cognitive", "mitochond", "synap", "neurotox"];
const MECHANISM_TERMS = TRIAGE_RULES.terms?.mechanism || ["pathway", "mechanism", "axis", "oxidative", "omics", "signaling", "model"];
const JOURNAL_WHITELIST = new Set(TRIAGE_RULES.journal_whitelist || [
  "nature", "nature neuroscience", "nature reviews neuroscience", "science", "science advances", "cell", "cell reports", "neuron", "environmental health perspectives", "environmental science & technology", "environment international", "environmental pollution", "journal of neuroinflammation",
]);
const WEIGHTS = {
  pollutant: Number(TRIAGE_RULES.weights?.pollutant ?? 1.6),
  core_topic: Number(TRIAGE_RULES.weights?.core_topic ?? 1.5),
  mechanism: Number(TRIAGE_RULES.weights?.mechanism ?? 0.7),
  journal_quality: Number(TRIAGE_RULES.weights?.journal_quality ?? 1.2),
  feedback_positive: Number(TRIAGE_RULES.weights?.feedback_positive ?? 0.6),
  feedback_negative: Number(TRIAGE_RULES.weights?.feedback_negative ?? -1.0),
};
const THRESHOLDS = {
  A_score: Number(TRIAGE_RULES.thresholds?.A_score ?? 6.0),
  A_min_pollutant_hits: Number(TRIAGE_RULES.thresholds?.A_min_pollutant_hits ?? 2),
  A_min_core_hits: Number(TRIAGE_RULES.thresholds?.A_min_core_hits ?? 2),
  B_score: Number(TRIAGE_RULES.thresholds?.B_score ?? 3.4),
  C_score: Number(TRIAGE_RULES.thresholds?.C_score ?? 1.4),
  B_uncertain_below: Number(TRIAGE_RULES.thresholds?.B_uncertain_below ?? 4.2),
  C_uncertain_below: Number(TRIAGE_RULES.thresholds?.C_uncertain_below ?? 2.3),
};
const GRADE_REASONS = TRIAGE_RULES.grade_reasons || {};

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
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
}

function normalizeIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

function countHits(text, terms) {
  return terms.filter((term) => text.includes(term));
}

function sourceLabel(sourcePlatform, sourceChannel) {
  const normalized = String(sourcePlatform || sourceChannel || "").trim().toLowerCase();
  if (normalized === "rss") return SOURCE_LABELS.rss;
  if (normalized === "pubmed") return SOURCE_LABELS.pubmed;
  if (normalized === "pmc") return SOURCE_LABELS.pmc;
  return SOURCE_LABELS.other;
}

export function parseScreeningStandards(markdown) {
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
    else if (currentSection === "other") sections.raw_rules.push(bullet);
  }
  sections.topic_definition = preambleLines.join(" ").trim();

  const hardExcludes = [];
  for (const rule of sections.hard_excludes) {
    const lower = rule.toLowerCase();
    const keywords = [];
    if (lower.includes("癌症") || lower.includes("肿瘤") || lower.includes("cancer") || lower.includes("tumo")) keywords.push("cancer", "tumor", "tumour", "carcinoma", "neoplas", "malignan", "癌症", "肿瘤", "癌");
    if (lower.includes("病毒") || lower.includes("virus") || lower.includes("viral")) keywords.push("virus", "viral", "virome", "病毒");
    if (lower.includes("植物") || lower.includes("plant") || lower.includes("arabidopsis")) keywords.push("plant", "arabidopsis", "植物", "botanical");
    if (lower.includes("水生") || lower.includes("鱼类") || lower.includes("两栖") || lower.includes("aquatic") || lower.includes("fish") || lower.includes("amphibian") || lower.includes("zebrafish")) keywords.push("aquatic", "fish", "amphibian", "zebrafish", "水生", "鱼类", "两栖", "斑马鱼");
    if (lower.includes("虫类") || lower.includes("昆虫") || lower.includes("线虫") || lower.includes("节肢") || lower.includes("insect") || lower.includes("nematode") || lower.includes("drosophila") || lower.includes("arthropod")) keywords.push("insect", "nematode", "drosophila", "arthropod", "昆虫", "线虫", "果蝇", "节肢");
    if (lower.includes("环境科学") || lower.includes("生态毒理") || lower.includes("环境工程") || lower.includes("污染物降解") || lower.includes("环境化学") || lower.includes("environmental") || lower.includes("ecotoxicolog")) keywords.push("environmental", "ecotoxicology", "环境科学", "生态毒理", "环境工程", "污染物降解");
    if (lower.includes("工程") || lower.includes("材料科学") || lower.includes("物理") || lower.includes("电子") || lower.includes("机械") || lower.includes("computational engineer") || lower.includes("engineering")) keywords.push("engineering", "computational", "material science", "physics", "工程", "材料科学");
    if (lower.includes("方法学") || lower.includes("算法") || lower.includes("工具开发") || lower.includes("ai ") || lower.includes("artificial intelligence") || lower.includes("machine learning") || lower.includes("deep learning")) keywords.push("methodological", "algorithm", "tool development", "artificial intelligence", "machine learning", "deep learning", "方法学", "算法", "工具开发");
    if (keywords.length === 0) keywords.push(lower.slice(0, 60));
    hardExcludes.push({ rule, keywords, section: "严格排除" });
  }

  const negativePrefs = [];
  for (const rule of sections.negative_preferences) {
    const lower = rule.toLowerCase();
    const keywords = [];
    if (lower.includes("人群队列") || lower.includes("流行病") || lower.includes("cohort") || lower.includes("epidemiolog")) keywords.push("cohort", "epidemiology", "人群队列", "流行病学");
    if (lower.includes("肾脏") || lower.includes("renal") || lower.includes("kidney")) keywords.push("renal", "kidney", "肾脏", "肾病");
    if (lower.includes("果蝇") || lower.includes("线虫") || lower.includes("酵母") || lower.includes("drosophila") || lower.includes("yeast")) keywords.push("drosophila", "yeast", "nematode", "果蝇", "线虫", "酵母");
    if (lower.includes("纯描述") || lower.includes("descriptive")) keywords.push("descriptive", "描述性");
    if (lower.includes("非医学") || lower.includes("无关疾病")) keywords.push("non-medical", "非医学", "无关疾病");
    if (keywords.length === 0) keywords.push(lower.slice(0, 50));
    negativePrefs.push({ rule, keywords, section: "相对降权" });
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

function checkHardExcludes(text, standards) {
  if (!standards?.parsed || !standards.hard_excludes?.length) return { excluded: false, matched_rules: [] };
  const lower = (text || "").toLowerCase();
  const matched = [];
  for (const rule of standards.hard_excludes) {
    const hits = rule.keywords.filter((kw) => lower.includes(kw.toLowerCase()));
    if (hits.length >= 1) matched.push({ rule: rule.rule, section: rule.section, keyword_hits: hits });
  }
  return { excluded: matched.length > 0, matched_rules: matched };
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

export function classifyItem(item = {}, prefs = {}, standards = null) {
  const text = `${item.title || ""} ${item.abstract || ""}`.toLowerCase();
  const journal = String(item.journal || "").toLowerCase().trim();

  const hardCheck = standards?.parsed ? checkHardExcludes(text, standards) : { excluded: false, matched_rules: [] };
  const hardExcluded = hardCheck.excluded;
  const matchedStandardRules = hardCheck.matched_rules;

  const pollutantHits = countHits(text, POLLUTANT_TERMS);
  const coreHits = countHits(text, CORE_TOPIC_TERMS);
  const mechanismHits = countHits(text, MECHANISM_TERMS);
  const positiveHits = countHits(text, prefs.hardPositiveTerms || []);
  const negativeHits = countHits(text, prefs.hardNegativeTerms || []);
  const qualityHit = JOURNAL_WHITELIST.has(journal);

  let score = 0;
  score += Math.min(pollutantHits.length, 3) * WEIGHTS.pollutant;
  score += Math.min(coreHits.length, 4) * WEIGHTS.core_topic;
  score += Math.min(mechanismHits.length, 4) * WEIGHTS.mechanism;
  score += qualityHit ? WEIGHTS.journal_quality : 0;
  score += Math.min(positiveHits.length, 3) * WEIGHTS.feedback_positive;
  score += Math.min(negativeHits.length, 3) * WEIGHTS.feedback_negative;
  score = Number(score.toFixed(2));

  let grade = "D";
  let classificationReason = "";

  if (hardExcluded) {
    grade = "D";
    classificationReason = `命中严格排除规则: ${matchedStandardRules.map((r) => r.rule.slice(0, 80)).join("; ")}`;
  } else if (pollutantHits.length >= THRESHOLDS.A_min_pollutant_hits && coreHits.length >= THRESHOLDS.A_min_core_hits && score >= THRESHOLDS.A_score) {
    grade = "A";
    classificationReason = GRADE_REASONS.A || "直接命中当前课题关键词组合。";
  } else if ((pollutantHits.length >= 1 || coreHits.length >= 1) && (mechanismHits.length >= 1 || qualityHit) && score >= THRESHOLDS.B_score) {
    grade = "B";
    classificationReason = GRADE_REASONS.B || "与当前专题或邻近专题明显相关。";
  } else if (score >= THRESHOLDS.C_score && text.length > 20) {
    grade = "C";
    classificationReason = GRADE_REASONS.C || "与所在研究领域相关，低优先级保留。";
  } else {
    grade = "D";
    classificationReason = GRADE_REASONS.D || "与当前课题、专题和领域相关性不足。";
  }

  const uncertain = (grade === "B" && score < THRESHOLDS.B_uncertain_below) || (grade === "C" && score < THRESHOLDS.C_uncertain_below) || (grade === "D" && score > 0 && !hardExcluded);
  const needsReview = uncertain;

  const matchedSignals = [
    ...pollutantHits.map((term) => `pollutant:${term}`),
    ...coreHits.map((term) => `topic:${term}`),
    ...mechanismHits.map((term) => `mechanism:${term}`),
    ...positiveHits.map((term) => `feedback_positive:${term}`),
    ...negativeHits.map((term) => `feedback_negative:${term}`),
    ...(qualityHit ? [`journal:${journal}`] : []),
  ];

  const reasons = {
    A: GRADE_REASONS.A || "直接命中当前课题关键词组合，与核心课题问题高度贴合。",
    B: GRADE_REASONS.B || "与当前专题或邻近专题明显相关，可作为专题背景或方法参考。",
    C: GRADE_REASONS.C || "与所在研究领域相关，但距离当前课题和专题较远，低优先级保留。",
    D: GRADE_REASONS.D || "与当前课题、专题和领域相关性不足，仅保留审计记录。",
  };

  return {
    grade,
    grade_label: LABELS[grade],
    grade_reason: reasons[grade],
    classification_reason: classificationReason,
    hard_excluded: hardExcluded,
    matched_standard_rules: matchedStandardRules,
    matched_signals: matchedSignals,
    writeback_ready: grade !== "D",
    triage_version: TRIAGE_VERSION,
    standards_used: Boolean(standards?.parsed),
    flags: {
      uncertain,
      needs_review: needsReview,
    },
    score,
    source: sourceLabel(item.source_platform, item.source_channel),
    dedupe_key: buildDedupeKey(item),
    scoring_detail: {
      pollutant_hits: pollutantHits,
      core_hits: coreHits,
      mechanism_hits: mechanismHits,
      positive_hits: positiveHits,
      negative_hits: negativeHits,
      quality_hit: qualityHit,
    },
  };
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
