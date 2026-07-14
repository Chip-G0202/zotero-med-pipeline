import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildLlmRuleContextSummary } from "../tools/stage1/llm_rule_context.mjs";

describe("LLM rule context summary", () => {
  it("separates official rules from search context and exposes hashes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rule_context_"));
    const reviewRoot = path.join(root, "review_results", "文献评价");
    const configRoot = path.join(root, "config");
    await fs.mkdir(reviewRoot, { recursive: true });
    await fs.mkdir(configRoot, { recursive: true });
    await fs.writeFile(path.join(reviewRoot, "screening_standards.md"), "# 标准\n\n## 优先关注\n\n* 机制研究。\n", "utf8");
    await fs.writeFile(path.join(configRoot, "review-workflow-rules.json"), JSON.stringify({ triage: { research_focus: { primary_question: "example topic term 018" } } }), "utf8");
    await fs.writeFile(path.join(configRoot, "pubmed_pmc_search.json"), JSON.stringify({ query: "example topic term 018", keyword_groups: { required: [["example topic term 018"]], negative: ["plant"] } }), "utf8");
    await fs.writeFile(path.join(reviewRoot, "standards_rule_suggestions_log.json"), JSON.stringify({
      suggestions: [
        { id: "accepted-1", status: "accepted", rule_text: "正式加入示例机制边界。" },
        { id: "pending-1", status: "pending", rule_text: "未确认建议。" },
      ],
    }), "utf8");

    const summary = await buildLlmRuleContextSummary({ root, reviewRoot });
    const sourcesByType = new Map(summary.sources.map((source) => [source.type, source]));

    assert.equal(sourcesByType.get("official_screening_standards").included_as_official_rule, true);
    assert.equal(sourcesByType.get("machine_grading_rules").included_as_official_rule, true);
    assert.equal(sourcesByType.get("search_context").can_be_used_for_grading, false);
    assert.match(summary.accepted_rule_updates_summary, /示例机制/);
    assert.match(summary.pending_suggestions_summary, /未确认/);
    assert.ok(summary.context_hash.length >= 12);
    assert.ok(summary.sources.every((source) => source.hash || source.included === false));
  });
});
