import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCollectionGuard,
  ensureChildCollection,
  ensureTopCollectionByName,
  invalidateCollectionGuardCache,
} from "../tools/stage2/collection_setup.mjs";
import {
  prepareManagedCollections,
  prepareWritebackTargetCollections,
} from "../tools/stage2/collection_preparation_step.mjs";

function result(value) {
  return { content: [{ text: JSON.stringify(value) }] };
}

test("collection setup reuses complete collection list within one preparation round", async () => {
  invalidateCollectionGuardCache();
  const calls = [];
  const collections = [
    { key: "POOL", name: "文献池", parentCollection: false },
    { key: "TRASH", name: "待删除", parentCollection: "POOL" },
  ];
  const mcpToolCall = async (name, args) => {
    calls.push(name);
    if (name === "get_collections") return result(collections);
    if (name === "get_subcollections") return result(collections.filter((entry) => entry.parentCollection === args.collectionKey));
    if (name === "create_collection") return result({ key: "WORTHY", name: args.name, parentCollection: args.parentCollection || false });
    throw new Error(`unexpected call ${name}`);
  };

  const root = await ensureTopCollectionByName("文献池", { mcpToolCall, callIdBase: 20 });
  const worthy = await ensureTopCollectionByName("值得精读", { mcpToolCall, callIdBase: 52 });
  await buildCollectionGuard(root.key, { mcpToolCall });

  assert.equal(root.key, "POOL");
  assert.equal(worthy.key, "WORTHY");
  assert.equal(calls.filter((name) => name === "get_collections").length, 1);
});

test("created child collections are remembered for later guard checks", async () => {
  invalidateCollectionGuardCache();
  const calls = [];
  const collections = [
    { key: "POOL", name: "文献池", parentCollection: false },
    { key: "TRASH", name: "待删除", parentCollection: "POOL" },
    { key: "WORTHY", name: "值得精读", parentCollection: false },
  ];
  const mcpToolCall = async (name, args) => {
    calls.push(name);
    if (name === "get_collections") return result(collections);
    if (name === "get_subcollections") return result(collections.filter((entry) => entry.parentCollection === args.collectionKey));
    if (name === "create_collection") return result({ key: "MONTH", name: args.name, parentCollection: args.parentCollection });
    throw new Error(`unexpected call ${name}`);
  };

  const root = await ensureTopCollectionByName("文献池", { mcpToolCall });
  const guard = await buildCollectionGuard(root.key, { mcpToolCall });
  const monthKey = await ensureChildCollection(root.key, "26.07", 50, { mcpToolCall, collectionGuard: guard, collectionScopeBlocks: [] });
  const refreshedGuard = await buildCollectionGuard(root.key, { mcpToolCall });

  assert.equal(monthKey, "MONTH");
  assert.equal(refreshedGuard.checkCollectionKey(monthKey, { action: "add_items_to_collection" }).ok, true);
  assert.equal(calls.filter((name) => name === "get_collections").length, 1);
});

