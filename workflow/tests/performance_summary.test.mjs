import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkflowPerformanceSummary,
  formatWorkflowPerformanceTopSummary,
} from "../tools/stage0/performance_summary.mjs";

test("buildWorkflowPerformanceSummary merges stage and artifact timing into top summary", () => {
  const summary = buildWorkflowPerformanceSummary({
    runContext: { runId: "zlf-test", pipelineDir: "review_results/pipeline/26.7.8" },
    stages: [
      { name: "stage1", durationMs: 1000, status: "completed", exitCode: 0, command: "node stage1" },
      { name: "stage2_writeback", durationMs: 500, status: "completed", exitCode: 0, command: "node stage2" },
    ],
    timingDiagnostics: {
      stage_timings: {
        llm_grade_review: {
          status: "completed",
          ms: 300,
          items_reviewed: 20,
          total_request_attempts: 2,
          avg_batch_duration_ms: 150,
          max_batch_duration_ms: 180,
        },
      },
    },
    writebackSummary: {
      root_pool_attach_disabled: true,
      new_items_added_to_root_pool: false,
      dedupe_depends_on_root_pool_membership: false,
      counters: {
        created: 3,
        failed: 0,
        added_to_pool: 0,
        added_to_daily_collection: 3,
      },
      run_stats: {
        collection_setup_ms: 40,
        item_writeback_ms: 50,
        collection_attach_duration: 60,
        collection_attach_calls: 2,
        collection_attach_batch_size: 50,
        fallback_to_per_item_count: 0,
        mcp_calls_by_tool: { write_item: 3, add_items_to_collection: 2 },
        local_zotero_index: { local_zotero_index_used: true },
      },
      local_zotero_index: { local_zotero_index_used: true },
    },
    translationBackfill: {
      total: 3,
      timings: {
        total_ms: 70,
        translation_request_ms: 10,
        metadata_write_ms: 500,
        local_index_update_ms: 5,
      },
      translation_summary: {
        api_translation_attempted_count: 1,
        zotero_updates_attempted_count: 3,
      },
      local_zotero_index_update: { updated_count: 3 },
    },
  });

  assert.equal(summary.run_id, "zlf-test");
  assert.equal(summary.total_duration_ms, 1500);
  assert.equal(summary.totals.zotero_backend_call_count, 5);
  assert.equal(summary.totals.collection_attach_calls, 2);
  assert.equal(summary.totals.fallback_to_per_item_count, 0);
  assert.equal(summary.totals.added_to_root_pool, 0);
  assert.equal(summary.totals.added_to_daily_collections, 3);
  assert.equal(summary.assertions.root_pool_attach_disabled, true);
  assert.equal(summary.assertions.new_items_added_to_root_pool, false);
  assert.equal(summary.assertions.dedupe_depends_on_root_pool_membership, false);
  assert.equal(summary.assertions.local_zotero_index_used, true);
  assert.equal(summary.top_summary[0].name, "stage.stage1");
  assert.ok(summary.performance_diagnosis.length > 0);
  const attachDiagnosis = summary.performance_diagnosis.find((row) => row.module_substep_function === "stage2.collection_attach");
  assert.equal(attachDiagnosis.primary_cost_source, "Zotero collection attach calls");
  assert.equal(attachDiagnosis.implemented_this_round, true);
  assert.equal("suspected_cause" in attachDiagnosis, true);
  assert.equal("proposed_optimization" in attachDiagnosis, true);
  assert.equal("risk_level" in attachDiagnosis, true);
  assert.ok(summary.spans.some((span) => span.name === "stage2.collection_attach"));
  const metadataWrite = summary.spans.find((span) => span.name === "stage3.metadata_write");
  assert.equal(metadataWrite.duration_ms, 70);
  assert.equal(metadataWrite.details.cumulative_duration_ms, 500);
  assert.equal(metadataWrite.details.duration_capped_to_stage_wall_time, true);

  const text = formatWorkflowPerformanceTopSummary(summary);
  assert.match(text, /run_id: zlf-test/);
  assert.match(text, /collection_attach_calls: 2/);
  assert.match(text, /diagnosis_top:/);
});
