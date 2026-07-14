import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildRunContext,
  deriveWorkflowStatus,
  buildOrchestratorReport,
  buildExternalCallSummary,
  workflowStatusToExitCode,
  WORKFLOW_STATUS,
} from "../tools/lib/orchestrator_status.mjs";
import { buildWritebackSideEffectSummary } from "../tools/stage2/main.mjs";
import { runZoteroLiteratureFilter } from "../tools/stage0/main.mjs";
import {
  ensureWorkflowStartupReady,
  createStartupError,
  restartWorkflowProcess,
} from "../tools/lib/workflow_startup_ready.mjs";
import { launchZoteroDesktop } from "../tools/lib/zotero_desktop_launcher.mjs";
import {
  buildIntervalGateDiagnostics,
  evaluateRunInterval,
  resolveRuntimeStateReference,
  RUNTIME_STATE_FIELD_OWNERSHIP,
} from "../tools/lib/schedule_support.mjs";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRunContext(overrides = {}) {
  return buildRunContext({
    automationName: "zotero-literature-filter",
    runId: "zlf-test-123",
    platform: "win32",
    startedAt: "2026-05-31T10:00:00.000Z",
    triggerMode: "manual",
    runMode: { explicitForceRun: true, isManualOrForce: true },
    manualTrigger: true,
    pipelineDir: "/tmp/pipeline",
    ...overrides,
  });
}

function makeStage(name, exitCode, statusOverride) {
  return {
    name,
    command: `node ${name}.mjs`,
    startedAt: "2026-05-31T10:00:00.000Z",
    finishedAt: "2026-05-31T10:00:01.000Z",
    exitCode,
    status: statusOverride ?? (exitCode === 0 ? "completed" : exitCode === null ? "skipped" : "failed"),
  };
}

// ── Tests: buildRunContext ────────────────────────────────────────────────────

describe("buildRunContext", () => {
  it("should build context with all required fields", () => {
    const ctx = makeRunContext();
    assert.equal(ctx.automationName, "zotero-literature-filter");
    assert.equal(ctx.runId, "zlf-test-123");
    assert.equal(ctx.platform, "win32");
    assert.equal(ctx.startedAt, "2026-05-31T10:00:00.000Z");
    assert.equal(ctx.triggerMode, "manual");
    assert.equal(ctx.forceRun, true);
    assert.equal(ctx.explicitForceRun, true);
    assert.equal(ctx.bypassIntervalGate, true);
    assert.equal(ctx.bypassReason, "explicit_force_run");
    assert.equal(ctx.pipelineDir, "/tmp/pipeline");
  });

  it("should set bypassReason to manual when manualTrigger=true but explicitForceRun=false", () => {
    const ctx = makeRunContext({
      runMode: { explicitForceRun: false, isManualOrForce: true },
      manualTrigger: true,
    });
    assert.equal(ctx.forceRun, true);
    assert.equal(ctx.explicitForceRun, false);
    assert.equal(ctx.bypassReason, "manual_bypass_interval_gate");
  });

  it("should set bypassReason to null when no bypass", () => {
    const ctx = makeRunContext({
      runMode: { explicitForceRun: false, isManualOrForce: false },
      manualTrigger: false,
    });
    assert.equal(ctx.forceRun, false);
    assert.equal(ctx.bypassReason, null);
  });

  it("should freeze the context object", () => {
    const ctx = makeRunContext();
    assert.throws(() => { ctx.runId = "changed"; }, TypeError);
  });
});

// ── Tests: deriveWorkflowStatus ──────────────────────────────────────────────

