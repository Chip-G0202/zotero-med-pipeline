import assert from "node:assert/strict";
import test from "node:test";
import { buildStage1SourceSummary } from "../tools/stage1/source_summary.mjs";

test("buildStage1SourceSummary — multi-source normal collection", () => {
  const summary = buildStage1SourceSummary({
    sources: [
      { name: "rss", enabled: true, triggered: true, itemsCollectedCount: 15, enteredPreDedupCollection: true, skippedReason: null, failureReason: null, degraded: false, warningsCount: 0 },
      { name: "pubmed_pmc", enabled: true, triggered: true, itemsCollectedCount: 30, enteredPreDedupCollection: true, skippedReason: null, failureReason: null, degraded: false, warningsCount: 0 },
    ],
    preDedupItemsCount: 45,
  });

  assert.equal(summary.sources_count, 2);
  assert.equal(summary.enabled_sources_count, 2);
  assert.equal(summary.triggered_sources_count, 2);
  assert.equal(summary.succeeded_sources_count, 2);
  assert.equal(summary.failed_sources_count, 0);
  assert.equal(summary.degraded, false);
  assert.equal(summary.total_collected_items_count, 45);
  assert.equal(summary.pre_dedup_items_count, 45);
  assert.deepEqual(summary.failure_reasons, []);
  assert.deepEqual(summary.degraded_reasons, []);
  assert.equal(summary.sources.length, 2);
  assert.equal(summary.sources[0].name, "rss");
  assert.equal(summary.sources[1].name, "pubmed_pmc");
});

test("buildStage1SourceSummary — disabled source", () => {
  const summary = buildStage1SourceSummary({
    sources: [
      { name: "rss", enabled: false, triggered: false, itemsCollectedCount: 0, enteredPreDedupCollection: false, skippedReason: "disabled", failureReason: null, degraded: false, warningsCount: 0 },
      { name: "pubmed_pmc", enabled: true, triggered: true, itemsCollectedCount: 10, enteredPreDedupCollection: true, skippedReason: null, failureReason: null, degraded: false, warningsCount: 2 },
    ],
    preDedupItemsCount: 10,
  });

  assert.equal(summary.sources_count, 2);
  assert.equal(summary.enabled_sources_count, 1);
  assert.equal(summary.triggered_sources_count, 1);
  assert.equal(summary.total_collected_items_count, 10);
  assert.equal(summary.degraded, false);
  // Disabled source should have skipped_reason
  assert.equal(summary.sources[0].skipped_reason, "disabled");
  assert.equal(summary.sources[0].enabled, false);
  assert.equal(summary.sources[0].triggered, false);
  assert.equal(summary.sources[0].items_collected_count, 0);
});

test("buildStage1SourceSummary — failed source, degraded continues", () => {
  const summary = buildStage1SourceSummary({
    sources: [
      { name: "rss", enabled: true, triggered: true, itemsCollectedCount: 5, enteredPreDedupCollection: true, skippedReason: null, failureReason: "network_timeout", degraded: true, warningsCount: 1 },
      { name: "pubmed_pmc", enabled: true, triggered: true, itemsCollectedCount: 0, enteredPreDedupCollection: false, skippedReason: null, failureReason: "esearch_parse_error", degraded: true, warningsCount: 3 },
    ],
    preDedupItemsCount: 5,
  });

  assert.equal(summary.sources_count, 2);
  assert.equal(summary.succeeded_sources_count, 0);
  assert.equal(summary.failed_sources_count, 2);
  assert.equal(summary.degraded, true);
  assert.equal(summary.total_collected_items_count, 5);
  assert.equal(summary.failure_reasons.length, 2);
  assert.equal(summary.failure_reasons[0].source, "rss");
  assert.equal(summary.failure_reasons[0].reason, "network_timeout");
  assert.equal(summary.degraded_reasons.length, 2);
});

