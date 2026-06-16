#!/usr/bin/env node
/**
 * One-off fix: clean dirty publicationTitle values in Zotero.
 * Also infers journal name for items with empty publicationTitle from URL.
 *
 * Usage: node --env-file=.env tools/fix_dirty_publication_titles.mjs [--dry-run]
 */
import { cleanJournalName, inferJournalFromUrl } from "./lib/journal_name_cleaner.mjs";

const MCP_URL = process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp";
const DRY_RUN = process.argv.includes("--dry-run");

async function mcpCall(tool, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`MCP ${tool}: ${JSON.stringify(json.error)}`);
  return json.result;
}

function parse(result) {
  const text = typeof result === "string" ? result : result?.content?.[0]?.text || JSON.stringify(result);
  try { return JSON.parse(text); } catch { return text; }
}

async function findCollectionByName(name) {
  const raw = await mcpCall("get_collections", { mode: "complete", limit: 1000 });
  const cols = Array.isArray(parse(raw)) ? parse(raw) : [];
  return cols.find((c) => c.name === name && !c.parentCollection && !c.parent) || null;
}

async function getAllCollectionKeys(rootKey) {
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

async function getItemsInCollection(colKey, offset = 0, limit = 100) {
  const raw = await mcpCall("get_collection_items", { collectionKey: colKey, limit, offset, mode: "detailed" });
  return Array.isArray(parse(raw)) ? parse(raw) : [];
}

async function main() {
  console.log(`MCP URL: ${MCP_URL}`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE UPDATE"}\n`);

  try {
    await mcpCall("get_collections", { mode: "minimal", limit: 1 });
    console.log("✓ Zotero MCP connected\n");
  } catch (e) {
    console.error("✗ Cannot connect to Zotero MCP:", e.message);
    process.exit(1);
  }

  const poolCol = await findCollectionByName("文献池");
  const worthyCol = await findCollectionByName("值得精读");

  const dirtyUpdates = []; // publicationTitle has platform prefix
  const emptyUpdates = []; // publicationTitle is empty, infer from URL
  const seen = new Set();
  let scanned = 0;

  for (const { name, key } of [
    poolCol ? { name: "文献池", key: poolCol.key } : null,
    worthyCol ? { name: "值得精读", key: worthyCol.key } : null,
  ].filter(Boolean)) {
    console.log(`Scanning collection: ${name}`);
    const colKeys = await getAllCollectionKeys(key);
    console.log(`  ${colKeys.length} collections to scan`);

    for (const ck of colKeys) {
      let offset = 0;
      while (true) {
        const items = await getItemsInCollection(ck, offset, 100);
        if (items.length === 0) break;
        for (const item of items) {
          const ik = item.key || item.itemKey || "";
          if (!ik || seen.has(ik)) continue;
          seen.add(ik);
          scanned++;

          const pub = String(item.publicationTitle || "");
          const clean = cleanJournalName(pub);

          if (pub && clean !== pub) {
            // Has dirty publicationTitle → clean it
            dirtyUpdates.push({ itemKey: ik, title: (item.title || "").slice(0, 80), oldPub: pub, newPub: clean });
          } else if (!pub) {
            // Empty publicationTitle → try to infer from URL
            const inferred = await inferJournalFromUrl(item.url || "");
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

  console.log(`\nScanned ${scanned} items:`);
  console.log(`  ${dirtyUpdates.length} dirty publicationTitle (platform prefix)`);
  console.log(`  ${emptyUpdates.length} empty publicationTitle (inferred from URL)`);
  console.log(`  Total to update: ${allUpdates.length}\n`);

  if (allUpdates.length === 0) {
    console.log("Nothing to fix.");
    return;
  }

  // Summary
  if (dirtyUpdates.length > 0) {
    const byPattern = {};
    for (const u of dirtyUpdates) {
      const pattern = u.oldPub.replace(/:.*/, ": *");
      byPattern[pattern] = (byPattern[pattern] || 0) + 1;
    }
    console.log("Dirty patterns:");
    for (const [p, c] of Object.entries(byPattern).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${c}x "${p}"`);
    }
  }

  if (emptyUpdates.length > 0) {
    const byJournal = {};
    for (const u of emptyUpdates) {
      byJournal[u.inferred] = (byJournal[u.inferred] || 0) + 1;
    }
    console.log("Inferred journals:");
    for (const [j, c] of Object.entries(byJournal).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${c}x → "${j}"`);
    }
  }

  console.log(`\nSamples (first 15):`);
  for (const u of allUpdates.slice(0, 15)) {
    console.log(`  [${u.itemKey}] "${u.oldPub}" → "${u.newPub}" (${u.reason})`);
  }

  if (DRY_RUN) {
    console.log(`\nDRY RUN — no changes written. Remove --dry-run to apply.`);
    return;
  }

  let success = 0, failed = 0;
  for (const u of allUpdates) {
    try {
      await mcpCall("write_metadata", { itemKey: u.itemKey, fields: { publicationTitle: u.newPub } });
      success++;
      if (success % 20 === 0) console.log(`  ... ${success}/${allUpdates.length} updated`);
    } catch (e) {
      failed++;
      console.error(`  ✗ [${u.itemKey}] "${u.oldPub}" failed: ${e.message.slice(0, 100)}`);
    }
  }

  console.log(`\nDone. success=${success}, failed=${failed}, total=${allUpdates.length}`);
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
