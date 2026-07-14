import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveDotEnvPath } from "../tools/lib/env_file_bootstrap.mjs";
import { getPreferenceLearningConfig } from "../tools/lib/preference_learning_support.mjs";
import { getTranslationConfig } from "../tools/lib/title_translation_support.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("translation config defaults to project config root", () => {
  const config = getTranslationConfig({ env: {} });
  assert.equal(config.prompt_file, path.join(repoRoot, "config", "prompt-title-translation.md").replace(/\\/g, "/"));
  assert.equal(config.batchSize ?? config.batch_size, 64);
  assert.equal(config.temperature, 0);
  assert.deepEqual(config.rate_limit, { rpm: 100, tpm: 10000000 });
});

test("preference learning config defaults to project config root", () => {
  const config = getPreferenceLearningConfig({ env: {} });
  assert.equal(config.configPath, path.join(repoRoot, "config", "preference_learning.config.json"));
  assert.equal(config.promptFile, path.join(repoRoot, "config", "prompt-preference-learning.md"));
  assert.equal(config.max_output_tokens, 4000);
  assert.equal(config.temperature, 0.1);
});

test("placeholder translation settings do not enable API calls", () => {
  const config = getTranslationConfig({
    env: {
      TITLE_TRANSLATION_API_KEY: "your_translation_api_key_here",
      TITLE_TRANSLATION_ENDPOINT: "https://your-api-endpoint.com/v1/chat/completions",
      TITLE_TRANSLATION_MODEL: "your-model-name",
    },
  });
  assert.equal(config.apiKeyConfigured, false);
  assert.equal(config.model, "mimo-v2.5");
  assert.equal(config.endpoint, "https://api.xiaomimimo.com/v1/chat/completions");
});

test("placeholder preference learning keys are ignored in fallback order", () => {
  const config = getPreferenceLearningConfig({
    env: {
      PREFERENCE_LEARNING_API_KEY: "your_preference_learning_api_key_here",
      TITLE_TRANSLATION_API_KEY: "your_translation_api_key_here",
      PREFERENCE_LEARNING_ENDPOINT: "https://your-api-endpoint.com/v1/chat/completions",
      PREFERENCE_LEARNING_MODEL: "your-model-name",
    },
  });
  assert.equal(config.apiKeyConfigured, false);
  assert.equal(config.apiKeyEnvName, "");
  assert.equal(config.apiKey, "");
  assert.equal(config.model, "mimo-v2.5");
  assert.equal(config.endpoint, "https://api.xiaomimimo.com/v1/chat/completions");
});

test("env bootstrap defaults to project .env", () => {
  assert.equal(resolveDotEnvPath(), path.join(repoRoot, ".env"));
});
