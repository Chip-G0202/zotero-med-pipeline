import assert from "node:assert/strict";
import test from "node:test";

import { createStage2ItemWriter, runWritebackExecution } from "../../workflow/tools/stage2/writeback_execution.mjs";

function emptyIndex() {
  return { byDoi: new Map(), byPmid: new Map(), byPmcid: new Map(), byArxiv: new Map(), byTitle: new Map(), meta: new Map() };
}

async function run(count, { batchSize, persist = async () => {}, createItems } = {}) {
  const previous = process.env.ZOTERO_CLI_WRITEBACK_BATCH_SIZE;
  if (batchSize === undefined) delete process.env.ZOTERO_CLI_WRITEBACK_BATCH_SIZE;
  else process.env.ZOTERO_CLI_WRITEBACK_BATCH_SIZE = String(batchSize);
  const calls = [];
  const backend = {
    backendType: "cli",
    createItems: createItems || (async (items) => {
      calls.push(items.map(({ inputIndex }) => inputIndex));
      return { created: items.map(({ inputIndex }) => ({ inputIndex, itemKey: `K${inputIndex}` })), failed: [] };
    }),
  };
  const createItem = createStage2ItemWriter({ zoteroBackend: backend, onCreatedKeys: persist });
  const counters = { created: 0, failed: 0, by_source: {}, by_grade: {}, reused_existing: 0, skipped_historical_duplicate: 0, skipped_duplicate_in_pool: 0, skipped_duplicate_in_trash: 0, skipped_duplicate_in_deleted_trash_index: 0, skipped_duplicate_in_worthy: 0 };
  try {
    const result = await runWritebackExecution({
      items: Array.from({ length: count }, (_, index) => ({ title: `Unique ${index}`, dedupe_key: `D${index}`, source_channel: "rss", grade: "A", final_grade: "A", journal: "Fixture" })),
      root: { key: "ROOT" }, sourceKeys: { "RSS订阅": "SRC" }, gradeKeys: { "A课题相关": "GRADE" }, sourceCollections: { rss: "RSS订阅" },
      poolIndex: emptyIndex(), trashIndex: emptyIndex(), worthyIndex: emptyIndex(), currentLiveItems: {}, counters, failures: [], localIndexStats: { skipped_duplicate_in_deleted_trash_index: 0 }, skippedDuplicatesInPool: [], skippedDuplicatesInTrash: [], duplicateRecords: [], writebackItems: [],
      zoteroBackend: backend, createItem, skipBackendExactDedupe: true,
    });
    return { calls, counters, result };
  } finally {
    if (previous === undefined) delete process.env.ZOTERO_CLI_WRITEBACK_BATCH_SIZE;
    else process.env.ZOTERO_CLI_WRITEBACK_BATCH_SIZE = previous;
  }
}

test("Desktop fast path partitions 1, 20, 50, 51, and 241 deterministically", async () => {
  for (const [count, expected] of [[1, [1]], [20, [20]], [50, [50]], [51, [50, 1]], [241, [50, 50, 50, 50, 41]]]) {
    const result = await run(count);
    assert.deepEqual(result.calls.map((batch) => batch.length), expected);
    assert.equal(result.counters.created, count);
    assert.equal(result.counters.failed, 0);
  }
});

test("Desktop batch-size config defaults and clamps safely", async () => {
  assert.deepEqual((await run(51, { batchSize: 0 })).calls.map((batch) => batch.length), [50, 1]);
  assert.deepEqual((await run(51, { batchSize: "bad" })).calls.map((batch) => batch.length), [50, 1]);
  assert.deepEqual((await run(51, { batchSize: 999 })).calls.map((batch) => batch.length), [50, 1]);
  assert.deepEqual((await run(20, { batchSize: 7 })).calls.map((batch) => batch.length), [7, 7, 6]);
});

test("next Desktop batch waits for recovery and recovery failure stops later batches", async () => {
  const events = [];
  await run(51, { persist: async (keys) => { events.push(`persist:${keys.length}`); } , createItems: async (items) => { events.push(`create:${items.length}`); return { created: items.map(({ inputIndex }) => ({ inputIndex, itemKey: `K${inputIndex}` })), failed: [] }; } });
  assert.deepEqual(events, ["create:50", "persist:50", "create:1", "persist:1"]);
  let creates = 0;
  const failed = await run(51, { persist: async () => { throw new Error("recovery_failed"); }, createItems: async (items) => { creates += 1; return { created: items.map(({ inputIndex }) => ({ inputIndex, itemKey: `K${inputIndex}` })), failed: [] }; } });
  assert.equal(creates, 1);
  assert.equal(failed.result.stopForHighRisk, true);
});

test("partial Desktop batch persists successes without serial fallback", async () => {
  const persisted = [];
  const result = await run(3, {
    persist: async (keys) => persisted.push(...keys),
    createItems: async (items) => ({
      created: items.slice(0, 2).map(({ inputIndex }) => ({ inputIndex, itemKey: `K${inputIndex}` })),
      failed: [{ inputIndex: items[2].inputIndex, error: "fixture_failure" }],
    }),
  });
  assert.deepEqual(persisted, ["K0", "K1"]);
  assert.equal(result.counters.created, 2);
  assert.equal(result.counters.failed, 1);
  assert.equal(result.result.batchCreateStats.batch_create_fallback_count, 0);
});

test("empty Desktop input does not create a batch", async () => {
  const result = await run(0);
  assert.deepEqual(result.calls, []);
  assert.equal(result.counters.created, 0);
});
