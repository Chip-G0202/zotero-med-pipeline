const DEFAULT_MCP_BASE_URL = process.env.ZOTERO_MCP_BASE_URL || "http://127.0.0.1:23120";

function resolveMcpUrl() {
  const explicit = process.env.ZOTERO_MCP_ENDPOINT || process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "";
  if (explicit) return explicit;
  return `${String(DEFAULT_MCP_BASE_URL).replace(/\/+$/, "")}/mcp`;
}

function parseEnabled(raw) {
  const v = String(raw ?? "false").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on" || v === "auto";
}

function getTimeoutMs() {
  const n = Number(process.env.ZOTERO_SEMANTIC_SEARCH_TIMEOUT_MS || 10000);
  return Number.isFinite(n) && n > 0 ? n : 10000;
}

function getLimit() {
  const n = Number(process.env.ZOTERO_SEMANTIC_SEARCH_LIMIT || 5);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}
function getMinScore() {
  const n = Number(process.env.ZOTERO_SEMANTIC_SEARCH_MIN_SCORE || 0.3);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.3;
}
function getLanguage() {
  const v = String(process.env.ZOTERO_SEMANTIC_SEARCH_LANGUAGE || "all").trim().toLowerCase();
  return v === "zh" || v === "en" || v === "all" ? v : "all";
}

function toResult(sourceSample, query, overrides = {}) {
  return {
    ok: false,
    degraded: true,
    degrade_reason: "semantic_unavailable",
    query,
    source_sample: {
      row_index: sourceSample?.row_index ?? -1,
      feedback: sourceSample?.feedback || "",
      direction: sourceSample?.direction || "ignored",
    },
    results: [],
    status: {
      checked: false,
      ok: null,
      raw: null,
      degraded: true,
      degrade_reason: "semantic_unavailable",
    },
    error: null,
    ...overrides,
  };
}

function unwrapPayload(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  if (Array.isArray(raw.results)) return raw.results;
  if (Array.isArray(raw.items)) return raw.items;
  if (Array.isArray(raw.data)) return raw.data;
  if (raw.result && typeof raw.result === "object") return unwrapPayload(raw.result);
  if (raw.content && Array.isArray(raw.content)) {
    const text = raw.content[0]?.text;
    if (typeof text === "string") {
      try { return unwrapPayload(JSON.parse(text)); } catch { return []; }
    }
  }
  return [];
}

function normalizeSemanticItems(raw) {
  const list = unwrapPayload(raw);
  return list.map((item) => ({
    item_key: item?.itemKey || item?.item_key || item?.key || item?.item?.itemKey || "",
    doi: item?.DOI || item?.doi || item?.item?.DOI || item?.metadata?.doi || "",
    title: item?.title || item?.item?.title || item?.metadata?.title || "",
    creators: item?.creators || item?.authors || item?.item?.creators || item?.metadata?.creators || [],
    year: item?.year || item?.date || item?.item?.date || item?.metadata?.year || "",
    score: Number(item?.score ?? item?.similarity ?? item?.relevance ?? 0) || 0,
    source: item?.source || "zotero_semantic_search",
    raw: item,
  }));
}

export function createZoteroSemanticAdapter({
  fetchImpl = fetch,
  mcpUrl = resolveMcpUrl(),
  enabled = parseEnabled(process.env.ZOTERO_SEMANTIC_PREFERENCE_ENABLED),
  limit = getLimit(),
  minScore = getMinScore(),
  language = getLanguage(),
  timeoutMs = getTimeoutMs(),
  embeddingProviderHint = process.env.ZOTERO_EMBEDDING_PROVIDER_HINT || "ollama",
  modelHint = process.env.ZOTERO_EMBEDDING_MODEL_HINT || "all-minilm",
  dimensionsHint = Number(process.env.ZOTERO_EMBEDDING_DIMENSIONS_HINT || 384) || 384,
} = {}) {
  async function callTool(name, args, id) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name,
          arguments: args,
        },
      };
      const res = await fetchImpl(mcpUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkSemanticStatus() {
    if (!enabled) {
      return { checked: false, ok: null, raw: null, degraded: true, degrade_reason: "semantic_preference_disabled" };
    }
    try {
      const json = await callTool("semantic_status", {}, 859999);
      if (json?.error) {
        const msg = JSON.stringify(json.error);
        const unverified = /unknown tool|not found|tool.*semantic_status|method not found/i.test(msg);
        return { checked: true, ok: false, raw: msg.slice(0, 800), degraded: true, degrade_reason: unverified ? "mcp_tool_unverified" : "semantic_status_unavailable" };
      }
      const raw = json?.result?.content?.[0]?.text || json?.result || null;
      return { checked: true, ok: true, raw, degraded: false, degrade_reason: null };
    } catch (error) {
      const timedOut = String(error?.name || "").toLowerCase().includes("abort");
      return { checked: true, ok: false, raw: String(error?.message || error), degraded: true, degrade_reason: timedOut ? "semantic_status_timeout" : "semantic_status_unavailable" };
    }
  }

  async function semanticSearch(sample) {
    const query = String(sample?.semantic_query || "").trim();
    if (!enabled) {
      return toResult(sample, query, {
        degrade_reason: "semantic_preference_disabled",
        status: { checked: false, ok: null, raw: null, degraded: true, degrade_reason: "semantic_preference_disabled" },
      });
    }
    if (!query) {
      return toResult(sample, query, {
        degrade_reason: "empty_semantic_query",
        status: { checked: false, ok: null, raw: null, degraded: true, degrade_reason: "empty_semantic_query" },
      });
    }
    const status = await checkSemanticStatus();
    if (status.degraded && status.degrade_reason === "mcp_tool_unverified") {
      return toResult(sample, query, {
        degrade_reason: "mcp_tool_unverified",
        status,
      });
    }
    try {
      const json = await callTool("semantic_search", {
        query,
        topK: limit,
        minScore,
        language,
      }, 860000 + Math.max(0, Number(sample?.row_index || 0)));
      if (json?.error) {
        const message = JSON.stringify(json.error);
        const unverified = /unknown tool|not found|tool.*semantic_search|method not found/i.test(message);
        return toResult(sample, query, {
          degrade_reason: unverified ? "mcp_tool_unverified" : "semantic_tool_error",
          error: message,
          status,
        });
      }
      const items = normalizeSemanticItems(json?.result);
      return {
        ok: true,
        degraded: false,
        degrade_reason: null,
        query,
        source_sample: {
          row_index: sample?.row_index ?? -1,
          feedback: sample?.feedback || "",
          direction: sample?.direction || "ignored",
        },
        results: items,
        status,
        error: null,
      };
    } catch (error) {
      const timedOut = String(error?.name || "").toLowerCase().includes("abort");
      return toResult(sample, query, {
        degrade_reason: timedOut ? "semantic_timeout" : "semantic_mcp_unreachable",
        error: String(error?.message || error),
        status: { checked: true, ok: false, raw: String(error?.message || error), degraded: true, degrade_reason: timedOut ? "semantic_timeout" : "semantic_mcp_unreachable" },
      });
    }
  }

  return {
    enabled,
    mcpUrl,
    limit,
    minScore,
    language,
    timeoutMs,
    embeddingProviderHint,
    modelHint,
    dimensionsHint,
    checkSemanticStatus,
    semanticSearch,
  };
}
