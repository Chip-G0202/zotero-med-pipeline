import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseFixDirtyPublicationTitlesArgs,
  runFixDirtyPublicationTitles,
} from "../tools/maintenance/fix_dirty_publication_titles.mjs";
import { runGuardedWriteMetadataUpdates } from "../tools/lib/writeback_support.mjs";

function makeMockMcp() {
  const calls = [];
  const collections = [
    {
      key: "POOL",
      name: "文献池",
      parentCollection: false,
      subcollections: [{ key: "DAY", name: "2026-06-30", parentCollection: "POOL" }],
    },
    { key: "WORTHY", name: "值得精读", parentCollection: false },
  ];
  async function mcpCall(tool, args) {
    calls.push({ tool, args });
    if (tool === "get_collections") return collections;
    if (tool === "get_subcollections") {
      if (args.collectionKey === "POOL") return [{ key: "DAY", name: "2026-06-30", parentCollection: "POOL" }];
      return [];
    }
    if (tool === "get_collection_items") {
      if (args.collectionKey === "POOL" && args.offset === 0) {
        return [{ key: "ITEM1", title: "A", publicationTitle: "Wiley: Example Topic", url: "" }];
      }
      return [];
    }
    if (tool === "write_metadata") return { ok: true };
    throw new Error(`unexpected tool: ${tool}`);
  }
  return { calls, mcpCall };
}

const silentLogger = { log() {}, error() {} };

test("fix_dirty_publication_titles defaults to dry-run and does not write metadata", async () => {
  const mock = makeMockMcp();
  const result = await runFixDirtyPublicationTitles({
    argv: [],
    mcpCall: mock.mcpCall,
    inferJournal: async () => "",
    logger: silentLogger,
  });

  assert.equal(result.dry_run, true);
  assert.equal(result.apply, false);
  assert.equal(result.planned_update_count, 1);
  assert.equal(result.write_success_count, 0);
  assert.equal(mock.calls.some((call) => call.tool === "write_metadata"), false);
});

test("fix_dirty_publication_titles writes only when --apply is explicit", async () => {
  const mock = makeMockMcp();
  const result = await runFixDirtyPublicationTitles({
    argv: ["--apply"],
    mcpCall: mock.mcpCall,
    inferJournal: async () => "",
    logger: silentLogger,
  });

  const writes = mock.calls.filter((call) => call.tool === "write_metadata");
  assert.equal(result.dry_run, false);
  assert.equal(result.apply, true);
  assert.equal(result.write_success_count, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].args, { itemKey: "ITEM1", fields: { publicationTitle: "Example Topic" } });
});

test("fix_dirty_publication_titles rejects unknown or ambiguous arguments", () => {
  assert.throws(() => parseFixDirtyPublicationTitlesArgs(["--force"]), /Unknown argument/);
  assert.throws(() => parseFixDirtyPublicationTitlesArgs(["--dry-run", "--apply"]), /ambiguous mode/);
});

test("runGuardedWriteMetadataUpdates defaults to dry-run and does not call writer", async () => {
  let writerCalls = 0;
  const result = await runGuardedWriteMetadataUpdates({
    updates: [{ itemKey: "ITEM1", fields: { publicationTitle: "Example Topic" } }],
    writer: async () => { writerCalls++; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.dry_run, true);
  assert.equal(result.apply, false);
  assert.equal(result.write_success_count, 0);
  assert.equal(result.writer_called, false);
  assert.equal(writerCalls, 0);
});

test("runGuardedWriteMetadataUpdates calls writer only when apply and guard pass", async () => {
  const calls = [];
  const result = await runGuardedWriteMetadataUpdates({
    updates: [{ itemKey: "ITEM1", newPub: "Example Topic" }],
    apply: true,
    dryRun: false,
    allowedItemKeys: new Set(["ITEM1"]),
    fieldsForUpdate: (u) => ({ publicationTitle: u.newPub }),
    writer: async ({ itemKey, fields }) => calls.push({ itemKey, fields }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.write_success_count, 1);
  assert.equal(result.write_failure_count, 0);
  assert.deepEqual(calls, [{ itemKey: "ITEM1", fields: { publicationTitle: "Example Topic" } }]);
});

test("runGuardedWriteMetadataUpdates blocks writes when guard fails", async () => {
  let writerCalls = 0;
  const result = await runGuardedWriteMetadataUpdates({
    updates: [{ itemKey: "ITEM1", fields: { publicationTitle: "Example Topic" } }],
    apply: true,
    dryRun: false,
    guardReady: false,
    guardBlockedReason: "collection_guard_not_ready:test",
    writer: async () => { writerCalls++; },
  });

  assert.equal(result.ok, false);
  assert.equal(result.guard_blocked_count, 1);
  assert.equal(result.write_success_count, 0);
  assert.equal(result.write_failure_count, 1);
  assert.equal(result.writer_called, false);
  assert.equal(writerCalls, 0);
  assert.match(result.write_failures[0].error, /collection_guard_not_ready/);
});

test("runGuardedWriteMetadataUpdates reports partial writer failures", async () => {
  const result = await runGuardedWriteMetadataUpdates({
    updates: [{ itemKey: "ITEM1" }, { itemKey: "ITEM2" }],
    apply: true,
    dryRun: false,
    allowedItemKeys: new Set(["ITEM1", "ITEM2"]),
    writer: async ({ itemKey }) => {
      if (itemKey === "ITEM2") throw new Error("mock write failed");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.write_success_count, 1);
  assert.equal(result.write_failure_count, 1);
  assert.equal(result.write_failures.length, 1);
  assert.equal(result.write_failures[0].itemKey, "ITEM2");
  assert.match(result.write_failures[0].error, /mock write failed/);
});