test("buildStage1SourceSummary — no items source", () => {
  const summary = buildStage1SourceSummary({
    sources: [
      { name: "rss", enabled: true, triggered: true, itemsCollectedCount: 0, enteredPreDedupCollection: false, skippedReason: "no_items", failureReason: null, degraded: false, warningsCount: 0 },
    ],
    preDedupItemsCount: 0,
  });

  assert.equal(summary.total_collected_items_count, 0);
  assert.equal(summary.failed_sources_count, 0);
  assert.equal(summary.degraded, false);
  assert.equal(summary.sources[0].skipped_reason, "no_items");
  assert.equal(summary.sources[0].items_collected_count, 0);
  assert.equal(summary.sources[0].failure_reason, null);
});

test("buildStage1SourceSummary — empty sources", () => {
  const summary = buildStage1SourceSummary({});

  assert.equal(summary.sources_count, 0);
  assert.equal(summary.enabled_sources_count, 0);
  assert.equal(summary.total_collected_items_count, 0);
  assert.equal(summary.pre_dedup_items_count, 0);
  assert.deepEqual(summary.sources, []);
  assert.deepEqual(summary.failure_reasons, []);
  assert.equal(summary.degraded, false);
});

test("buildStage1SourceSummary — does not modify its inputs", () => {
  const inputParams = {
    sources: [
      { name: "rss", enabled: true, triggered: true, itemsCollectedCount: 3, enteredPreDedupCollection: true, skippedReason: null, failureReason: null, degraded: false, warningsCount: 0 },
    ],
    preDedupItemsCount: 3,
  };
  const frozen = JSON.parse(JSON.stringify(inputParams));

  buildStage1SourceSummary(inputParams);

  assert.deepEqual(inputParams, frozen);
});

test("buildStage1SourceSummary — handles unknown/missing fields gracefully", () => {
  const summary = buildStage1SourceSummary({
    sources: [
      { name: "rss", enabled: "unknown", triggered: "unknown", itemsCollectedCount: undefined, enteredPreDedupCollection: "unknown", skippedReason: null, failureReason: null, degraded: false, warningsCount: undefined },
    ],
  });

  assert.equal(summary.sources[0].items_collected_count, 0);
  assert.equal(summary.total_collected_items_count, 0);
  assert.equal(summary.sources[0].warnings_count, 0);
});

test("buildStage1SourceSummary — report-compatible: pre-dedup count matches total collected", () => {
  const summary = buildStage1SourceSummary({
    sources: [
      { name: "rss", enabled: true, triggered: true, itemsCollectedCount: 8, enteredPreDedupCollection: true, skippedReason: null, failureReason: null, degraded: false, warningsCount: 0 },
      { name: "pubmed_pmc", enabled: true, triggered: true, itemsCollectedCount: 12, enteredPreDedupCollection: true, skippedReason: null, failureReason: null, degraded: false, warningsCount: 0 },
    ],
    preDedupItemsCount: 20,
  });

  assert.equal(summary.total_collected_items_count, 20);
  assert.equal(summary.pre_dedup_items_count, 20);
  assert.equal(summary.degraded, false);
  assert.ok(Array.isArray(summary.notes) && summary.notes.length > 0);
});

test("buildStage1SourceSummary — partial failure with one source ok", () => {
  const summary = buildStage1SourceSummary({
    sources: [
      { name: "rss", enabled: true, triggered: true, itemsCollectedCount: 10, enteredPreDedupCollection: true, skippedReason: null, failureReason: null, degraded: false, warningsCount: 0 },
      { name: "pubmed_pmc", enabled: true, triggered: true, itemsCollectedCount: 0, enteredPreDedupCollection: false, skippedReason: null, failureReason: "ncbi_eutils_timeout", degraded: true, warningsCount: 5 },
    ],
    preDedupItemsCount: 10,
  });

  assert.equal(summary.succeeded_sources_count, 1);
  assert.equal(summary.failed_sources_count, 1);
  assert.equal(summary.degraded, true);
  assert.equal(summary.total_collected_items_count, 10);
  assert.equal(summary.failure_reasons.length, 1);
  assert.equal(summary.degraded_reasons.length, 1);
});