test("full writeback collection preparation avoids repeated complete collection scans", async () => {
  invalidateCollectionGuardCache();
  const calls = [];
  const collections = [
    { key: "POOL", name: "文献池", parentCollection: false },
    { key: "TRASH", name: "待删除", parentCollection: "POOL" },
    { key: "WORTHY", name: "值得精读", parentCollection: false },
  ];
  let nextId = 0;
  const keysByName = new Map([
    ["26.07", "MONTH"],
    ["07.08", "DAY"],
    ["RSS订阅", "RSS"],
    ["数据库检索", "DB"],
    ["A课题相关", "A"],
    ["B专题相关", "B"],
    ["C领域相关", "C"],
  ]);
  const mcpToolCall = async (name, args) => {
    calls.push(name);
    if (name === "get_collections") return result(collections);
    if (name === "get_subcollections") {
      const collectionKey = args.collectionKey;
      return result(collections.filter((entry) => entry.parentCollection === collectionKey));
    }
    if (name === "create_collection") {
      const key = keysByName.get(args.name) || `NEW${++nextId}`;
      const created = { key, name: args.name, parentCollection: args.parentCollection || false };
      collections.push(created);
      return result(created);
    }
    throw new Error(`unexpected call ${name}`);
  };

  const collectionScopeBlocks = [];
  const prepared = await prepareManagedCollections({ zoteroBackendCall: mcpToolCall, collectionScopeBlocks });
  const targets = await prepareWritebackTargetCollections({
    ...prepared,
    zoteroMonthName: "26.07",
    zoteroDayName: "07.08",
    zoteroBackendCall: mcpToolCall,
    collectionScopeBlocks,
  });

  assert.deepEqual(collectionScopeBlocks, []);
  assert.equal(targets.collectionGuard.checkCollectionKey(targets.gradeKeys["A课题相关"], { action: "add_items_to_collection" }).ok, true);
  assert.equal(targets.collectionGuard.checkCollectionKey(targets.sourceKeys["RSS订阅"], { action: "add_items_to_collection" }).ok, true);
  assert.equal(calls.filter((name) => name === "get_collections").length, 1);
});

test("CLI collection setup trusts complete tree and skips child lookups", async () => {
  invalidateCollectionGuardCache();
  const calls = [];
  const collections = [
    { key: "POOL", name: "文献池", parentCollection: false },
    { key: "TRASH", name: "待删除", parentCollection: "POOL" },
    { key: "WORTHY", name: "值得精读", parentCollection: false },
  ];
  const keysByName = new Map([
    ["26.07", "MONTH"],
    ["07.08", "DAY"],
    ["RSS订阅", "RSS"],
    ["数据库检索", "DB"],
    ["A课题相关", "A"],
    ["B专题相关", "B"],
    ["C领域相关", "C"],
  ]);
  const mcpToolCall = async (name, args) => {
    calls.push(name);
    if (name === "get_collections") return result(collections);
    if (name === "get_subcollections") throw new Error("CLI setup should use cached complete tree");
    if (name === "ensure_writeback_collections") {
      return result({
        month: { key: "MONTH", name: args.monthName, parentCollection: args.rootKey },
        date: { key: "DAY", name: args.dayName, parentCollection: "MONTH" },
        sources: {
          "RSS订阅": { key: "RSS", name: "RSS订阅", parentCollection: "DAY" },
          "数据库检索": { key: "DB", name: "数据库检索", parentCollection: "DAY" },
        },
        grades: {
          "A课题相关": { key: "A", name: "A课题相关", parentCollection: "DAY" },
          "B专题相关": { key: "B", name: "B专题相关", parentCollection: "DAY" },
          "C领域相关": { key: "C", name: "C领域相关", parentCollection: "DAY" },
        },
      });
    }
    if (name === "create_collection") {
      const created = { key: keysByName.get(args.name), name: args.name, parentCollection: args.parentCollection || false };
      collections.push(created);
      return result(created);
    }
    throw new Error(`unexpected call ${name}`);
  };
  mcpToolCall.backendType = "cli";

  const collectionScopeBlocks = [];
  const prepared = await prepareManagedCollections({ zoteroBackendCall: mcpToolCall, collectionScopeBlocks });
  const targets = await prepareWritebackTargetCollections({
    ...prepared,
    zoteroMonthName: "26.07",
    zoteroDayName: "07.08",
    zoteroBackendCall: mcpToolCall,
    collectionScopeBlocks,
  });

  assert.deepEqual(collectionScopeBlocks, []);
  assert.equal(targets.collectionGuard.checkCollectionKey(targets.sourceKeys["数据库检索"], { action: "add_items_to_collection" }).ok, true);
  assert.equal(calls.filter((name) => name === "get_collections").length, 1);
  assert.equal(calls.filter((name) => name === "get_subcollections").length, 0);
  assert.equal(calls.filter((name) => name === "ensure_writeback_collections").length, 1);
  assert.equal(calls.filter((name) => name === "create_collection").length, 0);
});