describe("deriveWorkflowStatus", () => {
  it("should return explicitStatus when provided", () => {
    const status = deriveWorkflowStatus({
      explicitStatus: "skipped",
      stages: [],
      artifacts: {},
    });
    assert.equal(status, "skipped");
  });

  it("all stages completed → completed", () => {
    const stages = [
      makeStage("stage1", 0),
      makeStage("zotero_backend_ready", 0),
      makeStage("stage2_writeback", 0),
      makeStage("stage3_translation", 0),
      makeStage("stage4_exports", 0),
    ];
    assert.equal(deriveWorkflowStatus({ stages }), WORKFLOW_STATUS.COMPLETED);
  });

  it("stage1 failed → failed_stage1", () => {
    const stages = [
      makeStage("stage1", 1),
      makeStage("zotero_backend_ready", null, "skipped"),
      makeStage("stage2_writeback", null, "skipped"),
    ];
    assert.equal(deriveWorkflowStatus({ stages }), WORKFLOW_STATUS.FAILED_STAGE1);
  });

  it("zotero_backend_ready failed with stage1 ok → degraded_due_to_zotero_backend_unavailable", () => {
    const stages = [
      makeStage("stage1", 0),
      makeStage("zotero_backend_ready", 1),
      makeStage("stage2_writeback", null, "skipped"),
    ];
    assert.equal(deriveWorkflowStatus({ stages }), WORKFLOW_STATUS.DEGRADED_DUE_TO_ZOTERO_BACKEND_UNAVAILABLE);
  });

  it("stage2_writeback failed → failed_stage2_writeback", () => {
    const stages = [
      makeStage("stage1", 0),
      makeStage("zotero_backend_ready", 0),
      makeStage("stage2_writeback", 1),
      makeStage("stage3_translation", null, "skipped"),
    ];
    assert.equal(deriveWorkflowStatus({ stages }), WORKFLOW_STATUS.FAILED_STAGE2_WRITEBACK);
  });

  it("stage3_translation failed (hard) → failed_stage3_translation", () => {
    const stages = [
      makeStage("stage1", 0),
      makeStage("zotero_backend_ready", 0),
      makeStage("stage2_writeback", 0),
      makeStage("stage3_translation", 1),
      makeStage("stage4_exports", null, "skipped"),
    ];
    assert.equal(deriveWorkflowStatus({ stages }), WORKFLOW_STATUS.FAILED_STAGE3_TRANSLATION);
  });

  it("stage3 partial_failed + stage4 completed → completed_with_warnings", () => {
    const stages = [
      makeStage("stage1", 0),
      makeStage("zotero_backend_ready", 0),
      makeStage("stage2_writeback", 0),
      makeStage("stage3_translation", 2, "partial_failed"),
      makeStage("stage4_exports", 0),
    ];
    assert.equal(deriveWorkflowStatus({ stages }), WORKFLOW_STATUS.COMPLETED_WITH_WARNINGS);
  });

  it("stage4_exports failed → failed_stage4_export", () => {
    const stages = [
      makeStage("stage1", 0),
      makeStage("zotero_backend_ready", 0),
      makeStage("stage2_writeback", 0),
      makeStage("stage3_translation", 0),
      makeStage("stage4_exports", 1),
    ];
    assert.equal(deriveWorkflowStatus({ stages }), WORKFLOW_STATUS.FAILED_STAGE4_EXPORT);
  });

  it("empty stages → failed_due_to_config_or_dependency", () => {
    assert.equal(deriveWorkflowStatus({ stages: [] }), WORKFLOW_STATUS.FAILED_DUE_TO_CONFIG_OR_DEPENDENCY);
  });
});

// ── Tests: buildOrchestratorReport ───────────────────────────────────────────

