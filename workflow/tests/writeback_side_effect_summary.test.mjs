import assert from "node:assert/strict";
import test from "node:test";

import { buildWritebackSideEffectSummary } from "../tools/stage2/main.mjs";

test("writeback side effect summary reports complete success counts", () => {
  const summary = buildWritebackSideEffectSummary({
    itemsPlannedCount: 2,
    counters: {
      total: 2,
      created: 2,
      failed: 0,
      added_to_pool: 2,
      added_to_daily_collection: 2,
    },
    failures: [],
    mcpReady: true,
    collectionKeys: ["pool", "trash", "worthy", "month", "day", "rss", "a"],
    mcpCallsByTool: { create_collection: 3 },
    tagCleanupStats: { cleaned_items: 1 },
  });

  assert.equal(summary.execution_status, "complete_success");
  assert.equal(summary.items_planned_count, 2);
  assert.equal(summary.items_attempted_count, 2);
  assert.equal(summary.items_succeeded_count, 2);
  assert.equal(summary.items_failed_count, 0);
  assert.equal(summary.partial_success, false);
  assert.equal(summary.collections_created_count, 3);
  assert.equal(summary.collections_used_count, 7);
  assert.equal(summary.items_added_to_collections_count, 2);
  assert.equal(summary.short_title_updates_count, 0);
  assert.equal(summary.tag_updates_count, 3);
  assert.equal(summary.note_updates_count, 0);
  assert.equal(summary.field_updates_count, 2);
  assert.deepEqual(summary.failure_reasons, {});
  assert.equal(summary.external_write_performed, true);
  assert.equal(summary.correctness.ok, true);
  assert.equal(summary.correctness.root_pool_count, 0);
});

test("writeback side effect summary reports partial success without full error logs", () => {
  const summary = buildWritebackSideEffectSummary({
    itemsPlannedCount: 2,
    counters: {
      total: 2,
      created: 1,
      failed: 1,
      added_to_pool: 1,
      added_to_daily_collection: 1,
    },
    failures: [
      { idx: 1, error: 'MCP write_item failed: {"code":-32700,"message":"Parse error with long noisy details"}' },
    ],
    mcpReady: true,
    collectionKeys: ["pool", "rss", "a"],
    mcpCallsByTool: { create_collection: 0 },
  });

  assert.equal(summary.execution_status, "partial_success");
  assert.equal(summary.items_succeeded_count, 1);
  assert.equal(summary.items_failed_count, 1);
  assert.equal(summary.partial_success, true);
  assert.deepEqual(summary.failure_reasons, { zotero_backend_error: 1 });
  assert.equal(JSON.stringify(summary).includes("long noisy details"), false);
});

test("writeback side effect summary reports complete failure", () => {
  const summary = buildWritebackSideEffectSummary({
    itemsPlannedCount: 2,
    counters: {
      total: 2,
      created: 0,
      failed: 2,
    },
    failures: [
      { error: "validation_error: missing title" },
      { error: "create_item_no_key" },
    ],
    mcpReady: true,
    mcpCallsByTool: { create_collection: 0 },
  });

  assert.equal(summary.execution_status, "complete_failure");
  assert.equal(summary.items_attempted_count, 2);
  assert.equal(summary.items_succeeded_count, 0);
  assert.equal(summary.items_failed_count, 2);
  assert.equal(summary.partial_success, false);
  assert.deepEqual(summary.failure_reasons, { validation_error: 2 });
});

test("writeback side effect summary marks dry run as no external write", () => {
  const summary = buildWritebackSideEffectSummary({
    itemsPlannedCount: 2,
    counters: {
      total: 2,
      created: 0,
      failed: 0,
    },
    dryRun: true,
    mcpReady: true,
    mcpCallsByTool: { create_collection: 0 },
  });

  assert.equal(summary.execution_status, "dry_run");
  assert.equal(summary.dry_run, true);
  assert.equal(summary.items_planned_count, 2);
  assert.equal(summary.items_attempted_count, 0);
  assert.equal(summary.items_succeeded_count, 0);
  assert.equal(summary.external_write_performed, false);
});

test("writeback side effect summary marks MCP unavailable as not executed", () => {
  const summary = buildWritebackSideEffectSummary({
    itemsPlannedCount: 3,
    counters: {
      total: 3,
      created: 0,
      failed: 0,
    },
    mcpReady: false,
    failureReason: "MCP_NOT_READY_AFTER_EXTERNAL_LAUNCHER",
    mcpCallsByTool: { get_collections: 1 },
  });

  assert.equal(summary.execution_status, "not_executed_zotero_backend_unavailable");
  assert.equal(summary.zotero_backend_ready, false);
  assert.equal(summary.items_attempted_count, 0);
  assert.equal(summary.items_succeeded_count, 0);
  assert.equal(summary.external_write_performed, false);
  assert.deepEqual(summary.failure_reasons, { zotero_backend_unavailable: 1 });
});