test("writeback collection preparation prefers contract ensureWritebackCollections", async () => {
  invalidateCollectionGuardCache();
  const calls = [];
  const collections = [
    { key: "POOL", name: "文献池", parentCollection: false },
    { key: "TRASH", name: "待删除", parentCollection: "POOL" },
    { key: "WORTHY", name: "值得精读", parentCollection: false },
  ];
  const mcpToolCall = async (name) => {
    calls.push({ name });
    if (name === "get_collections") return result(collections);
    if (name === "get_subcollections") throw new Error("contract setup should use cached complete tree");
    if (name === "create_collection") throw new Error("contract setup should not create via compat path");
    if (name === "ensure_writeback_collections") throw new Error("contract setup should not use compat tool-name");
    throw new Error(`unexpected call ${name}`);
  };
  const zoteroBackend = {
    async ensureWritebackCollections(plan) {
      calls.push({ name: "ensureWritebackCollections", plan });
      return {
        month: { key: "MONTH", name: plan.monthName, parentCollection: plan.rootKey, created: true },
        date: { key: "DAY", name: plan.dayName, parentCollection: "MONTH", created: false },
        sources: {
          "RSS订阅": { key: "RSS", name: "RSS订阅", parentCollection: "DAY", created: true },
          "数据库检索": { key: "DB", name: "数据库检索", parentCollection: "DAY" },
        },
        grades: {
          "A课题相关": { key: "A", name: "A课题相关", parentCollection: "DAY" },
          "B专题相关": { key: "B", name: "B专题相关", parentCollection: "DAY" },
          "C领域相关": { key: "C", name: "C领域相关", parentCollection: "DAY" },
        },
      };
    },
  };

  const collectionScopeBlocks = [];
  const prepared = await prepareManagedCollections({ zoteroBackendCall: mcpToolCall, collectionScopeBlocks });
  const targets = await prepareWritebackTargetCollections({
    ...prepared,
    zoteroMonthName: "26.07",
    zoteroDayName: "07.08",
    zoteroBackend,
    zoteroBackendCall: mcpToolCall,
    collectionScopeBlocks,
  });

  assert.equal(targets.monthKey, "MONTH");
  assert.equal(targets.dateKey, "DAY");
  assert.deepEqual(targets.sourceKeys, { "RSS订阅": "RSS", "数据库检索": "DB" });
  assert.deepEqual(targets.gradeKeys, { "A课题相关": "A", "B专题相关": "B", "C领域相关": "C" });
  assert.equal(Object.values(targets.sourceKeys).includes("POOL"), false);
  assert.equal(Object.values(targets.gradeKeys).includes("POOL"), false);
  assert.equal(calls.filter((call) => call.name === "ensureWritebackCollections").length, 1);
  assert.equal(calls.filter((call) => call.name === "ensure_writeback_collections").length, 0);
  assert.equal(calls.find((call) => call.name === "ensureWritebackCollections").plan.stage, "stage2_collection_setup");
  assert.equal(targets.collectionRecords.find((entry) => entry.key === "MONTH").ownership, "created");
  assert.equal(targets.collectionRecords.find((entry) => entry.key === "DAY").ownership, "reused");
  assert.equal(targets.collectionRecords.find((entry) => entry.key === "RSS").ownership, "created");
  assert.equal(targets.collectionRecords.find((entry) => entry.key === "DB").ownership, "unknown");
});

