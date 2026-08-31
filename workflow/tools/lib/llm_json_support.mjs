import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { parseServerDelayMs } from "./adaptive_concurrency.mjs";
import { getPreferenceLearningConfig } from "./preference_learning_support.mjs";

export const LLM_JSON_PROMPT_VERSION = "llm-json-v1";

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashInput(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

export function hashText(value = "") {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

export function normalizeJsonText(text = "") {
  return String(text || "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function repairMissingValueCommas(text = "") {
  let out = "";
  let inString = false;
  let escaped = false;
  let prevSignificant = "";
  const startsValue = (ch) => ch === "\"" || ch === "{" || ch === "[" || ch === "-" || /[0-9tfn]/.test(ch);
  const endsValue = (ch) => ch === "\"" || ch === "}" || ch === "]" || /[0-9eEl]/.test(ch);

  for (const ch of String(text || "")) {
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
        prevSignificant = ch;
      }
      continue;
    }

    if (ch === "\"") {
      if (prevSignificant && endsValue(prevSignificant)) out += ",";
      inString = true;
      out += ch;
      continue;
    }

    if (!/\s/.test(ch)) {
      if (prevSignificant && startsValue(ch) && endsValue(prevSignificant)) out += ",";
      prevSignificant = ch;
    }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

function extractJsonParseOffset(error) {
  const raw = String(error?.message || error || "");
  const match = raw.match(/\bposition\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

export function parseJsonOnlyWithInfo(text) {
  const cleaned = normalizeJsonText(text);
  if (!cleaned) {
    const err = new Error("empty_llm_response");
    err.code = "llm_json_parse_failed";
    err.raw_response_length = 0;
    err.raw_response_hash = hashText("");
    throw err;
  }
  const candidates = [cleaned];
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));

  let parseError = null;
  for (const candidate of candidates) {
    try {
      return { value: JSON.parse(candidate), repaired: false, parse_error_summary: "" };
    } catch (error) {
      parseError = error;
    }
    const repaired = repairMissingValueCommas(candidate);
    if (repaired !== candidate) {
      try {
        return {
          value: JSON.parse(repaired),
          repaired: true,
          parse_error_summary: parseError?.message || "invalid_json",
          parse_error_offset: extractJsonParseOffset(parseError),
        };
      } catch (error) {
        parseError = error;
      }
    }
  }

  const err = new Error(parseError?.message || "invalid_json");
  err.code = "llm_json_parse_failed";
  err.raw_response_length = cleaned.length;
  err.raw_response_hash = hashText(cleaned);
  err.parse_error_offset = extractJsonParseOffset(parseError);
  throw err;
}

export function parseJsonOnly(text) {
  return parseJsonOnlyWithInfo(text).value;
}

function summarizeError(value, maxLength = 220) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function resolveLlmRuntime({ env = process.env } = {}) {
  const runtime = getPreferenceLearningConfig({ env });
  return {
    ...runtime,
    llm_mode: String(env.LLM_MODE || runtime.llm_mode || "real").trim().toLowerCase(),
    max_output_tokens: Number(runtime.max_output_tokens || 3000),
    stream: false,
    source: runtime.apiKeyEnvName === "TITLE_TRANSLATION_API_KEY" ? "title_translation_api" : "preference_learning_api",
  };
}

function mockOutputForTask(taskType, input = {}) {
  if (taskType === "grade_review") {
    const items = Array.isArray(input.items) ? input.items : [];
    return {
      items: items.map((item) => ({
        id: String(item.id || ""),
        title: String(item.title || ""),
        rule_grade: String(item.rule_grade || "").slice(0, 1).toUpperCase(),
        llm_review_grade: String(item.rule_grade || "").slice(0, 1).toUpperCase() || "C",
        confidence: "low",
        reason: "mock LLM mode: keep rule grade",
        evidence_terms: [],
        recognized_concepts: [],
        needs_human_review: false,
      })),
      warnings: ["mock_llm_response"],
    };
  }
  if (taskType === "preference_learning") {
    return {
      preference_summary: { mode: "mock" },
      preference_themes: [],
      suggestion_candidates: [],
      warnings: ["mock_llm_response"],
    };
  }
  return {
    rules_added: [],
    rules_deleted: [],
    rules_changed: [],
    keywords_added: { required: [], optional: [], negative: [] },
    keywords_removed: [],
    negative_keywords_added: [],
    unmapped_feedback: [],
    warnings: ["mock_llm_response"],
  };
}

async function readCache(cachePath) {
  if (!cachePath) return {};
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    return {};
  }
}

async function writeCache(cachePath, cache) {
  if (!cachePath) return;
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), "utf8");
}