describe("buildOrchestratorReport", () => {
  it("should build report with all core fields", () => {
    const runContext = makeRunContext();
    const stages = [makeStage("stage1", 0)];
    const artifacts = { writeback_summary: { exists: true } };

    const report = buildOrchestratorReport({
      status: "completed",
      runContext,
      finishedAt: "2026-05-31T10:01:00.000Z",
      stages,
      artifacts,
    });

    assert.equal(report.automationName, "zotero-literature-filter");
    assert.equal(report.runId, "zlf-test-123");
    assert.equal(report.platform, "win32");
    assert.equal(report.startedAt, "2026-05-31T10:00:00.000Z");
    assert.equal(report.finishedAt, "2026-05-31T10:01:00.000Z");
    assert.equal(report.status, "completed");
    assert.equal(report.triggerMode, "manual");
    assert.equal(report.forceRun, true);
    assert.equal(report.explicitForceRun, true);
    assert.equal(report.bypassIntervalGate, true);
    assert.equal(report.bypassReason, "explicit_force_run");
    assert.equal(report.pipelineDir, "/tmp/pipeline");
    assert.deepEqual(report.stages, stages);
    assert.deepEqual(report.artifacts, artifacts);
  });

  it("should attach warnings when provided", () => {
    const runContext = makeRunContext();
    const report = buildOrchestratorReport({
      status: "completed_with_warnings",
      runContext,
      finishedAt: "2026-05-31T10:01:00.000Z",
      stages: [],
      artifacts: {},
      warnings: ["stage3_translation_partial_failed"],
    });

    assert.deepEqual(report.warnings, ["stage3_translation_partial_failed"]);
  });

  it("should not attach warnings when empty", () => {
    const runContext = makeRunContext();
    const report = buildOrchestratorReport({
      status: "completed",
      runContext,
      finishedAt: "2026-05-31T10:01:00.000Z",
      stages: [],
      artifacts: {},
      warnings: [],
    });

    assert.equal(report.warnings, undefined);
  });

  it("should merge extra fields", () => {
    const runContext = makeRunContext();
    const report = buildOrchestratorReport({
      status: "completed_stage1_only",
      runContext,
      finishedAt: "2026-05-31T10:01:00.000Z",
      stages: [],
      artifacts: {},
      extra: { stage1Only: true },
    });

    assert.equal(report.stage1Only, true);
  });

  it("should merge skipReport into extra", () => {
    const runContext = makeRunContext();
    const skipReport = { skipped_due_to_interval: true, next_eligible_run_at: "2026-06-02T10:00:00.000Z" };
    const report = buildOrchestratorReport({
      status: "skipped_due_to_interval",
      runContext,
      finishedAt: "2026-05-31T10:00:00.000Z",
      stages: [],
      artifacts: {},
      extra: { skipReport },
    });

    assert.deepEqual(report.skipReport, skipReport);
  });

  it("adds run_outcome for interval-gate skipped runs", () => {
    const runContext = makeRunContext();
    const stages = [
      makeStage("stage1", null, "skipped"),
      makeStage("zotero_backend_ready", null, "skipped"),
      makeStage("stage2_writeback", null, "skipped"),
      makeStage("stage3_translation", null, "skipped"),
      makeStage("stage4_exports", null, "skipped"),
    ].map((stage) => ({ ...stage, skipReason: "interval_not_reached" }));

    const report = buildOrchestratorReport({
      status: "skipped",
      runContext,
      finishedAt: "2026-05-31T10:01:00.000Z",
      stages,
      artifacts: {},
      extra: { skipReport: { skipped_due_to_interval: true } },
    });

    assert.equal(report.run_outcome.category, "skipped");
    assert.equal(report.run_outcome.work_performed, false);
    assert.equal(report.run_outcome.skipped_reason, "interval_not_reached");
    assert.deepEqual(report.run_outcome.stages_skipped, [
      "stage1",
      "zotero_backend_ready",
      "stage2_writeback",
      "stage3_translation",
      "stage4_exports",
    ]);
  });

  it("adds run_outcome for startup failures", () => {
    const runContext = makeRunContext();
    const stages = [
      makeStage("stage1", null, "skipped"),
      makeStage("zotero_backend_ready", null, "skipped"),
      makeStage("stage2_writeback", null, "skipped"),
    ].map((stage) => ({ ...stage, skipReason: "startup_failed" }));

    const report = buildOrchestratorReport({
      status: "failed_due_to_config_or_dependency",
      runContext,
      finishedAt: "2026-05-31T10:01:00.000Z",
      stages,
      artifacts: {},
      extra: { startup: { ok: false, failureClass: "process_permission_denied" } },
    });

    assert.equal(report.run_outcome.category, "failed");
    assert.equal(report.run_outcome.failed_stage, "startup");
    assert.equal(report.run_outcome.work_performed, false);
  });

  it("adds run_outcome for Stage 2 partial writeback failures", () => {
    const runContext = makeRunContext();
    const stages = [
      makeStage("stage1", 0),
      makeStage("zotero_backend_ready", 0),
      makeStage("stage2_writeback", 1),
      { ...makeStage("stage3_translation", null, "skipped"), skipReason: "stage2_failed" },
      { ...makeStage("stage4_exports", null, "skipped"), skipReason: "stage2_failed" },
    ];

    const report = buildOrchestratorReport({
      status: "failed_stage2_writeback",
      runContext,
      finishedAt: "2026-05-31T10:01:00.000Z",
      stages,
      artifacts: {
        writeback_summary: {
          currentRun: true,
          data: {
            writeback_side_effect_summary: {
              execution_status: "partial_success",
              partial_success: true,
              external_write_performed: true,
            },
          },
        },
      },
    });

    assert.equal(report.run_outcome.category, "partial");
    assert.equal(report.run_outcome.failed_stage, "stage2");
    assert.equal(report.run_outcome.work_performed, "partial");
    assert.equal(report.run_outcome.degraded_reason, "stage2_partial_writeback");
  });

  it("adds run_outcome for completed_with_warnings as degraded", () => {
    const runContext = makeRunContext();
    const stages = [
      makeStage("stage1", 0),
      makeStage("zotero_backend_ready", 0),
      makeStage("stage2_writeback", 0),
      makeStage("stage3_translation", 2, "partial_failed"),
      makeStage("stage4_exports", 0),
    ];

    const report = buildOrchestratorReport({
      status: "completed_with_warnings",
      runContext,
      finishedAt: "2026-05-31T10:01:00.000Z",
      stages,
      artifacts: {},
    });

    assert.equal(report.run_outcome.category, "degraded");
    assert.equal(report.run_outcome.work_performed, true);
    assert.ok(report.run_outcome.degraded_reason);
  });

  it("adds run_outcome for fully completed runs", () => {
    const runContext = makeRunContext();
    const stages = [
      makeStage("stage1", 0),
      makeStage("zotero_backend_ready", 0),
      makeStage("stage2_writeback", 0),
      makeStage("stage3_translation", 0),
      makeStage("stage4_exports", 0),
    ];

    const report = buildOrchestratorReport({
      status: "completed",
      runContext,
      finishedAt: "2026-05-31T10:01:00.000Z",
      stages,
      artifacts: {},
    });

    assert.equal(report.run_outcome.category, "completed");
    assert.equal(report.run_outcome.work_performed, true);
    assert.deepEqual(report.run_outcome.stages_executed, [
      "stage1",
      "zotero_backend_ready",
      "stage2_writeback",
      "stage3_translation",
      "stage4_exports",
    ]);
  });

  it("keeps run_outcome side_effects_possible consistent with external_call_summary", () => {
    const runContext = makeRunContext();
    const stages = [
      makeStage("stage1", 0),
      makeStage("zotero_backend_ready", 0),
      makeStage("stage2_writeback", 0),
      makeStage("stage3_translation", 0),
      makeStage("stage4_exports", 0),
    ];

    const report = buildOrchestratorReport({
      status: "completed",
      runContext,
      finishedAt: "2026-05-31T10:01:00.000Z",
      stages,
      artifacts: {},
    });

    assert.equal(report.external_call_summary.zotero_backend_writeback.triggered, true);
    assert.equal(report.external_call_summary.file_exports.triggered, true);
    assert.equal(report.run_outcome.side_effects_possible, true);
  });

  it("adds dry_run_summary from Stage 2 dry-run artifacts without reporting actual writes", () => {
    const runContext = makeRunContext({
      runMode: { explicitForceRun: false, isManualOrForce: true, dry_run: true, dry_run_source: "env" },
    });
    const stages = [
      makeStage("stage1", 0),
      makeStage("zotero_backend_ready", null, "skipped"),
      makeStage("stage2_writeback", 0),
      { ...makeStage("stage3_translation", null, "skipped"), skipReason: "dry_run" },
      { ...makeStage("stage4_exports", null, "skipped"), skipReason: "dry_run" },
    ];

    const report = buildOrchestratorReport({
      status: "completed_stage1_only",
      runContext,
      finishedAt: "2026-05-31T10:01:00.000Z",
      stages,
      artifacts: {
        writeback_summary: {
          currentRun: true,
          data: {
            writeback_side_effect_summary: {
              dry_run: true,
              external_write_performed: false,
              items_planned_count: 3,
              items_attempted_count: 0,
              would_write_items_count: 3,
              actual_write_items_count: 0,
              would_create_collections_count: "unknown",
              actual_created_collections_count: 0,
              would_update_fields: { item_fields: 3 },
              actual_updated_fields: { item_fields: 0 },
            },
          },
        },
      },
      extra: { runtimeSafety: { dry_run: true, dry_run_source: "env" } },
    });

    assert.equal(report.dry_run_summary.dry_run, true);
    assert.equal(report.dry_run_summary.source, "env");
    assert.equal(report.dry_run_summary.zotero_write_blocked, true);
    assert.equal(report.dry_run_summary.translation_api_blocked, true);
    assert.equal(report.dry_run_summary.zotero_translation_writeback_blocked, true);
    assert.equal(report.dry_run_summary.file_exports_blocked, true);
    assert.equal(report.dry_run_summary.external_write_performed, false);
    assert.equal(report.dry_run_summary.would_write_summary.items_planned_count, 3);
    assert.equal(report.dry_run_summary.would_write_summary.would_write_items_count, 3);
    assert.equal(report.dry_run_summary.actual_write_summary.actual_write_items_count, 0);
    assert.equal(report.external_call_summary.zotero_backend_writeback.triggered, false);
    assert.equal(report.external_call_summary.translation_api.triggered, false);
    assert.equal(report.external_call_summary.file_exports.triggered, false);
  });

  it("does not mark writes blocked for non dry-run reports", () => {
    const runContext = makeRunContext();
    const stages = [
      makeStage("stage1", 0),
      makeStage("zotero_backend_ready", 0),
      makeStage("stage2_writeback", 0),
      makeStage("stage3_translation", 0),
      makeStage("stage4_exports", 0),
    ];

    const report = buildOrchestratorReport({
      status: "completed",
      runContext,
      finishedAt: "2026-05-31T10:01:00.000Z",
      stages,
      artifacts: {
        writeback_summary: {
          currentRun: true,
          data: {
            writeback_side_effect_summary: {
              dry_run: false,
              external_write_performed: true,
              items_planned_count: 2,
              items_attempted_count: 2,
              actual_write_items_count: 2,
            },
          },
        },
      },
    });

    assert.equal(report.dry_run_summary.dry_run, false);
    assert.equal(report.dry_run_summary.zotero_write_blocked, false);
    assert.equal(report.dry_run_summary.translation_api_blocked, false);
    assert.equal(report.dry_run_summary.file_exports_blocked, false);
    assert.equal(report.dry_run_summary.external_write_performed, true);
    assert.equal(report.external_call_summary.zotero_backend_writeback.triggered, true);
    assert.equal(report.external_call_summary.file_exports.triggered, true);
  });
});

