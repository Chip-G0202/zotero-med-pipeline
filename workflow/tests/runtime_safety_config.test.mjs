import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  applySampleLimit,
  buildRuntimeConfig,
  buildRuntimeSafetyConfig,
} from "../tools/lib/runtime_config.mjs";

describe("runtime safety config", () => {
  it("dry-run enables safe defaults and refuses official output root by default", () => {
    const runtime = buildRuntimeConfig({
      cwd: path.resolve("."),
      env: {},
      argv: ["node", "script", "--dry-run"],
      now: new Date("2026-06-22T00:00:00Z"),
    });
    const safety = buildRuntimeSafetyConfig({
      argv: ["node", "script", "--dry-run"],
      env: {},
      runtime,
    });

    assert.equal(safety.dry_run, true);
    assert.equal(safety.skip_zotero_mcp, true);
    assert.equal(safety.llm_mode, "disabled");
    assert.equal(safety.no_formal_rule_apply, true);
    assert.equal(safety.formal_writes_allowed, false);
    assert.equal(safety.official_root_protected, true);
    assert.equal(safety.fail_safe_blocked, true);
  });

  it("CLI values override env values", () => {
    const runtime = buildRuntimeConfig({
      cwd: "C:/repo",
      env: { review_results_SAMPLE_LIMIT: "50", LLM_MODE: "real", SKIP_ZOTERO_MCP: "false" },
      argv: ["node", "script", "--dry-run", "--sample-limit=5", "--llm-mode=mock", "--skip-zotero-mcp"],
      now: new Date("2026-06-22T00:00:00Z"),
    });
    const safety = buildRuntimeSafetyConfig({
      argv: ["node", "script", "--dry-run", "--sample-limit=5", "--llm-mode=mock", "--skip-zotero-mcp"],
      env: { review_results_SAMPLE_LIMIT: "50", LLM_MODE: "real", SKIP_ZOTERO_MCP: "false" },
      runtime,
    });

    assert.equal(safety.sample_limit, 5);
    assert.equal(safety.llm_mode, "mock");
    assert.equal(safety.skip_zotero_mcp, true);
  });

  it("explicit --llm-mode=real is allowed in dry-run for controlled LLM validation", () => {
    const runtime = buildRuntimeConfig({
      cwd: "C:/repo",
      env: {},
      argv: ["node", "script", "--dry-run", "--output-root=C:/tmp/research-dryrun", "--llm-mode=real", "--skip-zotero-mcp", "--no-formal-rule-apply"],
      now: new Date("2026-06-22T00:00:00Z"),
    });
    const safety = buildRuntimeSafetyConfig({
      argv: ["node", "script", "--dry-run", "--output-root=C:/tmp/research-dryrun", "--llm-mode=real", "--skip-zotero-mcp", "--no-formal-rule-apply"],
      env: {},
      runtime,
    });

    assert.equal(safety.dry_run, true);
    assert.equal(safety.llm_mode, "real");
    assert.equal(safety.llm_real_requested_but_blocked, false);
    assert.equal(safety.skip_zotero_mcp, true);
    assert.equal(safety.no_formal_rule_apply, true);
    assert.equal(safety.fail_safe_blocked, false);
  });

  it("dry-run keeps network fetch disabled by default", () => {
    const runtime = buildRuntimeConfig({
      cwd: "C:/repo",
      env: {},
      argv: ["node", "script", "--dry-run", "--output-root=C:/tmp/research-dryrun"],
      now: new Date("2026-06-22T00:00:00Z"),
    });
    const safety = buildRuntimeSafetyConfig({
      argv: ["node", "script", "--dry-run", "--output-root=C:/tmp/research-dryrun"],
      env: {},
      runtime,
    });

    assert.equal(safety.allow_network_fetch, false);
    assert.equal(safety.network_fetch_allowed, false);
    assert.deepEqual(safety.network_fetch_fail_safe_reasons, []);
    assert.equal(safety.fail_safe_blocked, false);
  });

  it("refuses dry-run network fetch without a fetch or sample limit", () => {
    const argv = ["node", "script", "--dry-run", "--allow-network-fetch", "--output-root=C:/tmp/research-dryrun", "--skip-zotero-mcp", "--no-formal-rule-apply"];
    const runtime = buildRuntimeConfig({
      cwd: "C:/repo",
      env: {},
      argv,
      now: new Date("2026-06-22T00:00:00Z"),
    });
    const safety = buildRuntimeSafetyConfig({ argv, env: {}, runtime });

    assert.equal(safety.allow_network_fetch, true);
    assert.equal(safety.network_fetch_allowed, false);
    assert.equal(safety.fail_safe_blocked, true);
    assert.ok(safety.network_fetch_fail_safe_reasons.includes("network_fetch_limit_required"));
  });

  it("allows dry-run network fetch only with temp output, Zotero skip, no formal apply, and limits", () => {
    const argv = ["node", "script", "--dry-run", "--allow-network-fetch", "--fetch-limit=5", "--sample-limit=5", "--output-root=C:/tmp/research-dryrun", "--skip-zotero-mcp", "--no-formal-rule-apply"];
    const runtime = buildRuntimeConfig({
      cwd: "C:/repo",
      env: {},
      argv,
      now: new Date("2026-06-22T00:00:00Z"),
    });
    const safety = buildRuntimeSafetyConfig({ argv, env: {}, runtime });

    assert.equal(safety.allow_network_fetch, true);
    assert.equal(safety.network_fetch_allowed, true);
    assert.equal(safety.fetch_limit, 5);
    assert.equal(safety.sample_limit, 5);
    assert.equal(safety.skip_zotero_mcp, true);
    assert.equal(safety.no_formal_rule_apply, true);
    assert.equal(safety.fail_safe_blocked, false);
  });

  it("records representative sample strategy without changing default safety gates", () => {
    const argv = ["node", "script", "--dry-run", "--allow-network-fetch", "--fetch-limit=100", "--sample-limit=20", "--sample-strategy=representative", "--output-root=C:/tmp/research-dryrun", "--skip-zotero-mcp", "--no-formal-rule-apply"];
    const runtime = buildRuntimeConfig({
      cwd: "C:/repo",
      env: {},
      argv,
      now: new Date("2026-06-22T00:00:00Z"),
    });
    const safety = buildRuntimeSafetyConfig({ argv, env: {}, runtime });

    assert.equal(safety.sample_strategy, "representative");
    assert.equal(safety.network_fetch_allowed, true);
    assert.equal(safety.fail_safe_blocked, false);
  });

  it("records max grade review item override from CLI or env", () => {
    const cliArgv = ["node", "script", "--max-grade-review-items=30"];
    const cliRuntime = buildRuntimeConfig({
      cwd: "C:/repo",
      env: {},
      argv: cliArgv,
      now: new Date("2026-06-22T00:00:00Z"),
    });
    const cliSafety = buildRuntimeSafetyConfig({ argv: cliArgv, env: {}, runtime: cliRuntime });
    assert.equal(cliSafety.max_grade_review_items, 30);

    const envArgv = ["node", "script"];
    const envRuntime = buildRuntimeConfig({
      cwd: "C:/repo",
      env: { review_results_MAX_GRADE_REVIEW_ITEMS: "25" },
      argv: envArgv,
      now: new Date("2026-06-22T00:00:00Z"),
    });
    const envSafety = buildRuntimeSafetyConfig({
      argv: envArgv,
      env: { review_results_MAX_GRADE_REVIEW_ITEMS: "25" },
      runtime: envRuntime,
    });
    assert.equal(envSafety.max_grade_review_items, 25);
  });

  it("output-root routes Research OS outputs away from the project root", () => {
    const runtime = buildRuntimeConfig({
      cwd: "C:/repo",
      env: {},
      argv: ["node", "script", "--dry-run", "--output-root=C:/tmp/research-dryrun"],
      now: new Date("2026-06-22T00:00:00Z"),
    });
    const safety = buildRuntimeSafetyConfig({
      argv: ["node", "script", "--dry-run", "--output-root=C:/tmp/research-dryrun"],
      env: {},
      runtime,
    });

    assert.equal(runtime.outputRoot.endsWith("tmp/research-dryrun"), true);
    assert.equal(runtime.researchRoot, path.resolve("C:/tmp/research-dryrun/review_results").replace(/\\/g, "/"));
    assert.equal(safety.fail_safe_blocked, false);
    assert.equal(safety.official_root_protected, false);
  });

  it("DESKTOP_REVIEW_ROOT is legacy input only and does not move official outputs", () => {
    const runtime = buildRuntimeConfig({
      cwd: "C:/repo",
      env: { DESKTOP_REVIEW_ROOT: "./research_os/文献评价" },
      argv: ["node", "script"],
      now: new Date("2026-06-22T00:00:00Z"),
    });

    assert.equal(runtime.reviewRoot, path.resolve("C:/repo/review_results/文献评价").replace(/\\/g, "/"));
    assert.equal(runtime.legacyDesktopReviewRoot, path.resolve("C:/repo/research_os/文献评价").replace(/\\/g, "/"));
  });

  it("fixture-root is recorded without replacing the project root", () => {
    const runtime = buildRuntimeConfig({
      cwd: "C:/repo",
      env: {},
      argv: ["node", "script", "--fixture-root=C:/tmp/fixtures"],
      now: new Date("2026-06-22T00:00:00Z"),
    });

    assert.equal(runtime.projectRoot, path.resolve("C:/repo").replace(/\\/g, "/"));
    assert.equal(runtime.fixtureRoot, path.resolve("C:/tmp/fixtures").replace(/\\/g, "/"));
  });

  it("sample-limit limits pre-triage inputs and is independent from export-limit", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const limited = applySampleLimit(items, 2, "pre_triage");

    assert.deepEqual(limited.items, [{ id: 1 }, { id: 2 }]);
    assert.equal(limited.audit.enabled, true);
    assert.equal(limited.audit.limit, 2);
    assert.equal(limited.audit.applied_at, "pre_triage");
    assert.equal(limited.audit.input_count_before_limit, 3);
    assert.equal(limited.audit.input_count_after_limit, 2);
  });
});
