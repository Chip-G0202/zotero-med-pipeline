#!/usr/bin/env node
/**
 * One-off fix: clean dirty publicationTitle values in Zotero.
 * Also infers journal name for items with empty publicationTitle from URL.
 *
 * Usage:
 *   node workflow/tools/maintenance/fix_dirty_publication_titles.mjs
 *   node workflow/tools/maintenance/fix_dirty_publication_titles.mjs --apply
 *
 * Default mode is DRY RUN. Only --apply writes Zotero metadata.
 */
import { pathToFileURL } from "node:url";
import { cleanJournalName, inferJournalFromUrl } from "../lib/journal_name_cleaner.mjs";
import { runGuardedWriteMetadataUpdates } from "../lib/writeback_support.mjs";
import {
  buildZoteroCollectionGuard,
  recordCollectionScopeBlock,
  summarizeCollectionScopeBlocks,
} from "../lib/zotero_collection_guard.mjs";
import { createCompatMcpToolCall } from "../lib/zotero_backend_compat.mjs";

const ALLOWED_ARGS = new Set(["--dry-run", "--apply"]);

export function parseFixDirtyPublicationTitlesArgs(argv = process.argv.slice(2)) {
  const args = Array.isArray(argv) ? argv : [];
  const unknown = args.filter((arg) => !ALLOWED_ARGS.has(String(arg)));
  if (unknown.length) {
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}. Supported: --dry-run, --apply`);
  }
  const explicitDryRun = args.includes("--dry-run");
  const apply = args.includes("--apply");
  if (explicitDryRun && apply) {
    throw new Error("Refusing ambiguous mode: use either --dry-run or --apply, not both.");
  }
  return {
    apply,
    dryRun: !apply,
    mode: apply ? "apply" : "dry-run",
  };
}

async function defaultMcpCall(tool, args) {
  if (!defaultMcpCall.backendToolCall) {
    defaultMcpCall.backendToolCall = await createCompatMcpToolCall();
  }
  return defaultMcpCall.backendToolCall(tool, args, 1);
}

function parse(result) {
  const text = typeof result === "string" ? result : result?.content?.[0]?.text || JSON.stringify(result);
  try { return JSON.parse(text); } catch { return text; }
}

function findTopLevelCollectionByName(collections, name) {
  return (Array.isArray(collections) ? collections : [])
    .find((c) => c.name === name && !c.parentCollection && !c.parent) || null;
}

async function getAllCollectionKeys(rootKey, mcpCall) {
  const keys = [rootKey];
  const tree = parse(await mcpCall("get_subcollections", { collectionKey: rootKey, recursive: true }));
  function collect(nodes) {
    for (const n of nodes || []) {
      keys.push(n.key);
      collect(n.subcollections);
    }
  }
  collect(Array.isArray(tree) ? tree : []);
  return keys;
}

async function getItemsInCollection(mcpCall, colKey, offset = 0, limit = 100) {
  const raw = await mcpCall("get_collection_items", { collectionKey: colKey, limit, offset, mode: "detailed" });
  return Array.isArray(parse(raw)) ? parse(raw) : [];
}

function safeLog(logger, method, message) {
  if (logger && typeof logger[method] === "function") logger[method](message);
}

export async function runFixDirtyPublicationTitles({
  argv = process.argv.slice(2),
  mcpCall = defaultMcpCall,
  inferJournal = inferJournalFromUrl,
  logger = console,
  mcpUrl = "zotero_backend",
} = {}) {
  const mode = parseFixDirtyPublicationTitlesArgs(argv);
  safeLog(logger, "log", `Zotero backend: ${mcpUrl}`);
  safeLog(logger, "log", `Mode: ${mode.dryRun ? "DRY RUN" : "APPLY"}${mode.apply ? " — LIVE ZOTERO METADATA UPDATE" : " — no Zotero writes"}
`);
  if (mode.apply) {
    safeLog(logger, "error", "WARNING: --apply will write publicationTitle metadata for scanned Zotero items.");
  }

  const collections = parse(await mcpCall("get_collections", { mode: "complete", limit: 1000 }));
  if (!Array.isArray(collections)) throw new Error("Zotero backend get_collections did not return an array.");
  safeLog(logger, "log", "✓ Zotero backend connected");

  const collectionGuard = buildZoteroCollectionGuard(collections);
  const collectionScopeBlocks = [];
  const poolCol = findTopLevelCollectionByName(collections, "文献池");
  const worthyCol = findTopLevelCollectionByName(collections, "值得精读");

  const dirtyUpdates = []; // publicationTitle has platform prefix
  const emptyUpdates = []; // publicationTitle is empty, infer from URL
  const seen = new Set();
  const allowedItemKeys = new Set();
  let scanned = 0;

  for (const { name, key } of [
    poolCol ? { name: "文献池", key: poolCol.key } : null,
    worthyCol ? { name: "值得精读", key: worthyCol.key } : null,
  ].filter(Boolean)) {
    const rootCheck = collectionGuard.checkCollectionKey(key, { action: "write_metadata", role: "scan_root" });
    if (!rootCheck.ok) {
      recordCollectionScopeBlock(collectionScopeBlocks, rootCheck, { collection_name: name });
      safeLog(logger, "error", `Blocked scan root ${name}: ${rootCheck.reason}`);
      continue;
    }
    safeLog(logger, "log", `Scanning collection: ${name}`);
    const colKeys = await getAllCollectionKeys(key, mcpCall);
    const allowedColKeys = [];
    for (const colKey of colKeys) {
      const check = collectionGuard.checkCollectionKey(colKey, { action: "write_metadata", role: "scan_collection" });
      if (check.ok) allowedColKeys.push(colKey);
      else recordCollectionScopeBlock(collectionScopeBlocks, check);
    }
    safeLog(logger, "log", `  ${allowedColKeys.length} collections to scan`);

    for (const ck of allowedColKeys) {
      let offset = 0;
      while (true) {
        const items = await getItemsInCollection(mcpCall, ck, offset, 100);
        if (items.length === 0) break;
        for (const item of items) {
          const ik = item.key || item.itemKey || "";
          if (!ik || seen.has(ik)) continue;
          seen.add(ik);
          allowedItemKeys.add(ik);
          scanned++;

          const pub = String(item.publicationTitle || "");
          const clean = cleanJournalName(pub);

          if (pub && clean !== pub) {
            // Has dirty publicationTitle → clean it
            dirtyUpdates.push({ itemKey: ik, title: (item.title || "").slice(0, 80), oldPub: pub, newPub: clean });
          } else if (!pub) {
            // Empty publicationTitle → try to infer from URL
            const inferred = await inferJournal(item.url || "");
            if (inferred) {
              emptyUpdates.push({ itemKey: ik, title: (item.title || "").slice(0, 80), url: item.url || "", inferred });
            }
          }
        }
        if (items.length < 100) break;
        offset += 100;
      }
    }
  }

  const allUpdates = [
    ...dirtyUpdates.map((u) => ({ ...u, reason: "dirty_prefix" })),
    ...emptyUpdates.map((u) => ({ itemKey: u.itemKey, title: u.title, oldPub: "(empty)", newPub: u.inferred, reason: "inferred_from_url" })),
  ];

  safeLog(logger, "log", `
Scanned ${scanned} items:`);
  safeLog(logger, "log", `  ${dirtyUpdates.length} dirty publicationTitle (platform prefix)`);
  safeLog(logger, "log", `  ${emptyUpdates.length} empty publicationTitle (inferred from URL)`);
  safeLog(logger, "log", `  Total to update: ${allUpdates.length}
`);

  if (allUpdates.length === 0) {
    safeLog(logger, "log", "Nothing to fix.");
    return {
      ok: true,
      dry_run: mode.dryRun,
      apply: mode.apply,
      scanned,
      planned_update_count: 0,
      write_success_count: 0,
      write_failure_count: 0,
      ...collectionGuard.audit,
      ...summarizeCollectionScopeBlocks(collectionScopeBlocks),
    };
  }

  // Summary
  if (dirtyUpdates.length > 0) {
    const byPattern = {};
    for (const u of dirtyUpdates) {
      const pattern = u.oldPub.replace(/:.*/, ": *");
      byPattern[pattern] = (byPattern[pattern] || 0) + 1;
    }
    safeLog(logger, "log", "Dirty patterns:");
    for (const [p, c] of Object.entries(byPattern).sort((a, b) => b[1] - a[1])) {
      safeLog(logger, "log", `  ${c}x "${p}"`);
    }
  }

  if (emptyUpdates.length > 0) {
    const byJournal = {};
    for (const u of emptyUpdates) {
      byJournal[u.inferred] = (byJournal[u.inferred] || 0) + 1;
    }
    safeLog(logger, "log", "Inferred journals:");
    for (const [j, c] of Object.entries(byJournal).sort((a, b) => b[1] - a[1])) {
      safeLog(logger, "log", `  ${c}x → "${j}"`);
    }
  }

  safeLog(logger, "log", `
Samples (first 15):`);
  for (const u of allUpdates.slice(0, 15)) {
    safeLog(logger, "log", `  [${u.itemKey}] "${u.oldPub}" → "${u.newPub}" (${u.reason})`);
  }

  if (mode.dryRun) {
    safeLog(logger, "log", `
DRY RUN — no changes written. Re-run with --apply to write Zotero metadata.`);
    return {
      ok: true,
      dry_run: true,
      apply: false,
      scanned,
      planned_update_count: allUpdates.length,
      write_success_count: 0,
      write_failure_count: 0,
      updates: allUpdates,
      ...collectionGuard.audit,
      ...summarizeCollectionScopeBlocks(collectionScopeBlocks),
    };
  }

  const writeResult = await runGuardedWriteMetadataUpdates({
    updates: allUpdates,
    apply: mode.apply,
    dryRun: mode.dryRun,
    allowedItemKeys,
    guardReady: collectionGuard.ready,
    guardBlockedReason: `collection_guard_not_ready:${collectionGuard.rootIssue || "unknown"}`,
    fieldsForUpdate: (u) => ({ publicationTitle: u.newPub }),
    writer: async ({ itemKey, fields }) => {
      await mcpCall("write_metadata", { itemKey, fields });
    },
    onProgress: ({ success, total }) => {
      if (success % 20 === 0) safeLog(logger, "log", `  ... ${success}/${total} updated`);
    },
    onFailure: ({ update, error }) => {
      safeLog(logger, "error", `  ✗ [${update.itemKey}] "${update.oldPub}" failed: ${(error?.message || String(error)).slice(0, 100)}`);
    },
  });

  safeLog(logger, "log", `
Done. success=${writeResult.write_success_count}, failed=${writeResult.write_failure_count}, total=${allUpdates.length}`);
  return {
    ok: writeResult.ok,
    dry_run: false,
    apply: true,
    scanned,
    planned_update_count: allUpdates.length,
    write_success_count: writeResult.write_success_count,
    write_failure_count: writeResult.write_failure_count,
    write_failures: writeResult.write_failures,
    guard_blocked_count: writeResult.guard_blocked_count,
    updates: allUpdates,
    ...collectionGuard.audit,
    ...summarizeCollectionScopeBlocks(collectionScopeBlocks),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFixDirtyPublicationTitles().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
}
