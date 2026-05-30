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

const POLLUTANT_TERMS = TRIAGE_RULES.terms?.pollutant || ["example-pollutant-1", "example-pollutant-2"];
const CORE_TOPIC_TERMS = TRIAGE_RULES.terms?.core_topic || ["example-topic-1", "example-topic-2"];
const MECHANISM_TERMS = TRIAGE_RULES.terms?.mechanism || ["example-mechanism-1", "example-mechanism-2"];
const JOURNAL_WHITELIST = new Set(TRIAGE_RULES.journal_whitelist || ["example-journal-1", "example-journal-2"]);
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

  // NOTE: The following keyword expansion rules are examples only.
  // Users should customize these for their own research direction.
  // The default screening_standards.md uses generic placeholders.
  const hardExcludes = [];
  for (const rule of sections.hard_excludes) {
    const lower = rule.toLowerCase();
    const keywords = [];
    // Generic category expansions - customize for your research
    if (lower.includes("example-exclude-category")) keywords.push("example-exclude-term");
    if (keywords.length === 0) keywords.push(lower.slice(0, 60));
    hardExcludes.push({ rule, keywords, section: "严格排除" });
  }

  // Generic negative preference expansions - customize for your research
  const negativePrefs = [];
  for (const rule of sections.negative_preferences) {
    const lower = rule.toLowerCase();
    const keywords = [];
    if (lower.includes("example-negative-category")) keywords.push("example-negative-term");
    if (keywords.length === 0) keywords.push(lower.slice(0, 50));
    negativePrefs.push({ rule, keywords, section: "相对降权" });
  }

  // Generic positive preference expansions - customize for your research
  const positivePrefs = [];
  for (const rule of sections.positive_preferences) {
    const lower = rule.toLowerCase();
    const keywords = [];
    if (lower.includes("example-positive-category")) keywords.push("example-positive-term");
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

// ─── Semantic Grading ─────────────────────────────────────────────────

const GRADE_NUMERIC = { A: 1, B: 2, C: 3, D: 4 };
const NUMERIC_TO_GRADE = { 1: "A", 2: "B", 3: "C", 4: "D" };

export function normalizeGradeLetter(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (/^[ABCD]$/.test(raw)) return raw;
  const m = raw.match(/^[ABCD]/);
  return m ? m[0] : "";
}

/**
 * Build a lookup index from feedback signals for semantic grade matching.
 * Indexed by multiple keys (when present): itemKey, DOI, normTitle of english_title,
 * normTitle of title_translation.
 */
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

/**
 * Derive semantic grade from semantic search results matched against feedback index.
 * Returns { semanticGrade, semanticReason, matchedFeedbackCount, skippedReason }
 *
 * Matches search results against feedback index using itemKey, DOI, then title.
 * Only matched results influence the grade; unmatched results are ignored.
 */
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

    // Priority 1: match by itemKey
    const rItemKey = String(result.item_key || result.itemKey || "").trim();
    if (rItemKey) {
      matchedEntry = feedbackIndex.get(`key:${rItemKey}`);
    }
    // Priority 2: match by DOI
    if (!matchedEntry) {
      const rDoi = normalizeIdentifier(result.doi || result.DOI);
      if (rDoi) {
        matchedEntry = feedbackIndex.get(`doi:${rDoi}`);
      }
    }
    // Priority 3: match by normalized title
    if (!matchedEntry) {
      const rTitle = normTitle(result.title || "");
      if (rTitle) {
        matchedEntry = feedbackIndex.get(`title:${rTitle}`);
      }
    }

    if (!matchedEntry) continue;

    // Deduplicate: same feedback entry should not count twice
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
      adjustment -= weight; // toward A (lower number)
      reasons.push(`+${entry.title.slice(0, 60)}`);
    } else if (entry.direction === "negative") {
      adjustment += weight; // toward D (higher number)
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
 * Synthesize final grade from rule grade and optional semantic grade.
 * Returns { finalGrade, needsHumanReview, disagreementType }
 *
 * Strategy:
 * - Default: finalGrade = ruleGrade
 * - If semanticGrade differs by 1 level: adopt semanticGrade
 * - If semanticGrade differs by 2+ levels: keep ruleGrade, flag needs_human_review
 */
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

  // diff === 1: adopt semantic grade, except C→D which requires human review
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