describe("buildWritebackSideEffectSummary", () => {
  it("reports dry-run write plans separately from actual writes", () => {
    const summary = buildWritebackSideEffectSummary({
      itemsPlannedCount: 4,
      counters: { created: 2, failed: 1, added_to_pool: 2, added_to_daily_collection: 2 },
      dryRun: true,
      mcpReady: true,
      collectionKeys: ["root", "day", "rss", "grade-a"],
      mcpCallsByTool: { create_collection: 3, create_item: 2, write_tag: 2 },
    });

    assert.equal(summary.dry_run, true);
    assert.equal(summary.external_write_performed, false);
    assert.equal(summary.items_planned_count, 4);
    assert.equal(summary.items_attempted_count, 0);
    assert.equal(summary.would_write_items_count, 4);
    assert.equal(summary.actual_write_items_count, 0);
    assert.equal(summary.would_create_collections_count, 3);
    assert.equal(summary.actual_created_collections_count, 0);
    assert.deepEqual(summary.would_update_fields, { item_fields: 4, short_title: 0, tags: 4, notes: 0 });
    assert.deepEqual(summary.actual_updated_fields, { item_fields: 0, short_title: 0, tags: 0, notes: 0 });
  });

  it("reports non dry-run actual write counts without blocking semantics", () => {
    const summary = buildWritebackSideEffectSummary({
      itemsPlannedCount: 3,
      counters: { created: 2, failed: 1, added_to_pool: 2, added_to_daily_collection: 2 },
      dryRun: false,
      mcpReady: true,
      mcpCallsByTool: { create_collection: 2, create_item: 2, write_tag: 1 },
      tagCleanupStats: { cleaned_items: 1 },
    });

    assert.equal(summary.dry_run, false);
    assert.equal(summary.items_planned_count, 3);
    assert.equal(summary.items_attempted_count, 3);
    assert.equal(summary.would_write_items_count, 3);
    assert.equal(summary.actual_write_items_count, 2);
    assert.equal(summary.would_create_collections_count, 2);
    assert.equal(summary.actual_created_collections_count, 2);
    assert.equal(summary.actual_updated_fields.item_fields, 2);
    assert.equal(summary.actual_updated_fields.tags, 3);
    assert.equal(summary.external_write_performed, true);
  });
});