test("writeback collection preparation reports contract setup missing collection", async () => {
  invalidateCollectionGuardCache();
  const collections = [
    { key: "POOL", name: "文献池", parentCollection: false },
    { key: "TRASH", name: "待删除", parentCollection: "POOL" },
    { key: "WORTHY", name: "值得精读", parentCollection: false },
  ];
  const mcpToolCall = async (name) => {
    if (name === "get_collections") return result(collections);
    if (name === "get_subcollections") throw new Error("contract setup should not fall back after missing source");
    if (name === "create_collection") throw new Error("contract setup should not hide missing source");
    throw new Error(`unexpected call ${name}`);
  };
  const zoteroBackend = {
    async ensureWritebackCollections(plan) {
      return {
        month: { key: "MONTH", name: plan.monthName, parentCollection: plan.rootKey },
        date: { key: "DAY", name: plan.dayName, parentCollection: "MONTH" },
        sources: {
          "RSS订阅": { key: "RSS", name: "RSS订阅", parentCollection: "DAY" },
        },
        grades: {
          "A课题相关": { key: "A", name: "A课题相关", parentCollection: "DAY" },
          "B专题相关": { key: "B", name: "B专题相关", parentCollection: "DAY" },
          "C领域相关": { key: "C", name: "C领域相关", parentCollection: "DAY" },
        },
      };
    },
  };

  const collectionScopeBlocks = [];
  const prepared = await prepareManagedCollections({ zoteroBackendCall: mcpToolCall, collectionScopeBlocks });

  await assert.rejects(
    () => prepareWritebackTargetCollections({
      ...prepared,
      zoteroMonthName: "26.07",
      zoteroDayName: "07.08",
      zoteroBackend,
      zoteroBackendCall: mcpToolCall,
      collectionScopeBlocks,
    }),
    /ensure_writeback_collections_missing_source:数据库检索/,
  );
});

test("writeback collection preparation reports contract setup missing date collection", async () => {
  invalidateCollectionGuardCache();
  const collections = [
    { key: "POOL", name: "文献池", parentCollection: false },
    { key: "TRASH", name: "待删除", parentCollection: "POOL" },
    { key: "WORTHY", name: "值得精读", parentCollection: false },
  ];
  const mcpToolCall = async (name) => {
    if (name === "get_collections") return result(collections);
    if (name === "get_subcollections") throw new Error("contract setup should not fall back after missing date");
    if (name === "create_collection") throw new Error("contract setup should not hide missing date");
    throw new Error(`unexpected call ${name}`);
  };
  const zoteroBackend = {
    async ensureWritebackCollections(plan) {
      return {
        month: { key: "MONTH", name: plan.monthName, parentCollection: plan.rootKey },
        sources: {},
        grades: {},
      };
    },
  };

  const collectionScopeBlocks = [];
  const prepared = await prepareManagedCollections({ zoteroBackendCall: mcpToolCall, collectionScopeBlocks });

  await assert.rejects(
    () => prepareWritebackTargetCollections({
      ...prepared,
      zoteroMonthName: "26.07",
      zoteroDayName: "07.08",
      zoteroBackend,
      zoteroBackendCall: mcpToolCall,
      collectionScopeBlocks,
    }),
    /ensure_writeback_collections_missing_date/,
  );
});

test("writeback collection preparation reports contract setup partial failure", async () => {
  invalidateCollectionGuardCache();
  const collections = [
    { key: "POOL", name: "文献池", parentCollection: false },
    { key: "TRASH", name: "待删除", parentCollection: "POOL" },
    { key: "WORTHY", name: "值得精读", parentCollection: false },
  ];
  const mcpToolCall = async (name) => {
    if (name === "get_collections") return result(collections);
    throw new Error(`unexpected call ${name}`);
  };
  const zoteroBackend = {
    async ensureWritebackCollections() {
      return { failed: [{ name: "RSS订阅", error: "create_failed" }] };
    },
  };

  const collectionScopeBlocks = [];
  const prepared = await prepareManagedCollections({ zoteroBackendCall: mcpToolCall, collectionScopeBlocks });

  await assert.rejects(
    () => prepareWritebackTargetCollections({
      ...prepared,
      zoteroMonthName: "26.07",
      zoteroDayName: "07.08",
      zoteroBackend,
      zoteroBackendCall: mcpToolCall,
      collectionScopeBlocks,
    }),
    /ensure_writeback_collections_failed:create_failed/,
  );
});
