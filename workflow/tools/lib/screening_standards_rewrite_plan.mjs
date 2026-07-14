export function normalizeSuggestionStatus(raw) {
  const original = String(raw || "").trim();
  const status = original.toLowerCase();
  const aliases = { "接受": "accept", "拒绝": "reject", "修改": "revise", "待定": "pending" };
  if (["pending", "accept", "reject", "revise"].includes(status)) return { status, unknown: false, original };
  if (aliases[status]) return { status: aliases[status], unknown: false, original };
  if (!original) return { status: "", unknown: false, original };
  return { status: "", unknown: true, original };
}

export function shouldTriggerScreeningStandardsRewrite({ status = "", revised_rule = "", revisedRule = "" } = {}) {
  const result = normalizeSuggestionStatus(status);
  const normalized = result.status || String(status || "").trim().toLowerCase();
  if (normalized === "accept" || normalized === "accepted") return true;
  if (normalized === "revise" || normalized === "revised") {
    return Boolean(String(revisedRule || revised_rule || "").trim());
  }
  return false;
}

export function suggestionObjectsFromTable(table = []) {
  if (!Array.isArray(table) || table.length < 2) return [];
  const headers = table[0].map((header) => String(header || "").trim());
  const value = (row, name) => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? String(row[idx] || "").trim() : "";
  };
  return table.slice(1).map((row) => ({
    suggestion_id: value(row, "建议ID"),
    type: value(row, "类型"),
    suggested_rule: value(row, "建议规则"),
    confidence: value(row, "置信度"),
    status: value(row, "状态") || "pending",
    revised_rule: value(row, "修订后规则"),
    reason: value(row, "备注"),
  }));
}

export function collectScreeningStandardsRewriteSuggestions(parsedDocx = {}) {
  return buildScreeningStandardsPendingRewritePlan(parsedDocx).applicableSuggestions;
}

function classifyPendingRewriteSuggestion(suggestion = {}) {
  const result = normalizeSuggestionStatus(suggestion.status);
  const normalized = result.status || String(suggestion.status || "").trim().toLowerCase();
  const revisedRule = String(suggestion.revisedRule || suggestion.revised_rule || "").trim();
  if (normalized === "accept" || normalized === "accepted") return { applicable: true, reason: "accepted" };
  if (normalized === "revise" || normalized === "revised") {
    return revisedRule
      ? { applicable: true, reason: "revised" }
      : { applicable: false, reason: "revised_rule_missing", blocker: "revised_rule_missing" };
  }
  if (!normalized || normalized === "pending") return { applicable: false, reason: "pending" };
  if (normalized === "reject" || normalized === "rejected") return { applicable: false, reason: "rejected" };
  if (["candidate", "superseded", "expired"].includes(normalized)) return { applicable: false, reason: "inactive_status" };
  return { applicable: false, reason: "unsupported_status" };
}

export function buildScreeningStandardsPendingRewritePlan(parsedDocx = {}, { suggestions = null } = {}) {
  const allSuggestions = Array.isArray(suggestions) ? suggestions : suggestionObjectsFromTable(parsedDocx.suggestions_table);
  const applicableSuggestions = [];
  const nonApplicableSuggestions = [];
  const blockers = [];
  for (const suggestion of allSuggestions) {
    const classified = classifyPendingRewriteSuggestion(suggestion);
    const entry = {
      ...suggestion,
      applied_rule: String(suggestion.revised_rule || suggestion.revisedRule || suggestion.suggested_rule || "").trim(),
      rewrite_reason: classified.reason,
    };
    if (classified.applicable) {
      applicableSuggestions.push(entry);
    } else {
      nonApplicableSuggestions.push(entry);
      if (classified.blocker) blockers.push({
        suggestion_id: suggestion.suggestion_id || suggestion.id || "",
        reason: classified.blocker,
      });
    }
  }
  return {
    current_rules_text: String(parsedDocx.rules_text || ""),
    applicableSuggestions,
    nonApplicableSuggestions,
    blockers,
    shouldRewriteStandards: applicableSuggestions.length > 0,
    skipReason: applicableSuggestions.length ? "" : allSuggestions.length ? "no_applicable_suggestions" : "no_pending_suggestions",
  };
}

export function buildScreeningStandardsPendingRewriteReport(parsedDocx = {}, { suggestions = null, rewriteEnabled = false } = {}) {
  const plan = buildScreeningStandardsPendingRewritePlan(parsedDocx, { suggestions });
  return {
    rewrite_status: plan.shouldRewriteStandards
      ? rewriteEnabled ? "ready" : "not_enabled"
      : "not_required",
    rewrite_enabled: Boolean(rewriteEnabled),
    shouldRewriteStandards: plan.shouldRewriteStandards,
    applicable_suggestions_count: plan.applicableSuggestions.length,
    non_applicable_suggestions_count: plan.nonApplicableSuggestions.length,
    applicable_suggestion_ids: plan.applicableSuggestions.map((suggestion) => suggestion.suggestion_id || suggestion.id || "").filter(Boolean),
    non_applicable_suggestions: plan.nonApplicableSuggestions.map((suggestion) => ({
      suggestion_id: suggestion.suggestion_id || suggestion.id || "",
      status: suggestion.status || "",
      reason: suggestion.rewrite_reason || "",
    })),
    blockers: plan.blockers,
    skip_reason: plan.skipReason,
    llm_called: false,
    docx_modified: false,
    md_modified: false,
    suggestions_consumed: false,
    current_rules_text: plan.current_rules_text,
  };
}