describe("buildExternalCallSummary", () => {
  it("all skipped stages returns false for all categories", () => {
    const stages = [
      { name: "stage1", status: "skipped", skipReason: "interval_not_reached" },
      { name: "zotero_backend_ready", status: "skipped", skipReason: "interval_not_reached" },
      { name: "stage2_writeback", status: "skipped", skipReason: "interval_not_reached" },
      { name: "stage3_translation", status: "skipped", skipReason: "interval_not_reached" },
      { name: "stage4_exports", status: "skipped", skipReason: "interval_not_reached" },
    ];
    const summary = buildExternalCallSummary(stages);
    for (const [, cat] of Object.entries(summary)) {
      assert.equal(cat.triggered, false, `${cat.constructor?.name ?? "category"} triggered should be false`);
    }
  });

  it("empty stages returns triggered false with meaningful evidence", () => {
    const summary = buildExternalCallSummary([]);
    for (const key of Object.keys(summary)) {
      assert.equal(summary[key].triggered, false, `${key} should be false`);
      assert.ok(summary[key].evidence && summary[key].evidence.length > 0, `${key} should have evidence string`);
    }
  });

  it("stage2 completed confirms zotero_backend_writeback triggered", () => {
    const stages = [
      { name: "stage1", status: "completed" },
      { name: "zotero_backend_ready", status: "completed" },
      { name: "stage2_writeback", status: "completed" },
      { name: "stage3_translation", status: "completed" },
      { name: "stage4_exports", status: "completed" },
    ];
    const summary = buildExternalCallSummary(stages);
    assert.equal(summary.zotero_backend_writeback.triggered, true);
    assert.equal(summary.file_exports.triggered, true);
    assert.equal(summary.llm_semantic_review.triggered, "unknown");
    assert.equal(summary.translation_api.triggered, "unknown");
  });

  it("stage1 completed, later stages skipped still shows unknown for stage1 categories", () => {
    const stages = [
      { name: "stage1", status: "completed" },
      { name: "zotero_backend_ready", status: "skipped", skipReason: "stage1_failed" },
      { name: "stage2_writeback", status: "skipped", skipReason: "stage1_failed" },
      { name: "stage3_translation", status: "skipped", skipReason: "stage1_failed" },
      { name: "stage4_exports", status: "skipped", skipReason: "stage1_failed" },
    ];
    const summary = buildExternalCallSummary(stages);
    assert.equal(summary.zotero_backend_writeback.triggered, false);
    assert.equal(summary.file_exports.triggered, false);
    assert.equal(summary.llm_semantic_review.triggered, "unknown");
    assert.equal(summary.ncbi_pubmed_pmc.triggered, "unknown");
  });

  it("stage4 completed confirms file_exports triggered", () => {
    const stages = [
      { name: "stage1", status: "completed" },
      { name: "zotero_backend_ready", status: "completed" },
      { name: "stage2_writeback", status: "completed" },
      { name: "stage3_translation", status: "completed" },
      { name: "stage4_exports", status: "completed" },
    ];
    const summary = buildExternalCallSummary(stages);
    assert.equal(summary.file_exports.triggered, true);
    assert.equal(summary.file_exports.evidence, "stage4_exports: completed");
  });

  it("evidence includes skipReason for skipped stages", () => {
    const stages = [
      { name: "stage1", status: "skipped", skipReason: "interval_not_reached" },
      { name: "zotero_backend_ready", status: "skipped", skipReason: "interval_not_reached" },
      { name: "stage2_writeback", status: "skipped", skipReason: "interval_not_reached" },
    ];
    const summary = buildExternalCallSummary(stages);
    assert.match(summary.llm_semantic_review.evidence, /interval_not_reached/);
    assert.match(summary.zotero_backend_writeback.evidence, /interval_not_reached/);
  });

  it("all categories have required fields", () => {
    const stages = [{ name: "stage1", status: "completed" }];
    const summary = buildExternalCallSummary(stages);
    for (const [key, cat] of Object.entries(summary)) {
      assert.ok(cat.possible !== undefined, `${key} should have possible`);
      assert.ok(cat.triggered !== undefined, `${key} should have triggered`);
      assert.ok(cat.risk !== undefined, `${key} should have risk`);
      assert.ok(cat.evidence !== undefined, `${key} should have evidence`);
    }
  });
});
// ── Tests: workflowStatusToExitCode ──────────────────────────────────────────

