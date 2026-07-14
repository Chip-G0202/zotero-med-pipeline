import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { buildRuntimeConfig } from "../tools/lib/runtime_config.mjs";
import { loadFixtureCandidates } from "../tools/stage1/fixture_input.mjs";
import { runZoteroLiteratureFilter } from "../tools/stage0/main.mjs";

async function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function manualRunMode() {
  return { explicitForceRun: true, isManualOrForce: true, stage1Only: false };
}

function smokeConfig(now = new Date("2026-06-30T07:00:00.000Z")) {
  return buildRuntimeConfig({
    cwd: process.cwd(),
    now,
    env: {
      ...process.env,
      review_results_OUTPUT_ROOT: path.join(os.tmpdir(), "pipeline_smoke_output"),
    },
  });
}

function makeArtifactMocks({ startedAt, writebackReady = true, dryRunSummary = true } = {}) {
  const stageStartedMs = startedAt.getTime();
  const artifacts = new Map();
  if (writebackReady) {
    artifacts.set("writeback_ready_items.json", [
      { id: "normal", title: "Normal metadata item", grade: "A", doi: "10.0000/example.019", publicationTitle: "Journal A" },
      { id: "missing", title: "Missing DOI item", grade: "B", publicationTitle: "" },
      { id: "dirty", title: "Dirty publication item", grade: "C", publicationTitle: "Wiley: Example Topic" },
    ]);
  }
  if (dryRunSummary) {
    artifacts.set("zotero_writeback_dry_run_summary.json", {
      dry_run: true,
      writeback_side_effect_summary: {
        dry_run: true,
        external_write_performed: false,
        items_planned_count: 3,
        items_attempted_count: 0,
        would_write_items_count: 3,
        actual_write_items_count: 0,
      },
    });
  }

  return {
    readJson: async (filePath) => {
      if (filePath.includes("runtime_state.json")) {
        return { last_successful_full_run_at: "2026-06-28T07:00:00.000Z" };
      }
      for (const [name, value] of artifacts) {
        if (filePath.includes(name)) return value;
      }
      if (filePath.includes("run_skip_report.json")) throw new Error("skip report unavailable");
      return {};
    },
    statArtifact: async (filePath) => {
      for (const name of artifacts.keys()) {
        if (filePath.includes(name)) return { exists: true, mtimeMs: stageStartedMs };
      }
      return { exists: false, mtimeMs: null };
    },
  };
}

describe("pipeline dry-run smoke", () => {
  it("runs the orchestrator dry-run path with mocked stages and no external writes", async () => {
    const startedAt = new Date("2026-06-30T07:00:00.000Z");
    const order = [];
    const reports = [];
    const artifactMocks = makeArtifactMocks({ startedAt });

    const report = await withEnv({
      review_results_DRY_RUN: "true",
      review_results_FORCE_RUN: undefined,
      FORCE_review_results_RUN: undefined,
    }, () => runZoteroLiteratureFilter({
      config: smokeConfig(startedAt),
      triggerMode: "manual",
      runMode: manualRunMode(),
      clock: () => startedAt,
      ...artifactMocks,
      writeJson: async () => {},
      writeReport: async (value) => { reports.push(value); },
      ensureStartupReady: async () => {
        throw new Error("startup should not run in dry-run smoke test");
      },
      runStage: async (stage) => {
        order.push(stage.name);
        if (stage.name === "stage1") return { exitCode: 0, stdout: "mock stage1", stderr: "" };
        if (stage.name === "stage2_writeback") return { exitCode: 0, stdout: "mock stage2 dry-run", stderr: "" };
        throw new Error(`${stage.name} should be skipped in dry-run smoke test`);
      },
    }));

    assert.deepEqual(order, ["stage1", "stage2_writeback"]);
    assert.equal(report.status, "completed_stage1_only");
    assert.equal(report.startup.skipped_due_to_dry_run, true);
    assert.equal(report.dry_run_summary.dry_run, true);
    assert.equal(report.dry_run_summary.external_write_performed, false);
    assert.equal(report.dry_run_summary.zotero_write_blocked, true);
    assert.equal(report.external_call_summary.zotero_backend_writeback.triggered, false);
    assert.equal(report.external_call_summary.translation_api.triggered, false);
    assert.equal(report.external_call_summary.file_exports.triggered, false);
    assert.equal(report.artifacts.writeback_summary.exists, true);
    assert.equal(reports.at(-1), report);
  });

  it("fails closed when Stage 1 writeback-ready artifact is missing", async () => {
    const startedAt = new Date("2026-06-30T07:00:00.000Z");
    const order = [];
    const artifactMocks = makeArtifactMocks({ startedAt, writebackReady: false, dryRunSummary: false });

    const report = await withEnv({
      review_results_DRY_RUN: "true",
      review_results_FORCE_RUN: undefined,
      FORCE_review_results_RUN: undefined,
    }, () => runZoteroLiteratureFilter({
      config: smokeConfig(startedAt),
      triggerMode: "manual",
      runMode: manualRunMode(),
      clock: () => startedAt,
      ...artifactMocks,
      writeJson: async () => {},
      writeReport: async () => {},
      ensureStartupReady: async () => {
        throw new Error("startup should not run in dry-run smoke test");
      },
      runStage: async (stage) => {
        order.push(stage.name);
        if (stage.name === "stage1") return { exitCode: 0, stdout: "mock stage1", stderr: "" };
        throw new Error(`${stage.name} should not run after missing Stage 1 artifact`);
      },
    }));

    assert.deepEqual(order, ["stage1"]);
    assert.equal(report.status, "failed_stage1");
    assert.equal(report.stage1_artifact_reason, "stage1_artifacts_missing");
    assert.equal(report.run_outcome.failed_stage, "stage1");
    assert.equal(report.stages.find((stage) => stage.name === "stage2_writeback").skipReason, "stage1_artifacts_missing");
  });

  it("keeps fixture loading gated to dry-run or explicit allow", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline_smoke_fixture_"));
    await fs.writeFile(path.join(fixtureRoot, "candidates.json"), JSON.stringify([
      { id: "fx-normal", title: "Normal item", doi: "10.0000/example.013" },
      { id: "fx-missing", title: "Missing metadata item" },
    ]), "utf8");

    const blocked = await loadFixtureCandidates({ fixtureRoot, dryRun: false });
    const loaded = await loadFixtureCandidates({ fixtureRoot, dryRun: true });

    assert.equal(blocked.enabled, false);
    assert.equal(blocked.skipped_reason, "fixture_requires_dry_run_or_explicit_allow");
    assert.equal(loaded.enabled, true);
    assert.equal(loaded.items.length, 2);
    assert.match(loaded.path, /candidates\.json$/);
  });
});
