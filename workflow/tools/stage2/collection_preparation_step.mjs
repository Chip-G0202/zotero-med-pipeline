import { LABELS } from "../lib/grade_primitives.mjs";
import {
  recordCollectionScopeBlock,
  summarizeCollectionScopeBlocks,
} from "../lib/zotero_collection_guard.mjs";
import {
  buildCollectionGuard,
  ensureChildCollection,
  ensureTopCollectionByName,
  invalidateCollectionGuardCache,
} from "./collection_setup.mjs";

export const SOURCE_COLLECTIONS = {
  rss: "RSS订阅",
  database: "数据库检索",
};

export const GRADE_COLLECTIONS = {
  [LABELS.A]: LABELS.A,
  [LABELS.B]: LABELS.B,
  [LABELS.C]: LABELS.C,
};

export async function prepareManagedCollections({ zoteroBackendCall, mcpToolCall, collectionScopeBlocks }) {
  const callZotero = zoteroBackendCall || mcpToolCall;
  invalidateCollectionGuardCache();

  const root = await ensureTopCollectionByName("文献池", { mcpToolCall: callZotero, callIdBase: 20 });
  let collectionGuard = await buildCollectionGuard(root.key, { mcpToolCall: callZotero });
  if (!collectionGuard.ready) {
    const err = new Error(`collection_scope_blocked:${collectionGuard.rootIssue || "guard_not_ready"}`);
    err.details = collectionGuard.audit;
    throw err;
  }

  const trashKey = await ensureChildCollection(root.key, "待删除", 48, { mcpToolCall: callZotero, collectionGuard, collectionScopeBlocks });
  const worthy = await ensureTopCollectionByName("值得精读", { mcpToolCall: callZotero, callIdBase: 52 });

  const currentCollections = {
    [root.key]: { key: root.key, name: "文献池", role: "pool", parentCollection: root.parentCollection || root.parent || false },
    ...(trashKey ? { [trashKey]: { key: trashKey, name: "待删除", role: "trash", parentCollection: root.key } } : {}),
    ...(worthy?.key ? { [worthy.key]: { key: worthy.key, name: "值得精读", role: "worthy", parentCollection: worthy.parentCollection || worthy.parent || false } } : {}),
  };
  collectionGuard = await buildCollectionGuard(root.key, { mcpToolCall: callZotero, localCollections: Object.values(currentCollections) });

  const requiredBaseChecks = [
    collectionGuard.checkCollectionKey(root.key, { action: "create_collection", role: "root_pool" }),
    collectionGuard.checkCollectionKey(trashKey, { action: "create_collection", role: "trash_collection" }),
    collectionGuard.checkCollectionKey(worthy?.key, { action: "create_collection", role: "worthy_collection" }),
  ];
  const blockedBaseChecks = requiredBaseChecks.filter((check) => !check.ok);
  for (const check of blockedBaseChecks) {
    recordCollectionScopeBlock(collectionScopeBlocks, check, { phase: "base_collection_validation" });
  }
  if (blockedBaseChecks.length) {
    const err = new Error(`collection_scope_blocked: base collection outside managed scope (${blockedBaseChecks[0].reason})`);
    err.details = {
      ...collectionGuard.audit,
      ...summarizeCollectionScopeBlocks(collectionScopeBlocks),
    };
    throw err;
  }

  return {
    root,
    trashKey,
    worthy,
    collectionGuard,
    currentCollections,
  };
}

