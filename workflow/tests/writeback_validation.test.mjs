import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCleanupValidationSummary,
  buildWritebackValidationSummary,
} from "../tools/validation/writeback_validation.mjs";

test("writeback validation summarizes Desktop-like complete result", () => {
  const summary = buildWritebackValidationSummary({
    backendSelected: "cli",
    desktopLaunched: true,
    counters: { created: 2, failed: 0 },
    attachStats: { source_added_count: 2, grade_added_count: 2 },
    rootPoolNewItemCount: 0,
    shortTitle: { expected: 2, updated: 2, skipped: 0, verified: 2 },
    runMarker: { expected: 2, verified: 2 },
    localIndexResidual: 0,
    backendResidual: 0,
    cleanupResidual: 0,
    requestStats: { logicalItemCount: 2, requestCount: 1 },
    backendDetails: { jsBridge: true },
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.backend_selected, "cli");
  assert.equal(summary.desktop_launched, true);
  assert.equal(summary.created_count, 2);
  assert.equal(summary.source_collection_correct, true);
  assert.equal(summary.grade_collection_correct, true);
  assert.equal(summary.root_pool_count, 0);
  assert.equal(summary.shortTitle.verified, 2);
  assert.deepEqual(summary.backendDetails, { jsBridge: true });
});

test("writeback validation summarizes Web-like complete result without Desktop", () => {
  const summary = buildWritebackValidationSummary({
    backendSelected: "web_api",
    desktopLaunched: false,
    counters: { created: 3, failed: 0 },
    attachStats: { source_added_count: 3, grade_added_count: 3 },
    rootPoolNewItemCount: 0,
    shortTitle: { expected: 3, updated: 3, verified: 3 },
    runMarker: { expected: 3, verified: 3 },
    cleanupResidual: 0,
    requestStats: { logicalItemCount: 3, requestCount: 4 },
    backendDetails: { rateLimitCount: 0 },
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.backend_selected, "web_api");
  assert.equal(summary.desktop_launched, false);
  assert.equal(summary.request_stats.logical_item_count, 3);
  assert.equal(summary.request_stats.request_count, 4);
});

test("writeback validation flags root pool violations", () => {
  const summary = buildWritebackValidationSummary({
    counters: { created: 1, failed: 0 },
    attachStats: { source_added_count: 1, grade_added_count: 1 },
    rootPoolNewItemCount: 1,
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.root_pool_count, 1);
  assert.ok(summary.violations.includes("root_pool_new_item_count_nonzero"));
});

test("writeback validation flags shortTitle partial failure", () => {
  const summary = buildWritebackValidationSummary({
    counters: { created: 2, failed: 0 },
    attachStats: { source_added_count: 2, grade_added_count: 2 },
    rootPoolNewItemCount: 0,
    shortTitle: { expected: 2, updated: 1, verified: 1 },
  });

  assert.equal(summary.ok, false);
  assert.deepEqual(summary.shortTitle, { expected: 2, updated: 1, skipped: 0, verified: 1 });
  assert.ok(summary.violations.includes("shortTitle_verified_below_expected"));
});

test("cleanup validation flags nonzero residual", () => {
  const summary = buildCleanupValidationSummary({
    itemResidual: 1,
    collectionResidual: 0,
    localIndexResidual: 0,
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.residual_count, 1);
  assert.ok(summary.violations.includes("cleanup_residual_nonzero"));
});