describe("workflowStatusToExitCode", () => {
  it("completed → 0", () => assert.equal(workflowStatusToExitCode("completed"), 0));
  it("completed_stage1_only → 0", () => assert.equal(workflowStatusToExitCode("completed_stage1_only"), 0));
  it("degraded_due_to_zotero_backend_unavailable → 0", () => assert.equal(workflowStatusToExitCode("degraded_due_to_zotero_backend_unavailable"), 0));
  it("skipped → 0", () => assert.equal(workflowStatusToExitCode("skipped"), 0));
  it("completed_with_warnings → 1", () => assert.equal(workflowStatusToExitCode("completed_with_warnings"), 1));
  it("failed_stage1 → 1", () => assert.equal(workflowStatusToExitCode("failed_stage1"), 1));
  it("failed_stage2_writeback → 1", () => assert.equal(workflowStatusToExitCode("failed_stage2_writeback"), 1));
  it("failed_stage3_translation → 1", () => assert.equal(workflowStatusToExitCode("failed_stage3_translation"), 1));
  it("failed_stage4_export → 1", () => assert.equal(workflowStatusToExitCode("failed_stage4_export"), 1));
  it("failed_due_to_config_or_dependency → 1", () => assert.equal(workflowStatusToExitCode("failed_due_to_config_or_dependency"), 1));
});

