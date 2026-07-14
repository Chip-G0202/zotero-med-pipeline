import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildZoteroCollectionGuard,
  summarizeCollectionScopeBlocks,
} from "../tools/lib/zotero_collection_guard.mjs";

const managedCollections = [
  {
    key: "POOL",
    name: "文献池",
    parentCollection: false,
    subcollections: [
      {
        key: "DAY",
        name: "2026-06-03",
        parentCollection: "POOL",
        subcollections: [
          { key: "RSS", name: "RSS订阅", parentCollection: "DAY" },
          { key: "A", name: "A课题相关", parentCollection: "DAY" },
        ],
      },
      { key: "TRASH", name: "待删除", parentCollection: "POOL" },
    ],
  },
  { key: "WORTHY", name: "值得精读", parentCollection: false },
  {
    key: "OTHER",
    name: "其他项目",
    parentCollection: false,
    subcollections: [
      { key: "OTHER_A", name: "A课题相关", parentCollection: "OTHER" },
    ],
  },
];

test("allows 文献池 subtree, 文献池/待删除, and top-level 值得精读", () => {
  const guard = buildZoteroCollectionGuard(managedCollections);
  assert.equal(guard.ready, true);
  for (const key of ["POOL", "DAY", "RSS", "A", "TRASH", "WORTHY"]) {
    assert.equal(guard.checkCollectionKey(key, { action: "add_items_to_collection" }).ok, true, key);
  }
});

test("blocks collections outside the managed scope", () => {
  const guard = buildZoteroCollectionGuard(managedCollections);
  const blocked = guard.checkCollectionKey("OTHER_A", { action: "remove_items_from_collection", role: "source" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "collection_out_of_allowed_scope");
});

test("fails closed when managed root is missing", () => {
  const guard = buildZoteroCollectionGuard([{ key: "OTHER", name: "其他项目", parentCollection: false }]);
  assert.equal(guard.ready, false);
  const blocked = guard.checkCollectionKey("OTHER", { action: "add_items_to_collection" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "managed_root_missing");
});

test("fails closed when managed root is ambiguous", () => {
  const guard = buildZoteroCollectionGuard([
    { key: "POOL1", name: "文献池", parentCollection: false },
    { key: "POOL2", name: "文献池", parentCollection: false },
  ]);
  assert.equal(guard.ready, false);
  const blocked = guard.checkCollectionKey("POOL1", { action: "create_collection" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "managed_root_ambiguous");
});

test("blocks top-level 待删除 because trash must live under 文献池", () => {
  const guard = buildZoteroCollectionGuard([
    ...managedCollections,
    { key: "TRASH2", name: "待删除", parentCollection: false },
  ]);
  assert.equal(guard.ready, true);
  assert.equal(guard.checkCollectionKey("TRASH", { action: "add_items_to_collection" }).ok, true);
  const blocked = guard.checkCollectionKey("TRASH2", { action: "add_items_to_collection" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "special_collection_wrong_position");
});

test("blocks 文献池/值得精读 because worthy must be top-level", () => {
  const guard = buildZoteroCollectionGuard([
    ...managedCollections,
    { key: "POOL_WORTHY", name: "值得精读", parentCollection: "POOL" },
  ]);
  assert.equal(guard.ready, true);
  assert.equal(guard.checkCollectionKey("WORTHY", { action: "add_items_to_collection" }).ok, true);
  const blocked = guard.checkCollectionKey("POOL_WORTHY", { action: "add_items_to_collection" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "special_collection_wrong_position");
});

test("fails closed when top-level 值得精读 is ambiguous", () => {
  const guard = buildZoteroCollectionGuard([
    ...managedCollections,
    { key: "WORTHY2", name: "值得精读", parentCollection: false },
  ]);
  assert.equal(guard.ready, true);
  const blocked = guard.checkCollectionKey("WORTHY", { action: "add_items_to_collection" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "special_collection_ambiguous");
});

test("blocks children under top-level 值得精读", () => {
  const guard = buildZoteroCollectionGuard([
    ...managedCollections,
    { key: "WORTHY_CHILD", name: "2026-06-03", parentCollection: "WORTHY" },
  ]);
  assert.equal(guard.ready, true);
  assert.equal(guard.checkCollectionKey("WORTHY", { action: "add_items_to_collection" }).ok, true);
  const blocked = guard.checkCollectionKey("WORTHY_CHILD", { action: "add_items_to_collection" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "collection_out_of_allowed_scope");
});

test("summarizes blocked collection mutations", () => {
  const summary = summarizeCollectionScopeBlocks([
    { action: "add_items_to_collection", collection_key: "OTHER", reason: "collection_out_of_allowed_scope" },
  ]);
  assert.equal(summary.collection_scope_blocked_count, 1);
  assert.equal(summary.collection_scope_blocked_samples[0].collection_key, "OTHER");
});
