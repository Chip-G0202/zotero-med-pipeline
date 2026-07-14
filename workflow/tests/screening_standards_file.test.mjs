import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  syncScreeningStandardsDocx,
  parseScreeningStandardsDocx,
  screeningStandardsDocxPath,
  screeningStandardsPath,
  ruleSuggestionsLogPath,
  writeRuleSuggestionsLog,
  INITIAL_SCREENING_STANDARDS_ZH,
  processManualStandardEvaluation,
  applyScreeningStandardsLearningUpdate,
  buildScreeningStandardsSyncPlan,
  shouldTriggerScreeningStandardsRewrite,
  applyScreeningStandardsDocxRewrite,
  SCREENING_STANDARDS_BEFORE_LLM_REFINE_BACKUP_FILE_NAME,
  buildScreeningStandardsRewritePrompt,
  parseScreeningStandardsRewriteResult,
  buildScreeningStandardsPendingRewritePlan,
  buildScreeningStandardsPendingRewriteReport,
} from "../tools/stage1/screening_standards_file.mjs";

const BACKUP_FILE_NAME = "screening_standards.backup.docx";

let tmpRoot;
let reviewRoot;
let configDir;
let pubmedConfigPath;

function createTmp() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ss_test_"));
  reviewRoot = path.join(tmpRoot, "review_results", "文献评价");
  configDir = path.join(tmpRoot, "config");
  fs.mkdirSync(reviewRoot, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  pubmedConfigPath = path.join(configDir, "pubmed_pmc_search.json");
  fs.writeFileSync(
    pubmedConfigPath,
    JSON.stringify({ keyword_groups: { required: [["example topic term 011"]], optional: [], negative: [] } }),
    "utf8",
  );
  fs.writeFileSync(screeningStandardsPath(reviewRoot), INITIAL_SCREENING_STANDARDS_ZH, "utf8");
}

