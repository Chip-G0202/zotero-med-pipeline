import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGE2_MEMBERSHIP_MUTATION_COMPAT_FALLBACKS,
  STAGE2_MEMBERSHIP_MUTATION_CONTRACT_METHODS,
  STAGE2_TREE_LISTING_COMPAT_FALLBACKS,
  STAGE2_TREE_LISTING_CONTRACT_METHODS,
  ZOTERO_BACKEND_CONTRACT_METHODS,
  normalizeBackendContractResult,
  normalizeStage2MembershipMutationResult,
  validateZoteroBackendContract,
} from "../tools/lib/zotero_backend_contract.mjs";

test("Zotero backend contract lists the shared stage boundary methods", () => {
  assert.deepEqual(ZOTERO_BACKEND_CONTRACT_METHODS, [
    "ready",
    "getCollections",
    "getCollectionItems",
    "ensureWritebackCollections",
    "createItems",
    "addItemsToCollections",
    "writeMetadataBatch",
    "getItems",
    "deleteItems",
    "deleteCollections",
    "cleanupRun",
    "getStats",
  ]);
});

test("contract validation accepts fake backend with required methods", () => {
  const fakeBackend = Object.fromEntries(ZOTERO_BACKEND_CONTRACT_METHODS.map((method) => [method, async () => ({})]));
  const result = validateZoteroBackendContract(fakeBackend);

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test("contract validation reports missing methods without touching backend internals", () => {
  const result = validateZoteroBackendContract({
    ready: async () => ({ ok: true }),
    getCollections: async () => [],
  });

  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("cleanupRun"));
  assert.ok(result.missing.includes("getStats"));
});

test("contract result normalization expresses success, partial failure, fallback, cleanup residual, and stats", () => {
  const result = normalizeBackendContractResult({
    backend: "fake",
    method: "createItems",
    inputCount: 3,
    created: [{ itemKey: "A" }, { itemKey: "B" }],
    failed: [{ inputIndex: 2, error: "boom" }],
    fallback: { used: true, reason: "batch_failed" },
    cleanup: { deletedItems: 2, residualItems: 1, residualCollections: 0 },
    stats: { logicalItemCount: 3, requestCount: 2, backendDetails: { transport: "fake" } },
  });

  assert.equal(result.ok, false);
  assert.equal(result.backend, "fake");
  assert.equal(result.method, "createItems");
  assert.equal(result.input_count, 3);
  assert.equal(result.success_count, 2);
  assert.equal(result.failure_count, 1);
  assert.equal(result.partial_failure, true);
  assert.deepEqual(result.fallback, { used: true, reason: "batch_failed" });
  assert.equal(result.cleanup.residual_count, 1);
  assert.deepEqual(result.stats, {
    logical_item_count: 3,
    request_count: 2,
    backendDetails: { transport: "fake" },
  });
});

test("Stage2 membership mutation contract documents optional tag and removal boundaries", () => {
  assert.deepEqual(STAGE2_MEMBERSHIP_MUTATION_CONTRACT_METHODS, [
    "writeTagsBatch",
    "removeItemsFromCollections",
  ]);
  assert.deepEqual(STAGE2_MEMBERSHIP_MUTATION_COMPAT_FALLBACKS, {
    writeTagsBatch: "write_tag",
    removeItemsFromCollections: "remove_items_from_collection",
  });
});

test("Stage2 tree listing contract documents optional subcollection boundary", () => {
  assert.deepEqual(STAGE2_TREE_LISTING_CONTRACT_METHODS, [
    "getSubcollections",
  ]);
  assert.deepEqual(STAGE2_TREE_LISTING_COMPAT_FALLBACKS, {
    getSubcollections: "get_subcollections",
  });
});

test("Stage2 membership mutation result expresses success, partial failure, missing, guard, and backend error", () => {
  const success = normalizeStage2MembershipMutationResult({
    method: "writeTagsBatch",
    operations: [{ itemKey: "K1", tags: ["kept"] }],
    applied: [{ itemKey: "K1" }],
  });
  assert.equal(success.ok, true);
  assert.equal(success.success_count, 1);
  assert.equal(success.failure_count, 0);

  const partial = normalizeStage2MembershipMutationResult({
    method: "removeItemsFromCollections",
    operations: [
      { collectionKey: "SRC", itemKeys: ["K1"] },
      { collectionKey: "SRC", itemKeys: ["K2"] },
    ],
    applied: [{ itemKey: "K1", collectionKey: "SRC" }],
    failed: [{ itemKey: "K2", collectionKey: "SRC", error: "remove_failed" }],
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.partial_failure, true);
  assert.equal(partial.failure_count, 1);
  assert.equal(partial.failures[0].error, "remove_failed");

  const missing = normalizeStage2MembershipMutationResult({
    method: "removeItemsFromCollections",
    operations: [{ collectionKey: "SRC", itemKeys: ["MISSING"] }],
    missing: [{ itemKey: "MISSING", collectionKey: "SRC", error: "item_missing" }],
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.missing_count, 1);
  assert.equal(missing.failures[0].missing, true);

  const guarded = normalizeStage2MembershipMutationResult({
    method: "writeTagsBatch",
    operations: [{ itemKey: "K1", tags: ["kept"] }],
    guarded: [{ itemKey: "K1", error: "tag_cleanup_guard_blocked" }],
    dryRun: false,
    guard: { ok: false, reason: "tag_cleanup_guard_blocked" },
  });
  assert.equal(guarded.ok, false);
  assert.equal(guarded.guard_blocked_count, 1);
  assert.equal(guarded.writer_allowed, false);

  const backendError = normalizeStage2MembershipMutationResult({
    method: "writeTagsBatch",
    operations: [{ itemKey: "K1", tags: ["kept"] }],
    backendError: "backend_down",
    fallback: { used: true, tool: "write_tag" },
  });
  assert.equal(backendError.ok, false);
  assert.equal(backendError.backend_error, "backend_down");
  assert.deepEqual(backendError.fallback, { used: true, tool: "write_tag" });
});
