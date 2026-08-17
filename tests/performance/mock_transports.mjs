import { itemKey } from "./fixture_workload.mjs";

function parseScriptConstant(script, name) {
  const marker = `const ${name} = `;
  const start = String(script).indexOf(marker);
  if (start < 0) return null;
  const valueStart = start + marker.length;
  const end = String(script).indexOf(";", valueStart);
  if (end < 0) return null;
  try { return JSON.parse(String(script).slice(valueStart, end)); } catch { return null; }
}

export function createMetrics() {
  return {
    http: { total: 0, read: 0, write: 0 },
    zotero: { total: 0, read: 0, write: 0 },
    retryCount: 0, status429: 0, retryAfterCount: 0, backoffCount: 0,
    active: 0, peakConcurrency: 0,
  };
}

function begin(metrics, method) {
  metrics.active += 1;
  metrics.peakConcurrency = Math.max(metrics.peakConcurrency, metrics.active);
  metrics.zotero.total += 1;
  metrics.zotero[/^(GET|HEAD)$/.test(method) ? "read" : "write"] += 1;
}

function end(metrics) { metrics.active -= 1; }

export function createCliExecutor(seed, metrics) {
  const items = new Map(Object.entries(seed.items || {}));
  const collections = new Map(Object.entries(seed.collections || {}).map(([key, values]) => [key, new Set(values)]));
  const executeCli = async (_tool, args, options = {}) => {
    const method = String(args?.[0] || "").includes("get") || String(args?.[1] || "").includes("find") ? "GET" : "POST";
    begin(metrics, method);
    try {
      const script = String(options.stdin || (args?.[0] === "js" ? args[1] : ""));
      const inputs = parseScriptConstant(script, "inputs");
      if (Array.isArray(inputs)) {
        const created = inputs.map((input) => {
          const key = input.key || itemKey({ doi: input.DOI, title: input.title });
          items.set(key, { key, version: 1, data: { ...input, key, collections: [] } });
          return { key, itemKey: key, ...input };
        });
        return { exitCode: 0, stdout: "", stderr: "", data: { created, failed: [] } };
      }
      const operations = parseScriptConstant(script, "operations");
      if (Array.isArray(operations)) {
        const added = [];
        for (const operation of operations) {
          const set = collections.get(operation.collectionKey) || new Set();
          collections.set(operation.collectionKey, set);
          for (const key of operation.itemKeys || []) {
            set.add(key); added.push(key);
            const item = items.get(key);
            if (item && !item.data.collections.includes(operation.collectionKey)) item.data.collections.push(operation.collectionKey);
          }
        }
        return { exitCode: 0, stdout: "", stderr: "", data: { added, already: [], failed: [] } };
      }
      const updates = parseScriptConstant(script, "updates");
      if (Array.isArray(updates)) {
        for (const update of updates) {
          const item = items.get(update.itemKey);
          if (item) { Object.assign(item.data, update.fields); item.version += 1; }
        }
        return { exitCode: 0, stdout: "", stderr: "", data: { updated: updates.map((entry) => entry.itemKey), failed: [] } };
      }
      const keys = parseScriptConstant(script, "itemKeys");
      if (Array.isArray(keys)) return { exitCode: 0, stdout: "", stderr: "", data: keys.map((key) => items.get(key)).filter(Boolean) };
      return { exitCode: 0, stdout: "", stderr: "", data: {} };
    } finally { end(metrics); }
  };
  return { executeCli, items, collections };
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Last-Modified-Version": "2", ...headers } });
}

export function createWebFetch(seed, metrics) {
  const items = new Map(Object.entries(seed.items || {}));
  const collections = new Map(Object.entries(seed.collections || {}).map(([key, values]) => [key, new Set(values)]));
  const fetchImpl = async (input, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    begin(metrics, method);
    metrics.http.total += 1;
    metrics.http[/^(GET|HEAD)$/.test(method) ? "read" : "write"] += 1;
    try {
      await Promise.resolve();
      const url = new URL(String(input));
      const relative = url.pathname.replace(/^\/users\/[^/]+/, "");
      if (method === "GET" && /^\/items\/[^/]+$/.test(relative)) {
        const key = relative.split("/").at(-1);
        return jsonResponse(items.get(key) || {}, items.has(key) ? 200 : 404);
      }
      if (method === "GET" && relative === "/items" && url.searchParams.has("itemKey")) {
        const keys = url.searchParams.get("itemKey").split(",");
        return jsonResponse(keys.map((key) => items.get(key)).filter(Boolean));
      }
      if (method === "GET" && /^\/collections\/[^/]+\/items$/.test(relative)) {
        const collectionKey = relative.split("/")[2];
        const offset = Math.max(0, Number(url.searchParams.get("start") || url.searchParams.get("offset") || 0));
        const limit = Math.max(1, Number(url.searchParams.get("limit") || 100));
        return jsonResponse([...(collections.get(collectionKey) || [])].slice(offset, offset + limit).map((key) => items.get(key)).filter(Boolean));
      }
      if ((method === "PATCH" || method === "POST") && relative === "/items") {
        const body = JSON.parse(String(init.body || "[]"));
        const successful = {};
        for (const [index, entry] of body.entries()) {
          if (entry.key && items.has(entry.key)) {
            const item = items.get(entry.key);
            Object.assign(item.data, entry);
            item.version += 1;
            for (const set of collections.values()) set.delete(entry.key);
            for (const key of entry.collections || item.data.collections || []) {
              const set = collections.get(key) || new Set(); set.add(entry.key); collections.set(key, set);
            }
            successful[index] = { key: entry.key, version: item.version };
          } else {
            const key = itemKey({ doi: entry.DOI, title: entry.title });
            items.set(key, { key, version: 1, data: { ...entry, key, collections: entry.collections || [] } });
            successful[index] = { key, version: 1 };
          }
        }
        return jsonResponse({ successful, unchanged: {}, failed: {} });
      }
      return jsonResponse([]);
    } finally { end(metrics); }
  };
  return { fetchImpl, items, collections };
}