function describeRawResponse(raw) {
  const rawText = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
  return {
    raw_response_length: rawText.length,
    raw_response_hash: hashText(rawText),
  };
}

export function buildLlmCacheKey({ taskType, promptVersion = LLM_JSON_PROMPT_VERSION, runtime = {}, input }) {
  const modelConfig = [
    runtime.model || "",
    runtime.endpoint || "",
    runtime.temperature ?? "",
    runtime.top_p ?? "",
    runtime.max_output_tokens ?? "",
  ].join("|");
  return hashInput({ taskType, promptVersion, modelConfig, inputHash: hashInput(input) });
}

async function fetchJsonCompletion(runtime, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("llm_json_timeout")), Number(runtime.timeout_ms || 30000));
  try {
    const thinking = runtime.thinking && typeof runtime.thinking === "object"
      ? runtime.thinking
      : runtime.thinking
        ? { type: "enabled" }
        : { type: "disabled" };
    const body = {
      temperature: Number(runtime.temperature ?? 0),
      top_p: Number(runtime.top_p ?? 1),
      stream: false,
      thinking,
      max_tokens: Number(runtime.max_output_tokens || 3000),
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    };
    if (String(runtime.user_id || "").trim()) body.user_id = String(runtime.user_id).trim();
    if (String(runtime.model || "").trim()) body.model = runtime.model;
    const res = await fetch(runtime.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`HTTP_${res.status}${text ? `:${text.slice(0, 180)}` : ""}`);
      err.status = res.status;
      err.retryAfterMs = parseServerDelayMs(res.headers.get("Retry-After"));
      err.backoffMs = parseServerDelayMs(res.headers.get("Backoff"));
      throw err;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? data?.output_text ?? data?.text ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

export async function callJsonLlm({
  taskType,
  prompt,
  input,
  runtime = resolveLlmRuntime(),
  cachePath = "",
  cacheEnabled = true,
  llmClient = null,
  concurrencyController = null,
} = {}) {
  const llmMode = String(runtime.llm_mode || "real").trim().toLowerCase();
  if (llmMode === "disabled") {
    return {
      ok: false,
      skipped: true,
      blocker: "llm_disabled",
      warnings: ["llm_disabled"],
      cache_hit: false,
      request_would_have_been_sent: false,
      real_request_sent: false,
    };
  }
  if (llmMode === "mock") {
    const output = mockOutputForTask(taskType, input);
    const responseMetadata = describeRawResponse(output);
    return {
      ok: true,
      skipped: false,
      output,
      ...responseMetadata,
      cache_hit: false,
      cache_key: buildLlmCacheKey({ taskType, runtime, input }),
      model: "mock",
      endpoint: "mock://llm",
      api_key_source: "",
      request_would_have_been_sent: false,
      real_request_sent: false,
      mock_response_used: true,
    };
  }
  if (!runtime.apiKeyConfigured && !llmClient) {
    return { ok: false, skipped: true, blocker: "missing_llm_api_key", warnings: ["missing_llm_api_key"], cache_hit: false, request_would_have_been_sent: false, real_request_sent: false };
  }
  const cacheKey = buildLlmCacheKey({ taskType, runtime, input });
  if (cacheEnabled && cachePath) {
    const cache = await readCache(cachePath);
    if (cache[cacheKey]) {
      return {
        ...cache[cacheKey],
        cache_hit: true,
        cache_key: cacheKey,
        request_would_have_been_sent: false,
        real_request_sent: false,
        cached_real_request_sent: Boolean(cache[cacheKey]?.real_request_sent),
      };
    }
  }

  const maxRetries = Math.max(0, Number(runtime.max_retries || 0));
  let lastError = "";
  let lastErrorType = "";
  let lastParseErrorSummary = "";
  let lastParseErrorOffset = null;
  let lastRawResponseLength = null;
  let lastRawResponseHash = "";
  let requestWouldHaveBeenSent = false;
  let realRequestSent = false;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let raw = "";
    try {
      requestWouldHaveBeenSent = true;
      if (!llmClient) realRequestSent = true;
      raw = llmClient ? await llmClient(input, runtime) : await fetchJsonCompletion(runtime, prompt);
      const responseMetadata = describeRawResponse(raw);
      lastRawResponseLength = responseMetadata.raw_response_length;
      lastRawResponseHash = responseMetadata.raw_response_hash;
      const parsed = typeof raw === "string" ? parseJsonOnlyWithInfo(raw) : { value: raw, repaired: false, parse_error_summary: "" };
      const result = {
        ok: true,
        skipped: false,
        output: parsed.value,
        ...responseMetadata,
        json_repaired: Boolean(parsed.repaired),
        parse_error_summary: parsed.repaired ? summarizeError(parsed.parse_error_summary) : "",
        parse_error_offset: Number.isFinite(Number(parsed.parse_error_offset)) ? Number(parsed.parse_error_offset) : null,
        cache_hit: false,
        cache_key: cacheKey,
        model: runtime.model || "",
        endpoint: runtime.endpoint || "",
        api_key_source: runtime.apiKeyEnvName || "",
        request_would_have_been_sent: true,
        real_request_sent: !llmClient,
      };
      if (cacheEnabled && cachePath) {
        const cache = await readCache(cachePath);
        cache[cacheKey] = result;
        await writeCache(cachePath, cache);
      }
      return result;
    } catch (error) {
      concurrencyController?.recordFailure(error);
      lastError = String(error?.message || error);
      lastErrorType = error?.code === "llm_json_parse_failed" ? "llm_json_parse_failed" : "llm_request_failed";
      if (lastErrorType === "llm_json_parse_failed") {
        lastParseErrorSummary = summarizeError(lastError);
        lastParseErrorOffset = Number.isFinite(Number(error?.parse_error_offset)) ? Number(error.parse_error_offset) : null;
        lastRawResponseLength = Number.isFinite(Number(error?.raw_response_length))
          ? Number(error.raw_response_length)
          : lastRawResponseLength;
        lastRawResponseHash = String(error?.raw_response_hash || lastRawResponseHash || "");
      }
      const status = Number(error?.status || 0);
      const retryable = status === 429 || status >= 500 || /timeout|abort/i.test(lastError);
      if (!retryable || attempt >= maxRetries) break;
      const localDelay = 500 * (2 ** attempt);
      const serverDelay = Math.max(Number(error?.retryAfterMs || 0), Number(error?.backoffMs || 0));
      await new Promise((resolve) => setTimeout(resolve, Math.max(serverDelay, localDelay)));
    }
  }
  return {
    ok: false,
    skipped: false,
    blocker: lastErrorType === "llm_json_parse_failed" ? "llm_json_failed" : "llm_request_failed",
    error: lastError,
    error_type: lastErrorType,
    parse_error_summary: lastParseErrorSummary,
    parse_error_offset: lastParseErrorOffset,
    raw_response_length: lastRawResponseLength,
    raw_response_hash: lastRawResponseHash,
    warnings: [lastError].filter(Boolean),
    cache_hit: false,
    cache_key: cacheKey,
    request_would_have_been_sent: requestWouldHaveBeenSent,
    real_request_sent: realRequestSent,
  };
}
