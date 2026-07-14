import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateLiteratureTitleTranslations } from "../tools/lib/title_translation_generation.mjs";
import { translateTitlesBatch } from "../tools/lib/title_translation_support.mjs";

test("Desktop, Web, and Local share title cache without Zotero identifiers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperflow-title-generation-"));
  const cachePath = path.join(root, "translation_cache.json");
  let calls = 0;
  const batch = (titles, concurrency, options) => translateTitlesBatch(titles, concurrency, {
    ...options,
    translateOneImpl: async () => { calls += 1; return { ok: true, zh: "共享中文标题" }; },
    runtime: { concurrencyLimit: 1, providerConcurrencyLimit: 1, batchSize: 1, model: "mock", temperature: 0, top_p: 1, stream: false, rateLimit: {} },
  });
  const desktop = await generateLiteratureTitleTranslations([{ title: "Shared English title", itemKey: "Z1" }], { cachePath, translateTitlesBatchImpl: batch });
  const local = await generateLiteratureTitleTranslations([{ title: "Shared English title", local_id: "lp_1" }], { cachePath, translateTitlesBatchImpl: batch });
  const web = await generateLiteratureTitleTranslations([{ title: "Shared English title" }], { cachePath, translateTitlesBatchImpl: batch });
  assert.equal(calls, 1);
  assert.equal(desktop.items[0].translatedTitle, "共享中文标题");
  assert.equal(local.items[0].translatedTitle, "共享中文标题");
  assert.equal(web.items[0].translatedTitle, "共享中文标题");
  assert.equal(local.items[0].itemKey, undefined);
});
