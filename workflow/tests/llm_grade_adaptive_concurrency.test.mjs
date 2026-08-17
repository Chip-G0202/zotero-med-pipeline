import assert from "node:assert/strict";
import test from "node:test";

import { reviewGradesWithLlm } from "../tools/stage1/llm_grade_reviewer.mjs";

test("grade review batches share one bounded LLM controller", async () => {
  const items = Array.from({ length: 6 }, (_, index) => ({
    id: `item-${index}`,
    title: `Clinical title ${index}`,
    grade: "A",
    rule_grade: "A",
  }));
  const report = await reviewGradesWithLlm({
    items,
    config: { enabled: true, batch_size: 1, batch_concurrency: 3, cache_enabled: false },
    runtime: { llm_mode: "mock", model: "mock" },
  });

  assert.equal(report.ok, true);
  assert.equal(report.adaptive_concurrency.service, "llm");
  assert.equal(report.adaptive_concurrency.max_concurrency, 3);
  assert.ok(report.adaptive_concurrency.peak_concurrency <= 3);
  assert.equal(report.items_reviewed, 6);
});
