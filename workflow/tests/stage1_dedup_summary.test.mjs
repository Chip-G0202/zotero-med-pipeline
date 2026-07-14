import assert from "node:assert/strict";
import test from "node:test";
import { buildStage1DedupSummary } from "../tools/stage1/dedup_summary.mjs";

function sampleItems(n, prefix = "item") {
  return Array.from({ length: n }, (_, i) => ({
    title: `${prefix} ${i + 1}`,
    doi: `10.1000/${prefix}${i + 1}`,
    source: "test",
  }));
}

test("buildStage1DedupSummary — normal dedup with duplicates", () => {
  const input = sampleItems(10);
  const deduped = input.slice(0, 7);
  const diagnostics = {
    fetched_count: 10,
    deduped_count: 7,
    duplicate_removed_count: 3,
    skipped_by_key_type: { doi: 2, url: 1 },
  };

  const summary = buildStage1DedupSummary({
    inputItems: input,
    dedupedItems: deduped,
    dedupDiagnostics: diagnostics,
  });

  assert.equal(summary.input_items_count, 10);
  assert.equal(summary.deduped_items_count, 7);
  assert.equal(summary.duplicates_removed_count, 3);
  assert.equal(summary.dedup_applied, true);
  assert.equal(summary.dedup_key_strategy, "existing");
  assert.equal(summary.deduced_from_input_arrays, false);
  assert.deepEqual(summary.skipped_by_key_type, { doi: 2, url: 1 });
  assert.equal(summary.used_for_llm_review, true);
  assert.equal(summary.used_for_writeback_ready, true);
  assert.ok(Array.isArray(summary.notes) && summary.notes.length > 0);
});

test("buildStage1DedupSummary — no duplicates", () => {
  const input = sampleItems(5);
  const deduped = input;
  const diagnostics = {
    fetched_count: 5,
    deduped_count: 5,
    duplicate_removed_count: 0,
    skipped_by_key_type: {},
  };

  const summary = buildStage1DedupSummary({
    inputItems: input,
    dedupedItems: deduped,
    dedupDiagnostics: diagnostics,
  });

  assert.equal(summary.input_items_count, 5);
  assert.equal(summary.deduped_items_count, 5);
  assert.equal(summary.duplicates_removed_count, 0);
  assert.deepEqual(summary.skipped_by_key_type, {});
  assert.equal(summary.deduced_from_input_arrays, false);
});

test("buildStage1DedupSummary — all duplicates (empty deduped set)", () => {
  const input = sampleItems(3);
  const deduped = [];
  const diagnostics = {
    fetched_count: 3,
    deduped_count: 0,
    duplicate_removed_count: 3,
    skipped_by_key_type: { doi: 3 },
  };

  const summary = buildStage1DedupSummary({
    inputItems: input,
    dedupedItems: deduped,
    dedupDiagnostics: diagnostics,
  });

  assert.equal(summary.input_items_count, 3);
  assert.equal(summary.deduped_items_count, 0);
  assert.equal(summary.duplicates_removed_count, 3);
});

test("buildStage1DedupSummary — deduces counts from input arrays when diagnostics missing", () => {
  const input = sampleItems(8);
  const deduped = input.slice(0, 6);

  const summary = buildStage1DedupSummary({
    inputItems: input,
    dedupedItems: deduped,
    dedupDiagnostics: {},
  });

  assert.equal(summary.input_items_count, 8);
  assert.equal(summary.deduped_items_count, 6);
  assert.equal(summary.duplicates_removed_count, 2);
  assert.equal(summary.deduced_from_input_arrays, true);
});

test("buildStage1DedupSummary — empty inputs", () => {
  const summary = buildStage1DedupSummary({});

  assert.equal(summary.input_items_count, 0);
  assert.equal(summary.deduped_items_count, 0);
  assert.equal(summary.duplicates_removed_count, 0);
  assert.deepEqual(summary.skipped_by_key_type, {});
  assert.equal(summary.deduced_from_input_arrays, true); // no diagnostics means deduced from arrays
});

test("buildStage1DedupSummary — custom dedupKeyStrategy", () => {
  const summary = buildStage1DedupSummary({
    inputItems: sampleItems(2),
    dedupedItems: sampleItems(2),
    dedupDiagnostics: { fetched_count: 2, deduped_count: 2, duplicate_removed_count: 0 },
    dedupKeyStrategy: "doi > pmid > title",
  });

  assert.equal(summary.dedup_key_strategy, "doi > pmid > title");
});

test("buildStage1DedupSummary — does not modify its inputs", () => {
  const inputParams = {
    inputItems: sampleItems(4),
    dedupedItems: sampleItems(4),
    dedupDiagnostics: { fetched_count: 4, deduped_count: 4, duplicate_removed_count: 0 },
  };
  const frozen = JSON.parse(JSON.stringify(inputParams));

  buildStage1DedupSummary(inputParams);

  assert.deepEqual(inputParams, frozen);
});

test("buildStage1DedupSummary — filters non-number skipped_by_key_type values", () => {
  const diagnostics = {
    fetched_count: 3,
    deduped_count: 2,
    duplicate_removed_count: 1,
    skipped_by_key_type: { doi: 1, title: "invalid", url: null, pmid: 0 },
  };

  const summary = buildStage1DedupSummary({
    inputItems: sampleItems(3),
    dedupedItems: sampleItems(2),
    dedupDiagnostics: diagnostics,
  });

  assert.deepEqual(summary.skipped_by_key_type, { doi: 1, pmid: 0 });
});

test("buildStage1DedupSummary — report-compatible: downstream fields indicate correct set", () => {
  const summary = buildStage1DedupSummary({
    inputItems: sampleItems(5),
    dedupedItems: sampleItems(4),
    dedupDiagnostics: { fetched_count: 5, deduped_count: 4, duplicate_removed_count: 1 },
  });

  assert.equal(summary.used_for_llm_review, true);
  assert.equal(summary.used_for_writeback_ready, true);
  assert.ok(summary.downstream_collection.includes("merged"));
  assert.ok(summary.downstream_collection.includes("triagedAll"));
  assert.ok(summary.downstream_collection.includes("LLM review"));
  assert.ok(summary.downstream_collection.includes("writeback ready"));
});