function cleanupTmp() {
  if (tmpRoot && fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

describe("screening_standards_file", () => {
  beforeEach(createTmp);
  afterEach(cleanupTmp);

  describe("buildScreeningStandardsSyncPlan", () => {
    it("summarizes sync, consumed evaluation text, and clear state without leaking text", () => {
      const result = buildScreeningStandardsSyncPlan({
        syncSteps: [
          { name: "feedback_learning_docx_sync", purpose: "sync_markdown_to_docx", attempted: true, docxBackupExpected: true },
          { name: "rule_suggestions_docx_sync", purpose: "clear_manual_evaluation", attempted: true, docxBackupExpected: true },
        ],
        evaluationTextConsumed: true,
        evaluationTextCleared: true,
        clearedReason: "evaluation_processed_and_cleared",
        preferenceLearningInputsBuilt: true,
        notes: ["manual evaluation text is consumed before the clear sync"],
        evaluationText: "用户原始评价不应进入 summary",
      });

      assert.equal(result.sync_steps_count, 2);
      assert.equal(result.docx_sync_attempted, true);
      assert.equal(result.docx_backup_expected, true);
      assert.equal(result.evaluation_text_consumed, true);
      assert.equal(result.evaluation_text_cleared, true);
      assert.equal(result.cleared_reason, "evaluation_processed_and_cleared");
      assert.equal(result.preference_learning_inputs_built, true);
      assert.ok(JSON.stringify(result).includes("用户原始评价") === false);
    });

    it("does not report consumed evaluation text when no evaluation input exists", () => {
      const result = buildScreeningStandardsSyncPlan({
        syncSteps: [
          { name: "feedback_learning_docx_sync", purpose: "sync_markdown_to_docx", attempted: true, docxBackupExpected: false },
        ],
        evaluationTextConsumed: false,
        evaluationTextCleared: false,
        clearedReason: "no_evaluation_input",
        preferenceLearningInputsBuilt: false,
      });

      assert.equal(result.sync_steps_count, 1);
      assert.equal(result.docx_sync_attempted, true);
      assert.equal(result.docx_backup_expected, false);
      assert.equal(result.evaluation_text_consumed, false);
      assert.equal(result.evaluation_text_cleared, false);
      assert.equal(result.cleared_reason, "");
      assert.equal(result.preference_learning_inputs_built, false);
    });
  });

  describe("screening standards rewrite trigger states", () => {
    it("accepted suggestion should require standards rewrite", () => {
      for (const status of ["accepted", "accept", "接受"]) {
        assert.equal(shouldTriggerScreeningStandardsRewrite({ status }), true);
      }
    });

    it("revised suggestion with revised text should require standards rewrite", () => {
      for (const status of ["revised", "revise", "修改"]) {
        assert.equal(shouldTriggerScreeningStandardsRewrite({ status, revised_rule: "更新后的规则" }), true);
      }
    });

    it("revised suggestion without revised text should not require standards rewrite", () => {
      for (const status of ["revised", "revise", "修改"]) {
        assert.equal(shouldTriggerScreeningStandardsRewrite({ status, revised_rule: "" }), false);
        assert.equal(shouldTriggerScreeningStandardsRewrite({ status, revisedRule: "   " }), false);
      }
    });

    it("pending rejected inactive and unsupported statuses should not require standards rewrite", () => {
      const statuses = [
        "pending",
        "待定",
        "",
        "rejected",
        "reject",
        "拒绝",
        "candidate",
        "superseded",
        "expired",
        "approved",
        "confirmed",
        "已确认",
        "可应用",
      ];
      for (const status of statuses) {
        assert.equal(shouldTriggerScreeningStandardsRewrite({ status, revised_rule: "更新后的规则" }), false);
      }
    });
  });

  describe("screening standards pending-first rewrite preparation", () => {
    function parsedWithSuggestions(suggestions, rulesText = "当前主体规则") {
      return {
        rules_text: rulesText,
        suggestions_table: [
          ["建议ID", "类型", "建议规则", "证据", "置信度", "状态", "修订后规则", "备注"],
          ...suggestions.map((suggestion) => [
            suggestion.suggestion_id || "",
            suggestion.type || "negative_preference",
            suggestion.suggested_rule || "",
            "",
            suggestion.confidence || "low",
            suggestion.status || "",
            suggestion.revised_rule || "",
            suggestion.reason || "",
          ]),
        ],
      };
    }

    it("collects accepted and revised suggestions as applicable", () => {
      const plan = buildScreeningStandardsPendingRewritePlan(parsedWithSuggestions([
        { suggestion_id: "SUG-A", suggested_rule: "接受规则", status: "接受" },
        { suggestion_id: "SUG-R", suggested_rule: "原规则", status: "修改", revised_rule: "修订后规则" },
      ]));

      assert.equal(plan.shouldRewriteStandards, true);
      assert.deepEqual(plan.applicableSuggestions.map((s) => s.suggestion_id), ["SUG-A", "SUG-R"]);
      assert.equal(plan.applicableSuggestions[1].applied_rule, "修订后规则");
      assert.equal(plan.skipReason, "");
    });

    it("keeps revised suggestions without revised text non-applicable with a blocker", () => {
      const plan = buildScreeningStandardsPendingRewritePlan(parsedWithSuggestions([
        { suggestion_id: "SUG-R-MISSING", suggested_rule: "缺少修订文本", status: "revise" },
      ]));

      assert.equal(plan.shouldRewriteStandards, false);
      assert.equal(plan.applicableSuggestions.length, 0);
      assert.equal(plan.nonApplicableSuggestions[0].rewrite_reason, "revised_rule_missing");
      assert.deepEqual(plan.blockers, [{ suggestion_id: "SUG-R-MISSING", reason: "revised_rule_missing" }]);
      assert.equal(plan.skipReason, "no_applicable_suggestions");
    });

    it("keeps pending rejected inactive and unsupported statuses non-applicable", () => {
      const plan = buildScreeningStandardsPendingRewritePlan(parsedWithSuggestions([
        { suggestion_id: "SUG-P", status: "pending" },
        { suggestion_id: "SUG-WAIT", status: "待定" },
        { suggestion_id: "SUG-EMPTY", status: "" },
        { suggestion_id: "SUG-REJECT", status: "reject" },
        { suggestion_id: "SUG-CANDIDATE", status: "candidate" },
        { suggestion_id: "SUG-SUPERSEDED", status: "superseded" },
        { suggestion_id: "SUG-EXPIRED", status: "expired" },
        { suggestion_id: "SUG-UNSUPPORTED", status: "已确认" },
      ]));

      assert.equal(plan.shouldRewriteStandards, false);
      assert.equal(plan.applicableSuggestions.length, 0);
      assert.deepEqual(
        plan.nonApplicableSuggestions.map((s) => s.rewrite_reason),
        ["pending", "pending", "pending", "rejected", "inactive_status", "inactive_status", "inactive_status", "unsupported_status"],
      );
    });

    it("builds a disabled no-op report without writing docx md or calling LLM", async () => {
      await syncScreeningStandardsDocx(reviewRoot, {
        pubmedConfigPath,
        evaluationText: "评价区保留",
        suggestions: [{ suggestion_id: "SUG-NOOP", suggested_rule: "待改写规则", status: "accept" }],
      });
      const docxPath = screeningStandardsDocxPath(reviewRoot);
      const mdPath = screeningStandardsPath(reviewRoot);
      const beforeDocx = fs.readFileSync(docxPath);
      const beforeMd = fs.readFileSync(mdPath, "utf8");
      const parsed = await parseScreeningStandardsDocx(docxPath);

      const report = buildScreeningStandardsPendingRewriteReport(parsed, { rewriteEnabled: false });

      assert.equal(report.rewrite_status, "not_enabled");
      assert.equal(report.shouldRewriteStandards, true);
      assert.deepEqual(report.applicable_suggestion_ids, ["SUG-NOOP"]);
      assert.equal(report.llm_called, false);
      assert.equal(report.docx_modified, false);
      assert.equal(report.md_modified, false);
      assert.equal(report.suggestions_consumed, false);
      assert.equal(fs.readFileSync(docxPath).equals(beforeDocx), true);
      assert.equal(fs.readFileSync(mdPath, "utf8"), beforeMd);
    });

    it("returns current rules text for future evaluation LLM inputs", () => {
      const plan = buildScreeningStandardsPendingRewritePlan(parsedWithSuggestions([], "更新后的主体规则"));

      assert.equal(plan.current_rules_text, "更新后的主体规则");
      assert.equal(plan.shouldRewriteStandards, false);
      assert.equal(plan.skipReason, "no_pending_suggestions");
    });
  });

  describe("screening standards rewrite LLM prompt and parser", () => {
    const applicableSuggestions = [
      {
        suggestion_id: "SUG-LLM",
        status: "accept",
        suggested_rule: "合并相近的降权规则",
        revised_rule: "",
      },
    ];

    function validRewrite(overrides = {}) {
      return {
        updated_rules_text: "## 优先关注\n* 保留核心机制研究。\n\n## 相对降权\n* 合并相近的降权规则。",
        consumed_suggestion_ids: ["SUG-LLM"],
        suggestion_coverage_map: {
          "SUG-LLM": { disposition: "merged", reason: "covered by consolidated downrank rule" },
        },
        old_rule_disposition: [],
        reused_rules: [],
        merged_rules: [{ source_suggestion_ids: ["SUG-LLM"], reason: "same screening boundary" }],
        modified_rules: [],
        deleted_rules: [],
        created_rules: [],
        semantic_risk_level: "low",
        semantic_risk_reasons: [],
        requires_human_review: false,
        ...overrides,
      };
    }

    it("builds a prompt with core rewrite safety constraints", () => {
      const prompt = buildScreeningStandardsRewritePrompt({
        currentRulesText: "当前规则",
        applicableSuggestions,
        context: { current_date: "2026-06-29" },
      });

      assert.ok(prompt.includes("Return structured JSON only"));
      assert.ok(prompt.includes("Prefer reusing existing rules"));
      assert.ok(prompt.includes("Do not mechanically append"));
      assert.ok(prompt.includes("Every accepted/revised suggestion must have a disposition"));
      assert.ok(prompt.includes("Every deleted or modified old rule must include a reason"));
      assert.ok(prompt.includes("do not silently change A/B/C/D/E grading meanings"));
      assert.ok(prompt.includes("Do not introduce new medical claims"));
      assert.ok(prompt.includes("SUG-LLM"));
    });

    it("parses valid fake JSON into the rewriteResult consumed by Phase 2", () => {
      const parsed = parseScreeningStandardsRewriteResult(JSON.stringify(validRewrite()), {
        applicableSuggestions,
      });

      assert.equal(parsed.mode, "apply_to_docx");
      assert.equal(parsed.updated_rules_text.includes("合并相近的降权规则"), true);
      assert.deepEqual(parsed.consumed_suggestion_ids, ["SUG-LLM"]);
      assert.equal(parsed.semantic_risk_level, "low");
      assert.equal(parsed.safe_to_apply, true);
    });

    it("rejects non-JSON rewrite responses", () => {
      assert.throws(
        () => parseScreeningStandardsRewriteResult("not json", { applicableSuggestions }),
        /invalid|Unexpected|JSON/i,
      );
    });

    it("rejects missing updated_rules_text", () => {
      const { updated_rules_text, ...withoutRules } = validRewrite();
      assert.throws(
        () => parseScreeningStandardsRewriteResult(withoutRules, { applicableSuggestions }),
        /updated_rules_text_missing/,
      );
    });

    it("rejects missing or incomplete suggestion coverage", () => {
      assert.throws(
        () => parseScreeningStandardsRewriteResult({ ...validRewrite(), consumed_suggestion_ids: [], suggestion_coverage_map: {} }, { applicableSuggestions }),
        /suggestion_coverage_missing/,
      );
      assert.throws(
        () => parseScreeningStandardsRewriteResult(validRewrite({
          consumed_suggestion_ids: ["OTHER"],
          suggestion_coverage_map: { OTHER: { disposition: "merged", reason: "wrong suggestion" } },
        }), { applicableSuggestions }),
        /suggestion_coverage_incomplete/,
      );
    });

    it("parses high-risk result but marks it unsafe for apply", () => {
      const parsed = parseScreeningStandardsRewriteResult(validRewrite({
        semantic_risk_level: "high",
        semantic_risk_reasons: ["Possible boundary change."],
      }), { applicableSuggestions });

      assert.equal(parsed.semantic_risk_level, "high");
      assert.equal(parsed.safe_to_apply, false);
      assert.equal(parsed.requires_human_review, true);
    });

    it("rejects deleted or modified old rules without reasons", () => {
      assert.throws(
        () => parseScreeningStandardsRewriteResult(validRewrite({
          deleted_rules: [{ rule: "旧排除规则" }],
        }), { applicableSuggestions }),
        /rule_disposition_reason_missing/,
      );
      assert.throws(
        () => parseScreeningStandardsRewriteResult(validRewrite({
          modified_rules: [{ from: "旧规则", to: "新规则" }],
        }), { applicableSuggestions }),
        /rule_disposition_reason_missing/,
      );
    });
  });

  describe("fake screening standards docx rewrite pipeline", () => {
    async function writeDocxWithSuggestion(suggestion, evaluationText = "保留这段评价") {
      await syncScreeningStandardsDocx(reviewRoot, {
        pubmedConfigPath,
        evaluationText,
        suggestions: [suggestion],
      });
    }

    function safeRewrite(id, updatedRulesText = "新的主体规则\n* 合并后的规则") {
      return {
        mode: "apply_to_docx",
        updated_rules_text: updatedRulesText,
        consumed_suggestion_ids: [id],
        suggestion_coverage_map: { [id]: { disposition: "merged", reason: "covered by merged rule" } },
        old_rule_disposition: [],
        reused_rules: [],
        merged_rules: [{ source_suggestion_ids: [id], reason: "deduplicated related rule text" }],
        modified_rules: [],
        deleted_rules: [],
        created_rules: [],
        semantic_risk_level: "low",
        semantic_risk_reasons: [],
        requires_human_review: false,
      };
    }

    it("accepted suggestion with fake safe rewrite updates docx rules, backs up, and syncs md", async () => {
      await writeDocxWithSuggestion({
        suggestion_id: "SUG-A",
        type: "negative_preference",
        suggested_rule: "建议合并规则",
        status: "accept",
      });
      const docxPath = screeningStandardsDocxPath(reviewRoot);
      const mdPath = screeningStandardsPath(reviewRoot);

      const report = await applyScreeningStandardsDocxRewrite({
        docxPath,
        mdPath,
        rewriteResult: safeRewrite("SUG-A", "新的主体规则\n* 合并后的规则"),
      });

      assert.equal(report.applied, true);
      assert.equal(fs.existsSync(path.join(reviewRoot, SCREENING_STANDARDS_BEFORE_LLM_REFINE_BACKUP_FILE_NAME)), true);
      const parsed = await parseScreeningStandardsDocx(docxPath);
      assert.ok(parsed.rules_text.includes("合并后的规则"));
      assert.ok(parsed.evaluation_text.includes("保留这段评价"));
      assert.ok(JSON.stringify(parsed.suggestions_table).includes("SUG-A"));
      assert.ok(fs.readFileSync(mdPath, "utf8").includes("合并后的规则"));
    });

    it("revised suggestion with revised text supports fake safe rewrite", async () => {
      await writeDocxWithSuggestion({
        suggestion_id: "SUG-R",
        type: "negative_preference",
        suggested_rule: "原建议规则",
        status: "revise",
        revised_rule: "修订后规则",
      });

      const report = await applyScreeningStandardsDocxRewrite({
        docxPath: screeningStandardsDocxPath(reviewRoot),
        mdPath: screeningStandardsPath(reviewRoot),
        rewriteResult: safeRewrite("SUG-R", "修订后的主体规则\n* 修订后规则已合并"),
      });

      assert.equal(report.applied, true);
      assert.ok(fs.readFileSync(screeningStandardsPath(reviewRoot), "utf8").includes("修订后规则已合并"));
    });

    it("pending and rejected suggestions do not execute rewrite or write files", async () => {
      for (const status of ["pending", "reject"]) {
        cleanupTmp();
        createTmp();
        await writeDocxWithSuggestion({
          suggestion_id: `SUG-${status}`,
          type: "negative_preference",
          suggested_rule: "不应应用",
          status,
        });
        const docxPath = screeningStandardsDocxPath(reviewRoot);
        const mdPath = screeningStandardsPath(reviewRoot);
        const beforeMd = fs.readFileSync(mdPath, "utf8");

        const report = await applyScreeningStandardsDocxRewrite({
          docxPath,
          mdPath,
          rewriteResult: safeRewrite(`SUG-${status}`),
        });

        assert.equal(report.applied, false);
        assert.ok(report.blockers.includes("no_applicable_suggestions"));
        assert.equal(fs.existsSync(path.join(reviewRoot, SCREENING_STANDARDS_BEFORE_LLM_REFINE_BACKUP_FILE_NAME)), false);
        assert.equal(fs.readFileSync(mdPath, "utf8"), beforeMd);
      }
    });

    it("rejects fake rewrite when applicable suggestion coverage is incomplete", async () => {
      await writeDocxWithSuggestion({
        suggestion_id: "SUG-MISS",
        type: "negative_preference",
        suggested_rule: "需要覆盖",
        status: "accept",
      });

      const report = await applyScreeningStandardsDocxRewrite({
        docxPath: screeningStandardsDocxPath(reviewRoot),
        mdPath: screeningStandardsPath(reviewRoot),
        rewriteResult: { ...safeRewrite("OTHER"), consumed_suggestion_ids: ["OTHER"], suggestion_coverage_map: { OTHER: { reason: "wrong" } } },
      });

      assert.equal(report.applied, false);
      assert.ok(report.blockers.includes("suggestion_coverage_incomplete"));
    });

    it("rejects high-risk fake rewrite without writing", async () => {
      await writeDocxWithSuggestion({
        suggestion_id: "SUG-HIGH",
        type: "negative_preference",
        suggested_rule: "高风险建议",
        status: "accept",
      });

      const report = await applyScreeningStandardsDocxRewrite({
        docxPath: screeningStandardsDocxPath(reviewRoot),
        mdPath: screeningStandardsPath(reviewRoot),
        rewriteResult: { ...safeRewrite("SUG-HIGH"), semantic_risk_level: "high" },
      });

      assert.equal(report.applied, false);
      assert.ok(report.blockers.includes("semantic_risk_high"));
      assert.equal(fs.existsSync(path.join(reviewRoot, SCREENING_STANDARDS_BEFORE_LLM_REFINE_BACKUP_FILE_NAME)), false);
    });

    it("rejects deleted or modified old rules without reasons", async () => {
      await writeDocxWithSuggestion({
        suggestion_id: "SUG-REASON",
        type: "negative_preference",
        suggested_rule: "需要理由",
        status: "accept",
      });

      const report = await applyScreeningStandardsDocxRewrite({
        docxPath: screeningStandardsDocxPath(reviewRoot),
        mdPath: screeningStandardsPath(reviewRoot),
        rewriteResult: {
          ...safeRewrite("SUG-REASON"),
          deleted_rules: [{ rule: "旧规则" }],
        },
      });

      assert.equal(report.applied, false);
      assert.ok(report.blockers.includes("rule_disposition_reason_missing"));
    });

    it("restores docx backup when md sync fails", async () => {
      await writeDocxWithSuggestion({
        suggestion_id: "SUG-SYNC",
        type: "negative_preference",
        suggested_rule: "同步失败测试",
        status: "accept",
      });
      const docxPath = screeningStandardsDocxPath(reviewRoot);
      const beforeRules = (await parseScreeningStandardsDocx(docxPath)).rules_text;

      const report = await applyScreeningStandardsDocxRewrite({
        docxPath,
        mdPath: path.join(tmpRoot, "missing-dir", "screening_standards.md"),
        rewriteResult: safeRewrite("SUG-SYNC", "不应保留在失败后的docx中"),
      });

      assert.equal(report.applied, false);
      assert.equal(report.partial_failure, true);
      assert.equal(report.restored_docx_from_backup, true);
      const afterRules = (await parseScreeningStandardsDocx(docxPath)).rules_text;
      assert.equal(afterRules, beforeRules);
    });
  });

  describe("syncScreeningStandardsDocx", () => {
    it("generates a docx with expected sections", async () => {
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });
      const docxPath = screeningStandardsDocxPath(reviewRoot);
      assert.ok(fs.existsSync(docxPath));
      const parsed = await parseScreeningStandardsDocx(docxPath);
      assert.ok(parsed.section_names.includes("偏好规则"));
      assert.ok(parsed.section_names.includes("检索关键词"));
      assert.ok(parsed.section_names.includes("评价"));
      assert.ok(parsed.section_names.includes("待确认规则建议") || parsed.section_names.includes("待确认规则建议 / Pending Rule Suggestions"));
    });
  });

  describe("evaluationText handling", () => {
    it("evaluationText='' clears evaluation in output docx", async () => {
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "old user comment" });
      const parsed1 = await parseScreeningStandardsDocx(screeningStandardsDocxPath(reviewRoot));
      assert.ok(parsed1.evaluation_text.includes("old user comment"));

      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });
      const parsed2 = await parseScreeningStandardsDocx(screeningStandardsDocxPath(reviewRoot));
      assert.equal(parsed2.evaluation_text, "");
      assert.ok(!parsed2.evaluation_text.includes("old user comment"));
    });
  });

  describe("processed suggestions filtering", () => {
    it("accepted/rejected suggestions do not appear in output docx", async () => {
      const sugPath = ruleSuggestionsLogPath(reviewRoot);
      const log = {
        suggestions: [
          { suggestion_id: "SUG-P1", type: "negative_preference", suggested_rule: "rule A", status: "accepted", processed_at: "2026-05-28T00:00:00Z", suggestion_hash: "h1", generated_at: "2026-05-28T00:00:00Z" },
          { suggestion_id: "SUG-P2", type: "negative_preference", suggested_rule: "rule B", status: "rejected", processed_at: "2026-05-28T00:00:00Z", suggestion_hash: "h2", generated_at: "2026-05-28T00:00:00Z" },
          { suggestion_id: "SUG-P3", type: "negative_preference", suggested_rule: "rule C", status: "pending", suggestion_hash: "h3", generated_at: "2026-05-28T00:00:00Z" },
        ],
      };
      await writeRuleSuggestionsLog(sugPath, log);

      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "", suggestionsLogPath: sugPath });
      const parsed = await parseScreeningStandardsDocx(screeningStandardsDocxPath(reviewRoot));
      const table = parsed.suggestions_table;
      if (table.length > 1) {
        const ids = table.slice(1).map((r) => r[0]);
        assert.ok(!ids.includes("SUG-P1"));
        assert.ok(!ids.includes("SUG-P2"));
      }
    });
  });

  describe("Preserved User Content recursion prevention", () => {
    it("template text is not preserved as user content across runs", async () => {
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });
      const parsed = await parseScreeningStandardsDocx(screeningStandardsDocxPath(reviewRoot));
      const hasRecursivePreserved = parsed.section_names.filter((s) => s.includes("Preserved User Content") || s.includes("用户保留内容")).length > 1;
      assert.ok(!hasRecursivePreserved, "should not have multiple Preserved User Content sections");
      for (const block of parsed.unknown_blocks) {
        const textMatch = block.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
        if (!textMatch) continue;
        const text = textMatch.map((m) => m.replace(/<[^>]+>/g, "")).join("");
        assert.ok(!text.includes("Format Notes"), "preserved block should not contain Format Notes");
        assert.ok(!text.includes("Status options"), "preserved block should not contain Status options");
        assert.ok(!text.includes("Pending Rule Suggestions"), "preserved block should not contain Pending Rule Suggestions");
        assert.ok(!text.includes("Preserved User Content"), "preserved block should not contain Preserved User Content heading");
      }
    });
  });

  describe("consecutive run idempotency", () => {
    it("second run does not grow unknown_block_count", async () => {
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });
      const p1 = await parseScreeningStandardsDocx(screeningStandardsDocxPath(reviewRoot));
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });
      const p2 = await parseScreeningStandardsDocx(screeningStandardsDocxPath(reviewRoot));
      assert.ok(p2.unknown_block_count <= p1.unknown_block_count, `unknown blocks should not grow: ${p1.unknown_block_count} -> ${p2.unknown_block_count}`);
    });
  });

  describe("backup strategy", () => {
    const TIMESTAMPED_BACKUP_RE = /^screening_standards\.backup\.\d{4}-\d{2}-\d{2}\.docx$/;

    it("generates only a fixed backup on second run", async () => {
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });
      const backupPath = path.join(reviewRoot, BACKUP_FILE_NAME);
      assert.ok(!fs.existsSync(backupPath), "no backup on first run (nothing to back up)");
      const backupDir = path.join(reviewRoot, "backup");
      assert.ok(!fs.existsSync(backupDir), "backup/ not created on first run");

      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });
      assert.ok(fs.existsSync(backupPath), "fixed backup should exist after second run");
      assert.ok(!fs.existsSync(backupDir), "timestamped backup/ directory should not be auto-created");
    });

    it("subsequent runs overwrite the fixed backup without accumulating timestamped backups", async () => {
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });
      const backupPath = path.join(reviewRoot, BACKUP_FILE_NAME);
      const stat1 = fs.statSync(backupPath);
      await new Promise((r) => setTimeout(r, 50));
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });
      const stat2 = fs.statSync(backupPath);
      assert.ok(stat2.mtimeMs >= stat1.mtimeMs, "fixed backup should be overwritten");

      const allRootFiles = fs.readdirSync(reviewRoot);
      const timestampedRootBackups = allRootFiles.filter((f) => TIMESTAMPED_BACKUP_RE.test(f));
      assert.equal(timestampedRootBackups.length, 0, "timestamped backups should not be written in root");
      assert.ok(!fs.existsSync(path.join(reviewRoot, "backup")), "timestamped backup/ directory should not be auto-created");
    });

    it("leaves a pre-existing user backup directory untouched", async () => {
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });

      const backupDir = path.join(reviewRoot, "backup");
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(path.join(backupDir, "unrelated.docx"), "unrelated");
      fs.writeFileSync(path.join(backupDir, "random_file.txt"), "random");

      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });

      const files = fs.readdirSync(backupDir);
      assert.ok(files.includes("unrelated.docx"), "unrelated .docx should not be deleted");
      assert.ok(files.includes("random_file.txt"), "random .txt should not be deleted");
      assert.equal(files.filter((f) => TIMESTAMPED_BACKUP_RE.test(f)).length, 0, "timestamped backups should not be added");
    });

    it("no crash when source docx does not exist at first sync", async () => {
      // First sync: no prior docx -> backup is skipped, docx is created fresh
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });
      assert.ok(fs.existsSync(screeningStandardsDocxPath(reviewRoot)), "docx was created");
      const backupDir = path.join(reviewRoot, "backup");
      if (fs.existsSync(backupDir)) {
        assert.equal(fs.readdirSync(backupDir).length, 0, "backup/ should be empty on first run");
      }
    });
  });

  describe("Pending Rule Suggestions heading always present", () => {
    it("heading exists even when no suggestions", async () => {
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });
      const parsed = await parseScreeningStandardsDocx(screeningStandardsDocxPath(reviewRoot));
      assert.ok(
        parsed.section_names.includes("待确认规则建议") || parsed.section_names.includes("待确认规则建议 / Pending Rule Suggestions"),
        "Pending Rule Suggestions heading should always be present",
      );
    });

    it("placeholder text shown when no suggestions", async () => {
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath, evaluationText: "" });
      const docxPath = screeningStandardsDocxPath(reviewRoot);
      const raw = fs.readFileSync(docxPath).toString("latin1");
      assert.ok(
        raw.includes("暂无待确认规则建议") || raw.includes("No pending rule suggestions"),
        "placeholder text should appear when no suggestions",
      );
    });
  });

  describe("manual evaluation propose-first", () => {
    it("does not modify formal standards or pubmed config in default propose mode", async () => {
      await syncScreeningStandardsDocx(reviewRoot, {
        pubmedConfigPath,
        evaluationText: "建议把缺乏机制的人群结局研究先降权。",
      });
      const mdBefore = fs.readFileSync(screeningStandardsPath(reviewRoot), "utf8");
      const pubmedBefore = fs.readFileSync(pubmedConfigPath, "utf8");
      const auditPath = path.join(tmpRoot, "manual_standard_evaluation_audit.json");

      const audit = await processManualStandardEvaluation({
        reviewRoot,
        pubmedConfigPath,
        auditPath,
        llmClient: async () => ({
          rules_added: ["降权缺乏机制的人群结局研究。"],
          rules_deleted: [],
          rules_changed: [],
          keywords_added: { required: [["clinical outcome"]], optional: [], negative: [] },
          keywords_removed: [],
          negative_keywords_added: ["pure clinical outcome"],
          unmapped_feedback: [],
        }),
        manualStandardEvaluationConfig: {
          mode: "propose",
          allow_direct_apply: false,
          clear_evaluation_after_success: false,
        },
      });

      assert.equal(audit.mode, "propose");
      assert.equal(audit.applied, false);
      assert.equal(audit.formal_rules_modified, false);
      assert.equal(audit.pubmed_config_modified, false);
      assert.equal(audit.proposed_count > 0, true);
      assert.equal(fs.readFileSync(screeningStandardsPath(reviewRoot), "utf8"), mdBefore);
      assert.equal(fs.readFileSync(pubmedConfigPath, "utf8"), pubmedBefore);

      const parsed = await parseScreeningStandardsDocx(screeningStandardsDocxPath(reviewRoot));
      assert.match(parsed.evaluation_text, /缺乏机制/);
      const log = JSON.parse(fs.readFileSync(ruleSuggestionsLogPath(reviewRoot), "utf8"));
      assert.equal(log.suggestions.length > 0, true);
      assert.equal(log.suggestions[0].source, "docx_manual_evaluation");
      assert.equal(log.suggestions[0].status, "pending");
    });

    it("requires explicit allow_direct_apply before direct application", async () => {
      await syncScreeningStandardsDocx(reviewRoot, {
        pubmedConfigPath,
        evaluationText: "[DIRECT_APPLY] 增加正式规则：优先关注机制研究。",
      });
      const mdBefore = fs.readFileSync(screeningStandardsPath(reviewRoot), "utf8");

      const audit = await processManualStandardEvaluation({
        reviewRoot,
        pubmedConfigPath,
        auditPath: path.join(tmpRoot, "manual_standard_evaluation_direct_blocked.json"),
        llmClient: async () => ({
          rules_added: ["优先关注机制研究。"],
          rules_deleted: [],
          rules_changed: [],
          keywords_added: { required: [], optional: [], negative: [] },
          keywords_removed: [],
          negative_keywords_added: [],
          unmapped_feedback: [],
        }),
        manualStandardEvaluationConfig: {
          mode: "direct_apply",
          allow_direct_apply: false,
          clear_evaluation_after_success: false,
        },
      });

      assert.equal(audit.applied, false);
      assert.equal(audit.skipped_direct_apply_reason, "allow_direct_apply_false");
      assert.equal(fs.readFileSync(screeningStandardsPath(reviewRoot), "utf8"), mdBefore);
    });

    it("blocks direct apply when no_formal_rule_apply is enabled", async () => {
      await syncScreeningStandardsDocx(reviewRoot, {
        pubmedConfigPath,
        evaluationText: "[DIRECT_APPLY] 增加正式规则：优先关注机制研究。",
      });
      const mdBefore = fs.readFileSync(screeningStandardsPath(reviewRoot), "utf8");
      const pubmedBefore = fs.readFileSync(pubmedConfigPath, "utf8");

      const audit = await processManualStandardEvaluation({
        reviewRoot,
        pubmedConfigPath,
        auditPath: path.join(tmpRoot, "manual_standard_evaluation_no_formal_apply.json"),
        llmClient: async () => ({
          rules_added: ["优先关注机制研究。"],
          rules_deleted: [],
          rules_changed: [],
          keywords_added: { required: [["mechanistic study"]], optional: [], negative: [] },
          keywords_removed: [],
          negative_keywords_added: [],
          unmapped_feedback: [],
        }),
        manualStandardEvaluationConfig: {
          mode: "direct_apply",
          allow_direct_apply: true,
          clear_evaluation_after_success: false,
          no_formal_rule_apply: true,
        },
      });

      assert.equal(audit.applied, false);
      assert.equal(audit.formal_rules_modified, false);
      assert.equal(audit.pubmed_config_modified, false);
      assert.equal(audit.no_formal_rule_apply, true);
      assert.equal(audit.planned_but_not_applied, true);
      assert.equal(fs.readFileSync(screeningStandardsPath(reviewRoot), "utf8"), mdBefore);
      assert.equal(fs.readFileSync(pubmedConfigPath, "utf8"), pubmedBefore);
    });
  });

  describe("feedback learning formal-rule write gate", () => {
    it("does not modify screening_standards.md when feedback learning apply is disabled", async () => {
      const original = `${INITIAL_SCREENING_STANDARDS_ZH}\n## 待退休规则\n\n* 临时规则应保留。\n`;
      fs.writeFileSync(screeningStandardsPath(reviewRoot), original, "utf8");

      const result = await applyScreeningStandardsLearningUpdate(reviewRoot, {
        summary_change_log: [{
          change_type: "retired",
          statement: "临时规则应保留。",
          rationale: "feedback-derived retirement must not directly modify formal rules",
        }],
      }, {
        mode: "feedback_learning_disabled",
        suggestionsLogPath: ruleSuggestionsLogPath(reviewRoot),
      });

      assert.equal(result.apply_screening_standards_learning_update_called, false);
      assert.equal(result.feedback_learning_can_modify_formal_rules, false);
      assert.equal(result.formal_files_modified, false);
      assert.equal(fs.readFileSync(screeningStandardsPath(reviewRoot), "utf8"), original);
    });

    it("does not modify screening_standards.md when no_formal_rule_apply is enabled", async () => {
      const original = `${INITIAL_SCREENING_STANDARDS_ZH}\n## 待退休规则\n\n* 临时规则应保留。\n`;
      fs.writeFileSync(screeningStandardsPath(reviewRoot), original, "utf8");

      const result = await applyScreeningStandardsLearningUpdate(reviewRoot, {
        summary_change_log: [{
          change_type: "retired",
          statement: "临时规则应保留。",
          rationale: "must be planned only in dry-run",
        }],
      }, {
        mode: "legacy_apply",
        noFormalRuleApply: true,
        suggestionsLogPath: ruleSuggestionsLogPath(reviewRoot),
      });

      assert.equal(result.apply_screening_standards_learning_update_called, false);
      assert.equal(result.no_formal_rule_apply, true);
      assert.equal(result.planned_but_not_applied, true);
      assert.equal(result.formal_files_modified, false);
      assert.equal(fs.readFileSync(screeningStandardsPath(reviewRoot), "utf8"), original);
    });
  });
});
