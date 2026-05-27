import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, "../..");
const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, "config", "preference_learning.config.json");
const DEFAULT_PROMPT_PATH = path.join(REPO_ROOT, "prompts", "preference_learning.md");

const DEFAULT_CONFIG = {
  model: "your-model-name",
  temperature: 0.3,
  top_p: 0.85,
  stream: false,
  thinking: false,
  timeout_ms: 30000,
  max_retries: 2,
  max_output_tokens: 3000,
  response_format: "json_schema",
  prompt_file: "prompts/preference_learning.md",
  api_key_env_fallback_order: ["PREFERENCE_LEARNING_API_KEY", "TITLE_TRANSLATION_API_KEY"],
};

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function coerceNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return fallback;
  if (n > max) return max;
  return n;
}

function coerceInteger(value, fallback, { min = 1, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const integer = Math.floor(n);
  if (integer < min) return fallback;
  if (integer > max) return max;
  return integer;
}

function coerceBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function resolvePromptPath(configPath, promptFile) {
  const raw = String(promptFile || "").trim();
  if (!raw) return DEFAULT_PROMPT_PATH;
  if (path.isAbsolute(raw)) return path.resolve(raw);
  const repoRelative = path.resolve(REPO_ROOT, raw);
  if (fileExists(repoRelative)) return repoRelative;
  const configRelative = path.resolve(path.dirname(configPath), raw);
  if (fileExists(configRelative)) return configRelative;
  return repoRelative;
}

export function getPreferenceLearningConfig({ env = process.env } = {}) {
  const configPath = env.PREFERENCE_LEARNING_CONFIG_PATH
    ? path.resolve(env.PREFERENCE_LEARNING_CONFIG_PATH)
    : DEFAULT_CONFIG_PATH;
  const fileConfig = readJsonFile(configPath) || {};
  const promptFile = env.PREFERENCE_LEARNING_PROMPT_FILE
    || fileConfig.prompt_file
    || DEFAULT_CONFIG.prompt_file;
  const promptPath = resolvePromptPath(configPath, promptFile);
  const fallbackOrder = Array.isArray(fileConfig.api_key_env_fallback_order)
    ? fileConfig.api_key_env_fallback_order
    : DEFAULT_CONFIG.api_key_env_fallback_order;
  const keyEnvName = fallbackOrder.find((name) => String(env[name] || "").trim()) || "";

  return {
    configPath,
    endpoint: (() => {
      const raw = String(env.PREFERENCE_LEARNING_ENDPOINT || fileConfig.endpoint || env.TITLE_TRANSLATION_ENDPOINT || "https://your-api-endpoint.com/v1/chat/completions");
      return raw.replace(/\/+$/, "").toLowerCase().endsWith("/chat/completions") ? raw : `${raw.replace(/\/+$/, "")}/chat/completions`;
    })(),
    model: String(env.PREFERENCE_LEARNING_MODEL || fileConfig.model || DEFAULT_CONFIG.model),
    temperature: coerceNumber(env.PREFERENCE_LEARNING_TEMPERATURE ?? fileConfig.temperature, DEFAULT_CONFIG.temperature),
    top_p: coerceNumber(env.PREFERENCE_LEARNING_TOP_P ?? fileConfig.top_p, DEFAULT_CONFIG.top_p, { min: 0, max: 1 }),
    stream: coerceBoolean(env.PREFERENCE_LEARNING_STREAM ?? fileConfig.stream, DEFAULT_CONFIG.stream),
    thinking: coerceBoolean(env.PREFERENCE_LEARNING_THINKING ?? fileConfig.thinking, DEFAULT_CONFIG.thinking),
    timeout_ms: coerceInteger(env.PREFERENCE_LEARNING_TIMEOUT_MS ?? fileConfig.timeout_ms, DEFAULT_CONFIG.timeout_ms, { min: 1000, max: 120_000 }),
    max_retries: coerceInteger(env.PREFERENCE_LEARNING_MAX_RETRIES ?? fileConfig.max_retries, DEFAULT_CONFIG.max_retries, { min: 0, max: 20 }),
    max_output_tokens: coerceInteger(env.PREFERENCE_LEARNING_MAX_OUTPUT_TOKENS ?? fileConfig.max_output_tokens, DEFAULT_CONFIG.max_output_tokens, { min: 256, max: 20000 }),
    response_format: String(fileConfig.response_format || DEFAULT_CONFIG.response_format),
    promptFile: promptPath,
    promptTemplate: fileExists(promptPath) ? fs.readFileSync(promptPath, "utf8") : "",
    api_key_env_fallback_order: fallbackOrder,
    apiKeyConfigured: Boolean(keyEnvName),
    apiKeyEnvName: keyEnvName,
    apiKey: keyEnvName ? String(env[keyEnvName] || "") : "",
  };
}

export function renderPreferenceLearningPrompt(template, payload) {
  return String(template || "").replaceAll("${inputJson}", JSON.stringify(payload, null, 2));
}

function normalizeJsonText(text = "") {
  return String(text || "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

export function parsePreferenceLearningJson(text) {
  const cleaned = normalizeJsonText(text);
  if (!cleaned) throw new Error("empty_llm_response");
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
    throw new Error("invalid_json");
  }
}

function arrayOfStrings(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function validatePreferenceLearningOutput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "llm_output_not_object" };
  }
  if (!arrayOfStrings(value.rules_added)) return { ok: false, reason: "rules_added_invalid" };
  if (!arrayOfStrings(value.rules_deleted)) return { ok: false, reason: "rules_deleted_invalid" };
  if (!Array.isArray(value.rules_changed)) return { ok: false, reason: "rules_changed_invalid" };
  if (!value.keywords_added || typeof value.keywords_added !== "object" || Array.isArray(value.keywords_added)) {
    return { ok: false, reason: "keywords_added_invalid" };
  }
  for (const key of ["required", "optional", "negative"]) {
    if (!Array.isArray(value.keywords_added[key])) return { ok: false, reason: `keywords_added_${key}_invalid` };
  }
  if (!arrayOfStrings(value.keywords_removed)) return { ok: false, reason: "keywords_removed_invalid" };
  if (!arrayOfStrings(value.negative_keywords_added)) return { ok: false, reason: "negative_keywords_added_invalid" };
  if (!arrayOfStrings(value.unmapped_feedback)) return { ok: false, reason: "unmapped_feedback_invalid" };
  return { ok: true, reason: "" };
}

