import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { translateTitlesBatch } from "../tools/lib/title_translation_support.mjs";

test("title translation owns one bounded LLM controller and preserves input mapping", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperecho-llm-adaptive-"));
  const titles = Array.from({ length: 8 }, (_, index) => `Title ${index}`);
  let active = 0;
  let peak = 0;
  let calls = 0;
  const result = await translateTitlesBatch(titles, 4, {
    cachePath: path.join(root, "cache.json"),
    batchSize: 8,
    runtime: {
      concurrencyLimit: 4,
      providerConcurrencyLimit: 4,
      batchSize: 8,
      rateLimit: {},
      model: "mock",
      temperature: 0,
      top_p: 1,
      stream: false,
    },
    translateOneImpl: async (title) => {
      const call = calls++;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, call === 0 ? 1 : 4));
      active -= 1;
      return call === 0
        ? { ok: false, zh: title, reason: "HTTP_429", status: 429 }
        : { ok: true, zh: `译：${title}` };
    },
  });

  assert.equal(calls, titles.length);
  assert.ok(peak <= 4);
  assert.deepEqual([...result.map.keys()], titles);
  assert.equal(result.usage.adaptive_concurrency.service, "llm");
  assert.equal(result.usage.adaptive_concurrency.max_concurrency, 4);
  assert.equal(result.usage.adaptive_concurrency.current_concurrency, 2);
  assert.equal(result.usage.adaptive_concurrency.pressureSignals, 1);
});
