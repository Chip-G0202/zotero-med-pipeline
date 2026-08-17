import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REQUEST_CONCURRENCY,
  MAX_REQUEST_CONCURRENCY,
  ZoteroWebApiBackend,
  mapWithConcurrency,
  resolveWebApiRequestConcurrency,
} from "../tools/lib/zotero_web_api_backend.mjs";

const delay = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

test("web api concurrency config defaults and clamps safely", () => {
  assert.equal(DEFAULT_REQUEST_CONCURRENCY, 4);
  assert.equal(MAX_REQUEST_CONCURRENCY, 4);
  assert.equal(resolveWebApiRequestConcurrency(undefined), 4);
  assert.equal(resolveWebApiRequestConcurrency("2"), 2);
  assert.equal(resolveWebApiRequestConcurrency(0), 4);
  assert.equal(resolveWebApiRequestConcurrency(-1), 4);
  assert.equal(resolveWebApiRequestConcurrency("bad"), 4);
  assert.equal(resolveWebApiRequestConcurrency(999), 4);
});

test("mapWithConcurrency preserves order, bounds peaks, propagates errors, and handles empty input", async () => {
  let active = 0;
  let peak = 0;
  const values = await mapWithConcurrency([3, 2, 1], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await delay(value);
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(values, [6, 4, 2]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapWithConcurrency([], 2, async () => assert.fail("empty input called mapper")), []);
  assert.deepEqual(await mapWithConcurrency([1], 4, async (value) => value), [1]);
  await assert.rejects(() => mapWithConcurrency([1, 2], 1, async (value) => {
    if (value === 2) throw new Error("task_failed");
    return value;
  }), /task_failed/);
});

test("getItemsDetails respects configured concurrency", async () => {
  const backend = new ZoteroWebApiBackend({ userId: "u", apiKey: "k", requestConcurrency: 3 });
  let active = 0;
  let peak = 0;
  let requests = 0;
  backend._request = async (method, path) => {
    requests += 1;
    if (method === "GET") {
      active += 1;
      peak = Math.max(peak, active);
      await delay();
      active -= 1;
      const key = path.split("/").at(-1);
      return { data: { key, version: 1, data: { collections: [] } } };
    }
    return { data: null, lastModifiedVersion: 2 };
  };
  assert.deepEqual(await backend.getItemsDetails([]), []);
  assert.equal(requests, 0);
  assert.deepEqual((await backend.getItemsDetails(["ONLY"])).map((item) => item.key), ["ONLY"]);
  assert.equal(peak, 1);

  peak = 0;
  const keys = ["K1", "K2", "K3", "K4", "K5", "K6"];
  const details = await backend.getItemsDetails(keys);
  assert.deepEqual(details.map((item) => item.key), keys);
  assert.equal(peak, 3);
});

test("collection attach bounds detail reads and preserves partial failures", async () => {
  const backend = new ZoteroWebApiBackend({ userId: "u", apiKey: "k", requestConcurrency: 2 });
  let active = 0;
  let peak = 0;
  backend._request = async (method, path, body) => {
    if (method === "GET") {
      const key = path.split("/").at(-1);
      active += 1;
      peak = Math.max(peak, active);
      await delay();
      active -= 1;
      if (key === "K3") throw new Error("read_failed");
      return { data: { key, version: 1, data: { collections: [] } } };
    }
    return { data: { successful: Object.fromEntries(body.map((item, index) => [index, { key: item.key }])) } };
  };
  const result = await backend.addItemsToCollection(["K1", "K2", "K3", "K4"], "COLL", { verify: false });
  assert.equal(peak, 2);
  assert.deepEqual(result.added, ["K1", "K2", "K4"]);
  assert.deepEqual(result.failed, [{ itemKey: "K3", error: "fetch_failed: read_failed" }]);
});

test("multi-collection attach reads shared items once and writes each final union once", async () => {
  const backend = new ZoteroWebApiBackend({ userId: "u", apiKey: "k", requestConcurrency: 2 });
  const reads = new Map();
  const patchBodies = [];
  backend._request = async (method, path, body) => {
    if (method === "GET") {
      const itemKey = path.split("/").at(-1);
      reads.set(itemKey, (reads.get(itemKey) || 0) + 1);
      return {
        data: {
          key: itemKey,
          version: 7,
          data: { collections: itemKey === "K1" ? ["EXISTING"] : [] },
        },
      };
    }
    assert.equal(method, "PATCH");
    assert.equal(path, "/items");
    patchBodies.push(body);
    return {
      data: { successful: Object.fromEntries(body.map((item, index) => [index, { key: item.key }])) },
    };
  };

  const result = await backend.addItemsToCollections([
    { collectionKey: "SRC", itemKeys: ["K1", "K2", "K1"] },
    { collectionKey: "GRADE", itemKeys: ["K1"] },
  ], { verify: false });

  assert.deepEqual(Object.fromEntries(reads), { K1: 1, K2: 1 });
  assert.equal(patchBodies.length, 1);
  assert.deepEqual(patchBodies[0], [
    { key: "K1", version: 7, collections: ["EXISTING", "SRC", "GRADE"] },
    { key: "K2", version: 7, collections: ["SRC"] },
  ]);
  assert.deepEqual(result.added, [
    { itemKey: "K1", collectionKey: "SRC" },
    { itemKey: "K1", collectionKey: "GRADE" },
    { itemKey: "K2", collectionKey: "SRC" },
  ]);
  assert.deepEqual(result.already, []);
  assert.deepEqual(result.failed, []);
});

test("multi-collection attach preserves association failures and optional verification", async () => {
  const backend = new ZoteroWebApiBackend({ userId: "u", apiKey: "k", requestConcurrency: 2 });
  backend._request = async (method, path, body) => {
    if (method === "GET") {
      const itemKey = path.split("/").at(-1);
      if (itemKey === "K1") throw new Error("read_failed");
      return { data: { key: itemKey, version: 3, data: { collections: ["SRC"] } } };
    }
    return { data: { successful: Object.fromEntries(body.map((item, index) => [index, { key: item.key }])) } };
  };
  const verified = [];
  backend.verifyItemsInCollection = async (itemKeys, collectionKey) => {
    verified.push({ itemKeys, collectionKey });
    return { present: collectionKey === "SRC" ? itemKeys : [], missing: collectionKey === "GRADE" ? itemKeys : [] };
  };

  const result = await backend.addItemsToCollections([
    { collectionKey: "SRC", itemKeys: ["K1", "K2"] },
    { collectionKey: "GRADE", itemKeys: ["K1", "K2"] },
  ]);

  assert.deepEqual(result.already, [{ itemKey: "K2", collectionKey: "SRC" }]);
  assert.deepEqual(result.failed, [
    { itemKey: "K1", collectionKey: "SRC", error: "fetch_failed: read_failed" },
    { itemKey: "K1", collectionKey: "GRADE", error: "fetch_failed: read_failed" },
    { itemKey: "K2", collectionKey: "GRADE", error: "Verification failed: item not in collection" },
  ]);
  assert.deepEqual(verified, [
    { itemKeys: ["K2"], collectionKey: "SRC" },
    { itemKeys: ["K2"], collectionKey: "GRADE" },
  ]);
});

test("429 retries remain inside the concurrency limit", async () => {
  const backend = new ZoteroWebApiBackend({ userId: "u", apiKey: "k", requestConcurrency: 2, retries: 2, intervalMs: 1 });
  const attempts = new Map();
  let active = 0;
  let peak = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    active += 1;
    peak = Math.max(peak, active);
    await delay(2);
    active -= 1;
    const key = String(url).split("/").at(-1);
    const attempt = (attempts.get(key) || 0) + 1;
    attempts.set(key, attempt);
    if (attempt === 1) {
      return { ok: false, status: 429, headers: new Map([["Retry-After", "0"]]), text: async () => "" };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map([["Content-Type", "application/json"]]),
      json: async () => ({ key, version: 1, data: { collections: [] } }),
      text: async () => "",
    };
  };
  try {
    const keys = ["K1", "K2", "K3", "K4"];
    const details = await backend.getItemsDetails(keys);
    assert.deepEqual(details.map((item) => item.key), keys);
    assert.equal(peak, 2);
    assert.deepEqual([...attempts.values()], [2, 2, 2, 2]);
    assert.equal(backend._stats.rateLimitCount, 4);
    assert.equal(backend.getConcurrencySnapshot().current_concurrency, 1);
    assert.ok(backend.getConcurrencySnapshot().peak_concurrency <= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
