import {
  attachItemsToCollectionsBatched,
  groupItemKeysByCollection,
} from "../lib/writeback_support.mjs";

function skippedAttachStats({ batchSize, stopReason }) {
  return {
    collection_attach_mode: "batch",
    collection_attach_batch_size: batchSize,
    collection_attach_calls: 0,
    collection_attach_failures: [{ error: `stopped_before_attach:${stopReason}` }],
    fallback_to_per_item_count: 0,
  };
}

export async function runCollectionAttachStep({
  writebackItems = [],
  rootKey = "",
  stopForHighRisk = false,
  stopReason = "",
  attachBatchSize = 50,
  zoteroBackend = null,
  zoteroBackendCall,
  mcpToolCall,
  collectionGuard,
  collectionScopeBlocks,
} = {}) {
  const callZotero = zoteroBackendCall || mcpToolCall;
  const started = Date.now();
  const groupedAttach = stopForHighRisk ? new Map() : groupItemKeysByCollection(writebackItems);
  const attachStats = stopForHighRisk
    ? skippedAttachStats({ batchSize: attachBatchSize, stopReason })
    : await attachItemsToCollectionsBatched({
      groupedItemKeys: groupedAttach,
      batchSize: attachBatchSize,
      zoteroBackend,
      zoteroBackendCall: callZotero,
      idBase: 30000,
      collectionGuard,
      collectionScopeBlocks,
    });
  const poolAttachStats = {
    ...attachStats,
    collection_attach_failures: (attachStats.collection_attach_failures || []).filter((x) => x.collectionKey === rootKey),
  };
  const dailyAttachStats = {
    ...attachStats,
    collection_attach_failures: (attachStats.collection_attach_failures || []).filter((x) => x.collectionKey !== rootKey),
  };
  const poolAttachFailureKeys = new Set(
    (poolAttachStats.collection_attach_failures || []).flatMap((x) => Array.isArray(x.itemKeys) ? x.itemKeys : []),
  );
  const dailyAttachFailureKeys = new Set(
    (dailyAttachStats.collection_attach_failures || []).flatMap((x) => Array.isArray(x.itemKeys) ? x.itemKeys : []),
  );
  return {
    attachStats,
    poolAttachStats,
    dailyAttachStats,
    poolAttachFailureKeys,
    dailyAttachFailureKeys,
    collectionAttachMs: Date.now() - started,
  };
}