export async function prepareWritebackTargetCollections({
  root,
  zoteroMonthName,
  zoteroDayName,
  zoteroBackend,
  zoteroBackendCall,
  mcpToolCall,
  collectionGuard,
  collectionScopeBlocks,
  currentCollections,
}) {
  const callZotero = zoteroBackendCall || mcpToolCall;
  const contractBackend = zoteroBackend || callZotero?.adapter || null;
  const setupPlan = {
    rootKey: root.key,
    monthName: zoteroMonthName,
    dayName: zoteroDayName,
    sourceNames: Object.values(SOURCE_COLLECTIONS),
    gradeNames: Object.values(GRADE_COLLECTIONS),
    stage: "stage2_collection_setup",
  };

  async function finishEnsuredWritebackCollections(data, { strict = false } = {}) {
    if (Array.isArray(data?.failed) && data.failed.length) {
      const first = data.failed[0];
      throw new Error(`ensure_writeback_collections_failed:${first?.error || first?.reason || first?.name || "unknown"}`);
    }
    const monthKey = data?.month?.key || "";
    const dateKey = data?.date?.key || "";
    if (strict && !monthKey) throw new Error("ensure_writeback_collections_missing_month");
    if (strict && !dateKey) throw new Error("ensure_writeback_collections_missing_date");
    if (!monthKey || !dateKey) return null;

    const collectionRecords = [];
    const reusedCollectionKeys = new Set((Array.isArray(data?.existing) ? data.existing : []).map((entry) => String(entry?.key || entry || "")).filter(Boolean));
    const recordCollection = (entry, { key, name, role, parentKey }) => {
      const ownership = entry?.created === true
        ? "created"
        : entry?.created === false || reusedCollectionKeys.has(key)
          ? "reused"
          : "unknown";
      const record = {
        key,
        name,
        role,
        parentKey,
        createdByRun: ownership === "created",
        ownership,
      };
      if (ownership === "reused") reusedCollectionKeys.add(key);
      collectionRecords.push(record);
      return record;
    };
    recordCollection(data?.month, { key: monthKey, name: zoteroMonthName, role: "month", parentKey: root.key });
    recordCollection(data?.date, { key: dateKey, name: zoteroDayName, role: "day", parentKey: monthKey });
    currentCollections[monthKey] = { key: monthKey, name: zoteroMonthName, role: "month", parentCollection: root.key };
    currentCollections[dateKey] = { key: dateKey, name: zoteroDayName, role: "day", parentCollection: monthKey };

    const sourceKeys = {};
    for (const name of Object.values(SOURCE_COLLECTIONS)) {
      const key = data?.sources?.[name]?.key || "";
      if (!key) throw new Error(`ensure_writeback_collections_missing_source:${name}`);
      sourceKeys[name] = key;
      recordCollection(data?.sources?.[name], { key, name, role: "source", parentKey: dateKey });
      currentCollections[key] = { key, name, role: "source", parentCollection: dateKey };
    }

    const gradeKeys = {};
    for (const name of Object.values(GRADE_COLLECTIONS)) {
      const key = data?.grades?.[name]?.key || "";
      if (!key) throw new Error(`ensure_writeback_collections_missing_grade:${name}`);
      gradeKeys[name] = key;
      recordCollection(data?.grades?.[name], { key, name, role: "grade", parentKey: dateKey });
      currentCollections[key] = { key, name, role: "grade", parentCollection: dateKey };
    }

    collectionGuard = await buildCollectionGuard(root.key, { mcpToolCall: callZotero, localCollections: Object.values(currentCollections) });
    const requiredTargetChecks = [
      { key: root.key, action: "add_items_to_collection", role: "root_pool" },
      ...Object.values(sourceKeys).map((key) => ({ key, action: "add_items_to_collection", role: "source_collection" })),
      ...Object.values(gradeKeys).map((key) => ({ key, action: "add_items_to_collection", role: "grade_collection" })),
    ].map((entry) => collectionGuard.checkCollectionKey(entry.key, { action: entry.action, role: entry.role }));
    const blockedRequiredTargets = requiredTargetChecks.filter((check) => !check.ok);
    for (const check of blockedRequiredTargets) {
      recordCollectionScopeBlock(collectionScopeBlocks, check, { phase: "writeback_target_validation" });
    }
    if (blockedRequiredTargets.length) {
      const err = new Error(`collection_scope_blocked: writeback target outside managed scope (${blockedRequiredTargets[0].reason})`);
      err.details = {
        ...collectionGuard.audit,
        ...summarizeCollectionScopeBlocks(collectionScopeBlocks),
      };
      throw err;
    }

    return {
      monthKey,
      dateKey,
      sourceKeys,
      gradeKeys,
      collectionRecords,
      reusedCollectionKeys: [...reusedCollectionKeys],
      collectionGuard,
    };
  }

  if (typeof contractBackend?.ensureWritebackCollections === "function") {
    const targetCollections = await finishEnsuredWritebackCollections(
      await contractBackend.ensureWritebackCollections(setupPlan),
      { strict: true },
    );
    if (targetCollections) return targetCollections;
  }

  if (callZotero?.backendType === "cli") {
    let data = null;
    try {
      const ensured = await callZotero("ensure_writeback_collections", setupPlan, 80);
      data = JSON.parse(ensured?.content?.[0]?.text || "{}");
    } catch {
      data = null;
    }
    if (data) {
      const targetCollections = await finishEnsuredWritebackCollections(data);
      if (targetCollections) return targetCollections;
    }
  }

  // Create all target collections first, then rebuild guard once
  const monthKey = await ensureChildCollection(root.key, zoteroMonthName, 50, { mcpToolCall: callZotero, collectionGuard, collectionScopeBlocks });
  currentCollections[monthKey] = { key: monthKey, name: zoteroMonthName, role: "month", parentCollection: root.key };
  collectionGuard = await buildCollectionGuard(root.key, { mcpToolCall: callZotero, localCollections: Object.values(currentCollections) });

  const dateKey = await ensureChildCollection(monthKey, zoteroDayName, 54, { mcpToolCall: callZotero, collectionGuard, collectionScopeBlocks });
  currentCollections[dateKey] = { key: dateKey, name: zoteroDayName, role: "day", parentCollection: monthKey };
  collectionGuard = await buildCollectionGuard(root.key, { mcpToolCall: callZotero, localCollections: Object.values(currentCollections) });

  const sourceKeys = {};
  for (const name of Object.values(SOURCE_COLLECTIONS)) {
    sourceKeys[name] = await ensureChildCollection(dateKey, name, 100 + Object.keys(sourceKeys).length * 2, { mcpToolCall: callZotero, collectionGuard, collectionScopeBlocks });
    currentCollections[sourceKeys[name]] = { key: sourceKeys[name], name, role: "source", parentCollection: dateKey };
  }

  const gradeKeys = {};
  for (const name of Object.values(GRADE_COLLECTIONS)) {
    gradeKeys[name] = await ensureChildCollection(dateKey, name, 200 + Object.keys(gradeKeys).length * 2, { mcpToolCall: callZotero, collectionGuard, collectionScopeBlocks });
    currentCollections[gradeKeys[name]] = { key: gradeKeys[name], name, role: "grade", parentCollection: dateKey };
  }

  collectionGuard = await buildCollectionGuard(root.key, { mcpToolCall: callZotero, localCollections: Object.values(currentCollections) });

  const requiredTargetChecks = [
    { key: root.key, action: "add_items_to_collection", role: "root_pool" },
    ...Object.values(sourceKeys).map((key) => ({ key, action: "add_items_to_collection", role: "source_collection" })),
    ...Object.values(gradeKeys).map((key) => ({ key, action: "add_items_to_collection", role: "grade_collection" })),
  ].map((entry) => collectionGuard.checkCollectionKey(entry.key, { action: entry.action, role: entry.role }));
  const blockedRequiredTargets = requiredTargetChecks.filter((check) => !check.ok);
  for (const check of blockedRequiredTargets) {
    recordCollectionScopeBlock(collectionScopeBlocks, check, { phase: "writeback_target_validation" });
  }
  if (blockedRequiredTargets.length) {
    const err = new Error(`collection_scope_blocked: writeback target outside managed scope (${blockedRequiredTargets[0].reason})`);
    err.details = {
      ...collectionGuard.audit,
      ...summarizeCollectionScopeBlocks(collectionScopeBlocks),
    };
    throw err;
  }

  return {
    monthKey,
    dateKey,
    sourceKeys,
    gradeKeys,
    collectionRecords: [
      { key: monthKey, name: zoteroMonthName, role: "month", parentKey: root.key, createdByRun: false, ownership: "unknown" },
      { key: dateKey, name: zoteroDayName, role: "day", parentKey: monthKey, createdByRun: false, ownership: "unknown" },
      ...Object.entries(sourceKeys).map(([name, key]) => ({ key, name, role: "source", parentKey: dateKey, createdByRun: false, ownership: "unknown" })),
      ...Object.entries(gradeKeys).map(([name, key]) => ({ key, name, role: "grade", parentKey: dateKey, createdByRun: false, ownership: "unknown" })),
    ],
    reusedCollectionKeys: [monthKey, dateKey, ...Object.values(sourceKeys), ...Object.values(gradeKeys)],
    collectionGuard,
  };
}
