import assert from "node:assert/strict";
import test from "node:test";

import { resolveWritebackCollectionNames } from "../../workflow/tools/stage2/main.mjs";

test("benchmark collection names are isolated without changing production defaults", () => {
  const now = new Date("2096-12-27T00:00:00.000Z");
  const defaults = resolveWritebackCollectionNames(now, {});
  const isolated = resolveWritebackCollectionNames(now, { PAPERFLOW_BENCHMARK_COLLECTION_PREFIX: "benchmark-web-run1" });
  assert.notEqual(defaults.monthName, isolated.monthName);
  assert.deepEqual(isolated, { monthName: "benchmark-web-run1-month", dayName: "benchmark-web-run1-day" });
});
