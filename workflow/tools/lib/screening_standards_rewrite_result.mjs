import { parseJsonOnlyWithInfo } from "./llm_json_support.mjs";

export function rewriteDispositionMissingReason(entries = []) {
  return (Array.isArray(entries) ? entries : []).some((entry) => {
    if (!entry || typeof entry !== "object") return true;
    return !String(entry.reason || entry.rationale || "").trim();
  });
}

export function rewriteCoverageIds(rewriteResult = {}) {
  const ids = new Set((rewriteResult.consumed_suggestion_ids || []).map((id) => String(id || "").trim()).filter(Boolean));
  for (const id of Object.keys(rewriteResult.suggestion_coverage_map || {})) {
    if (String(id || "").trim()) ids.add(String(id).trim());
  }
  return ids;
}

function rewriteSuggestionId(suggestion = {}) {
  return String(suggestion.suggestion_id || suggestion.id || "").trim();
}

export function checkScreeningRulesChineseLanguage(rulesText = "") {
  const lines = String(rulesText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const violationLines = [];
  for (const line of lines) {
    const body = line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim();
    if (!body) continue;
    const cjkCount = (body.match(/[\u3400-\u9fff]/g) || []).length;
    const alphaCount = (body.match(/[A-Za-z]/g) || []).length;
    const longEnglishWords = body.match(/[A-Za-z]{4,}/g) || [];
    if (alphaCount >= 16 && cjkCount === 0 && longEnglishWords.length >= 2) {
      violationLines.push(body);
    }
  }
  return {
    ok: violationLines.length === 0,
    violation_lines: violationLines.slice(0, 5),
    checked_lines: lines.length,
  };
}

function normalizeRewriteArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRewriteRiskLevel(value) {
  const risk = String(value || "medium").trim().toLowerCase();
  if (["low", "medium", "high"].includes(risk)) return risk;
  throw new Error("semantic_risk_level_invalid");
}

function assertRewriteCoverage(rewriteResult = {}, applicableSuggestions = []) {
  if (!rewriteResult.consumed_suggestion_ids?.length && !Object.keys(rewriteResult.suggestion_coverage_map || {}).length) {
    throw new Error("suggestion_coverage_missing");
  }
  const covered = rewriteCoverageIds(rewriteResult);
  const missing = applicableSuggestions
    .map(rewriteSuggestionId)
    .filter(Boolean)
    .filter((id) => !covered.has(id));
  if (missing.length) {
    const error = new Error("suggestion_coverage_incomplete");
    error.missing_suggestion_ids = missing;
    throw error;
  }
}

export function buildScreeningStandardsRewritePrompt({
  currentRulesText = "",
  applicableSuggestions = [],
  context = {},
} = {}) {
  const input = {
    current_rules_text: String(currentRulesText || ""),
    applicable_suggestions: (applicableSuggestions || []).map((suggestion) => ({
      id: rewriteSuggestionId(suggestion),
      status: String(suggestion.status || ""),
      suggested_rule: String(suggestion.suggested_rule || suggestion.rule_text || ""),
      revised_rule: String(suggestion.revised_rule || suggestion.revisedRule || ""),
      applied_rule: String(suggestion.applied_rule || suggestion.revised_rule || suggestion.suggested_rule || ""),
    })),
    context: {
      grading_semantics: context.grading_semantics || "Preserve the existing A/B/C/D/E grading meanings exactly.",
      section_hints: context.section_hints || ["优先关注", "相对降权", "严格排除", "不确定", "注意事项"],
      current_date: context.current_date || "",
    },
  };
  return [
    "You are rewriting the main screening standards rules section for a medical literature workflow.",
    "Return structured JSON only. Do not output prose, markdown fences, comments, or explanations outside JSON.",
    "Preserve semantics: do not silently change A/B/C/D/E grading meanings.",
    "Preserve inclusion/exclusion boundaries; do not silently broaden or narrow the user's screening scope.",
    "Prefer reusing existing rules. Prefer merging duplicates, near-duplicates, and synonymous redundancy.",
    "Do not mechanically append every suggestion to the end.",
    "You may modify, delete, or create rules only when needed, and every change must be auditable.",
    "Every accepted/revised suggestion must have a disposition in suggestion_coverage_map.",
    "Every deleted or modified old rule must include a reason.",
    "Mark high-risk semantic changes with semantic_risk_level='high' and do not present them as safe to apply.",
    "If unsure, do not apply the change; mark a blocker or high semantic risk.",
    "Do not introduce new medical claims unless supported by the current rules or applicable suggestions.",
    "正式规则必须默认使用中文；英文术语、缩写、基因名、通路名和模型名可以保留，但规则句子的主体必须是中文。",
    "JSON schema fields: updated_rules_text, consumed_suggestion_ids, suggestion_coverage_map, old_rule_disposition, reused_rules, merged_rules, modified_rules, deleted_rules, created_rules, semantic_risk_level, semantic_risk_reasons, requires_human_review.",
    "Input JSON:",
    JSON.stringify(input, null, 2),
  ].join("\n");
}

export function buildChineseScreeningRulesRewritePrompt(rewriteResult = {}, languageCheck = {}) {
  return [
    "You are fixing a screening standards rewrite result before it can be applied.",
    "Return the same structured JSON schema as the input.",
    "Do not change screening semantics, suggestion coverage, risk level, or dispositions.",
    "Only rewrite updated_rules_text so formal rule sentences are Chinese by default.",
    "English terms, abbreviations, gene names, example topic term 040 names, model names, and method names may remain when they are domain terms.",
    "The main prose of every formal rule must be Chinese.",
    "Language violations:",
    JSON.stringify(languageCheck.violation_lines || [], null, 2),
    "Input JSON:",
    JSON.stringify(rewriteResult, null, 2),
  ].join("\n");
}

export function parseScreeningStandardsRewriteResult(raw, { applicableSuggestions = [] } = {}) {
  let value;
  if (typeof raw === "string") {
    value = parseJsonOnlyWithInfo(raw).value;
  } else {
    value = raw;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("rewrite_result_not_object");
  if (!Object.keys(value).length) throw new Error("rewrite_result_empty");
  const updatedRulesText = String(value.updated_rules_text || "").trim();
  if (!updatedRulesText) throw new Error("updated_rules_text_missing");

  const semanticRiskLevel = normalizeRewriteRiskLevel(value.semantic_risk_level);
  const normalized = {
    mode: "apply_to_docx",
    updated_rules_text: updatedRulesText,
    consumed_suggestion_ids: normalizeRewriteArray(value.consumed_suggestion_ids).map((id) => String(id || "").trim()).filter(Boolean),
    suggestion_coverage_map: value.suggestion_coverage_map && typeof value.suggestion_coverage_map === "object" && !Array.isArray(value.suggestion_coverage_map)
      ? value.suggestion_coverage_map
      : {},
    old_rule_disposition: normalizeRewriteArray(value.old_rule_disposition),
    reused_rules: normalizeRewriteArray(value.reused_rules),
    merged_rules: normalizeRewriteArray(value.merged_rules),
    modified_rules: normalizeRewriteArray(value.modified_rules),
    deleted_rules: normalizeRewriteArray(value.deleted_rules),
    created_rules: normalizeRewriteArray(value.created_rules),
    semantic_risk_level: semanticRiskLevel,
    semantic_risk_reasons: normalizeRewriteArray(value.semantic_risk_reasons).map(String),
    requires_human_review: Boolean(value.requires_human_review || semanticRiskLevel !== "low"),
    safe_to_apply: semanticRiskLevel !== "high",
  };
  assertRewriteCoverage(normalized, applicableSuggestions);
  if (rewriteDispositionMissingReason(normalized.deleted_rules) || rewriteDispositionMissingReason(normalized.modified_rules)) {
    throw new Error("rule_disposition_reason_missing");
  }
  const languageCheck = checkScreeningRulesChineseLanguage(normalized.updated_rules_text);
  if (!languageCheck.ok) {
    const error = new Error("rules_language_violation");
    error.languageCheck = languageCheck;
    throw error;
  }
  return normalized;
}