export function hasConcretePreferenceLearningChanges(value = {}) {
  return Boolean(
    value.rules_added?.length
    || value.rules_deleted?.length
    || value.rules_changed?.length
    || value.keywords_added?.required?.length
    || value.keywords_added?.optional?.length
    || value.keywords_added?.negative?.length
    || value.keywords_removed?.length
    || value.negative_keywords_added?.length
  );
}

async function fetchPreferenceLearning(runtime, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("preference_learning_timeout")), runtime.timeout_ms);
  try {
    const thinking = runtime.thinking && typeof runtime.thinking === "object"
      ? runtime.thinking
      : runtime.thinking
        ? { type: "enabled" }
        : { type: "disabled" };
    const res = await fetch(runtime.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.apiKey}`,
      },
      body: JSON.stringify({
        model: runtime.model,
        temperature: runtime.temperature,
        top_p: runtime.top_p,
        stream: false,
        thinking,
        max_output_tokens: runtime.max_output_tokens,
        response_format: runtime.response_format === "json_schema" ? { type: "json_object" } : undefined,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      const err = new Error(`HTTP_${res.status}${t ? `:${t.slice(0, 180)}` : ""}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? data?.output_text ?? data?.text ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

export async function understandPreferenceEvaluation(payload, { runtime = getPreferenceLearningConfig(), llmClient = null } = {}) {
  if (!runtime.apiKeyConfigured && !llmClient) {
    return { ok: false, blocker: "missing_preference_learning_api_key", output: null, raw_text: "" };
  }
  const prompt = renderPreferenceLearningPrompt(runtime.promptTemplate, payload);
  const maxRetries = Math.max(0, Number(runtime.max_retries || 0));
  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const raw = llmClient ? await llmClient(payload, runtime) : await fetchPreferenceLearning(runtime, prompt);
      const output = typeof raw === "string" ? parsePreferenceLearningJson(raw) : raw;
      const validation = validatePreferenceLearningOutput(output);
      if (!validation.ok) return { ok: false, blocker: "llm_output_invalid", validation_reason: validation.reason, output, raw_text: typeof raw === "string" ? raw : JSON.stringify(raw) };
      if (!hasConcretePreferenceLearningChanges(output)) {
        return { ok: false, blocker: "no_confirmed_modifications", output, raw_text: typeof raw === "string" ? raw : JSON.stringify(raw) };
      }
      return { ok: true, blocker: "", output, raw_text: typeof raw === "string" ? raw : JSON.stringify(raw) };
    } catch (error) {
      lastError = String(error?.message || error);
      const status = Number(error?.status || 0);
      const retryable = status === 429 || status >= 500 || /timeout|abort/i.test(lastError);
      if (!retryable || attempt >= maxRetries) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }
  return { ok: false, blocker: "llm_unavailable", error: lastError, output: null, raw_text: "" };
}