// ── Tests: WORKFLOW_STATUS constants ─────────────────────────────────────────

describe("WORKFLOW_STATUS", () => {
  it("should have all expected status values", () => {
    assert.equal(WORKFLOW_STATUS.COMPLETED, "completed");
    assert.equal(WORKFLOW_STATUS.COMPLETED_WITH_WARNINGS, "completed_with_warnings");
    assert.equal(WORKFLOW_STATUS.COMPLETED_STAGE1_ONLY, "completed_stage1_only");
    assert.equal(WORKFLOW_STATUS.DEGRADED_DUE_TO_ZOTERO_BACKEND_UNAVAILABLE, "degraded_due_to_zotero_backend_unavailable");
    assert.equal(WORKFLOW_STATUS.SKIPPED_DUE_TO_INTERVAL, "skipped_due_to_interval");
    assert.equal(WORKFLOW_STATUS.FAILED_STAGE1, "failed_stage1");
    assert.equal(WORKFLOW_STATUS.FAILED_STAGE2_WRITEBACK, "failed_stage2_writeback");
    assert.equal(WORKFLOW_STATUS.FAILED_STAGE3_TRANSLATION, "failed_stage3_translation");
    assert.equal(WORKFLOW_STATUS.FAILED_STAGE4_EXPORT, "failed_stage4_export");
    assert.equal(WORKFLOW_STATUS.FAILED_DUE_TO_CONFIG_OR_DEPENDENCY, "failed_due_to_config_or_dependency");
  });

  it("should be frozen", () => {
    assert.throws(() => { WORKFLOW_STATUS.COMPLETED = "changed"; }, TypeError);
  });
});
