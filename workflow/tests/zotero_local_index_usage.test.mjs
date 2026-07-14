import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readZoteroLibraryIndex,
  updateZoteroLibraryIndexItems,
  writeZoteroLibraryIndex,
} from "../tools/lib/zotero_library_index_store.mjs";
import { collectExistingItemsMissingShortTitle } from "../tools/stage3/translation_pool_scan.mjs";

test("Stage3 pool scan uses local Zotero index without backend calls", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zotero-stage3-local-index-"));
  const localIndexPath = path.join(dir, "current_library_index.json");
  try {
    await writeZoteroLibraryIndex(localIndexPath, {
      schema_version: 1,
      live_items: {
        K1: {
          itemKey: "K1",
          title: "Missing short title",
          shortTitle: "",
          collections: [{ key: "GRADE", name: "A课题相关", path: "文献池/26.07/07.07/A课题相关" }],
          collection_roles: ["grade"],
        },
        K2: {
          itemKey: "K2",
          title: "Already translated",
          shortTitle: "已有翻译",
          collections: [{ key: "GRADE", name: "A课题相关", path: "文献池/26.07/07.07/A课题相关" }],
          collection_roles: ["grade"],
        },
      },
      tombstones: {},
    });
    const calls = [];
    const result = await collectExistingItemsMissingShortTitle("POOL", new Set(), {
      now: new Date("2026-07-07T00:00:00Z"),
      windowDays: 14,
      localIndexPath,
      zoteroBackendCall: async (name) => {
        calls.push(name);
        throw new Error(`unexpected Zotero call: ${name}`);
      },
    });

    assert.deepEqual(result.candidates.map((item) => item.itemKey), ["K1"]);
    assert.equal(result.scanStats.local_zotero_index_used, true);
    assert.equal(result.scanStats.items_scanned, 2);
    assert.equal(result.scanStats.items_missing_shorttitle, 1);
    assert.deepEqual(calls, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Stage3 pool scan reads through contract wrappers when local index is unavailable", async () => {
  const calls = [];
  const result = await collectExistingItemsMissingShortTitle("POOL", new Set(), {
    now: new Date("2026-07-07T00:00:00Z"),
    windowDays: 14,
    localIndexPath: path.join(os.tmpdir(), "missing-stage3-index.json"),
    zoteroBackend: {
      async getSubcollections(collectionKey, recursive, options) {
        calls.push({ tool: "getSubcollections", collectionKey, recursive, stage: options.stage });
        return [
          {
            key: "MONTH",
            name: "26.07",
            subcollections: [
              { key: "DATE", name: "07.07", subcollections: [{ key: "GRADE", name: "A课题相关" }] },
            ],
          },
        ];
      },
      async getCollectionItems(collectionKey, options) {
        calls.push({ tool: "getCollectionItems", collectionKey, stage: options.stage });
        return collectionKey === "GRADE" ? [{ key: "K1" }] : [];
      },
      async getItems(itemKeys, options) {
        calls.push({ tool: "getItems", itemKeys, stage: options.stage });
        return { items: [{ key: "K1", data: { key: "K1", title: "Needs translation", shortTitle: "" } }], failed: [] };
      },
    },
  });

  assert.deepEqual(result.candidates.map((item) => item.itemKey), ["K1"]);
  assert.equal(result.scanStats.items_missing_shorttitle, 1);
  assert.deepEqual(calls.map((call) => call.tool), ["getSubcollections", "getCollectionItems", "getItems"]);
});

test("Stage3 pool scan falls back to legacy read tools when contract methods are absent", async () => {
  const calls = [];
  const callZotero = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === "get_subcollections") {
      return { content: [{ text: JSON.stringify([
        {
          key: "MONTH",
          name: "26.07",
          subcollections: [
            { key: "DATE", name: "07.07", subcollections: [{ key: "GRADE", name: "B专题相关" }] },
          ],
        },
      ]) }] };
    }
    if (tool === "get_collection_items") return { content: [{ text: JSON.stringify([{ key: "K2" }]) }] };
    if (tool === "get_item_details") return { content: [{ text: JSON.stringify({ key: "K2", data: { title: "Needs fallback", shortTitle: "" } }) }] };
    throw new Error(`unexpected tool: ${tool}`);
  };

  const result = await collectExistingItemsMissingShortTitle("POOL", new Set(), {
    now: new Date("2026-07-07T00:00:00Z"),
    windowDays: 14,
    localIndexPath: path.join(os.tmpdir(), "missing-stage3-index.json"),
    zoteroBackendCall: callZotero,
  });

  assert.deepEqual(result.candidates.map((item) => item.itemKey), ["K2"]);
  assert.deepEqual(calls.map((call) => call.tool), ["get_subcollections", "get_collection_items", "get_item_details"]);
});

test("local Zotero index incremental update stores shortTitle", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zotero-index-update-"));
  const localIndexPath = path.join(dir, "current_library_index.json");
  try {
    await writeZoteroLibraryIndex(localIndexPath, {
      schema_version: 1,
      live_items: {
        K1: { itemKey: "K1", title: "Needs translation", collections: [], collection_roles: [] },
      },
      tombstones: {},
    });

    const update = await updateZoteroLibraryIndexItems(localIndexPath, {
      K1: { shortTitle: "中文标题" },
      MISSING: { shortTitle: "ignored" },
    }, { generatedAt: "2026-07-07T00:00:00.000Z" });
    const read = await readZoteroLibraryIndex(localIndexPath);

    assert.equal(update.ok, true);
    assert.equal(update.updated_count, 1);
    assert.equal(read.index.live_items.K1.shortTitle, "中文标题");
    assert.equal(read.index.stats.last_incremental_update_count, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
