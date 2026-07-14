import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  generateUnifiedPendingRuleSuggestions,
  normalizePendingSuggestionStatus,
} from "../tools/lib/unified_pending_rule_suggestions.mjs";

describe("unified pending rule suggestions", () => {
  it("promotes candidates to pending and normalizes required fields", () => {
    const result = generateUnifiedPendingRuleSuggestions({
      llmPreferenceCandidates: [{
        source: "llm_preference_learning",
        target: "screening_standards.md",
        change_type: "add_rule",
        rule_text: "优先关注动物实验机制研究。",
        rationale: "upgrade feedback mentioned animal mechanism",
        evidence_feedback_types: ["upgrade"],
        evidence_titles: ["Mouse model title"],
        confidence: "low",
        risk: "single feedback row",
      }],
      generatedAt: "2026-06-22T00:00:00.000Z",
    });

    assert.equal(result.added_count, 1);
    assert.equal(result.log.suggestions[0].status, "pending");
    assert.equal(result.log.suggestions[0].requires_human_approval, true);
    assert.equal(result.log.suggestions[0].source, "llm_preference_learning");
    assert.equal(result.log.suggestions[0].target, "screening_standards.md");
    assert.equal(result.log.suggestions[0].change_type, "add_rule");
  });

  it("merges hard duplicates and skips unmodified rejected duplicates", () => {
    const existingLog = {
      suggestions: [{
        id: "old-1",
        suggestion_id: "old-1",
        status: "rejected",
        target: "screening_standards.md",
        change_type: "add_downgrade_signal",
        rule_text: "降权纯环境监测研究。",
        suggested_rule: "降权纯环境监测研究。",
        input_hash: "same-hash",
        hard_duplicate_key: "screening_standards.md|add_downgrade_signal|x",
      }],
    };

    const result = generateUnifiedPendingRuleSuggestions({
      legacySuggestions: [{
        suggestion_id: "new-1",
        suggested_rule: "降权纯环境监测研究。",
        type: "negative_preference",
        status: "pending",
        source: "legacy_feedback_aggregator",
        input_hash: "same-hash",
      }],
      existingSuggestionsLog: existingLog,
      generatedAt: "2026-06-22T00:00:00.000Z",
    });

    assert.equal(result.added_count, 0);
    assert.equal(result.rejected_duplicate_skipped_count, 1);
    assert.equal(result.log.suggestions.length, 1);
  });

  it("marks possible duplicates without aggressive semantic deletion", () => {
    const result = generateUnifiedPendingRuleSuggestions({
      llmPreferenceCandidates: [
        {
          source: "llm_preference_learning",
          target: "review-workflow-rules.json",
          change_type: "add_downgrade_signal",
          canonical_theme: "clinical outcome downgrade",
          rule_text: "降权缺乏机制的人群结局研究。",
          evidence_titles: ["A clinical outcome study"],
        },
        {
          source: "legacy_feedback_aggregator",
          target: "review-workflow-rules.json",
          change_type: "add_downgrade_signal",
          canonical_theme: "clinical outcome downgrade",
          rule_text: "对纯临床结局研究保持降权。",
          evidence_titles: ["Another clinical outcome study"],
        },
      ],
      generatedAt: "2026-06-22T00:00:00.000Z",
    });

    assert.equal(result.added_count, 2);
    assert.equal(result.log.suggestions[1].possible_duplicate_of, result.log.suggestions[0].id);
  });

  it("normalizes supported state machine statuses", () => {
    assert.equal(normalizePendingSuggestionStatus("candidate"), "candidate");
    assert.equal(normalizePendingSuggestionStatus("pending"), "pending");
    assert.equal(normalizePendingSuggestionStatus("accepted"), "accepted");
    assert.equal(normalizePendingSuggestionStatus("revised"), "revised");
    assert.equal(normalizePendingSuggestionStatus("rejected"), "rejected");
    assert.equal(normalizePendingSuggestionStatus("superseded"), "superseded");
    assert.equal(normalizePendingSuggestionStatus("expired"), "expired");
    assert.equal(normalizePendingSuggestionStatus("unknown"), "candidate");
  });
});
