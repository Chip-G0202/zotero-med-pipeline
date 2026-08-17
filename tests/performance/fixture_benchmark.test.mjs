import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalHash, compareBusinessEquivalence } from "./canonical_equivalence.mjs";
import { runFixtureBenchmark } from "./run_fixture_benchmark.mjs";

test("canonical comparator ignores volatile execution fields but detects business changes", () => {
  const left = { runId: "a", generated_at: "today", outputRoot: "C:/temp/a", rows: [{ identity: "doi:1", grade: "A" }] };
  const right = { runId: "b", generated_at: "tomorrow", outputRoot: "C:/temp/b", rows: [{ identity: "doi:1", grade: "A" }] };
  assert.equal(compareBusinessEquivalence(left, right).equivalent, true);
  assert.notEqual(canonicalHash(left), canonicalHash({ ...right, rows: [{ identity: "doi:1", grade: "B" }] }));
});

test("three-path fixture benchmark is repeatable and side-effect equivalent", async () => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperecho-perf-"));
  const report = await runFixtureBenchmark({ outputRoot, count: 90, formalRuns: 3 });
  assert.equal(report.input.candidateCount, 90);
  for (const pathName of ["desktop", "web", "local"]) {
    for (const condition of ["cold", "warm"]) {
      const result = report.conditions[pathName][condition];
      assert.equal(result.samples.length, 3);
      assert.equal(result.businessEquivalent, true);
      assert.equal(result.sideEffectsEquivalent, true);
      assert.match(result.businessHash, /^[a-f0-9]{64}$/);
      assert.match(result.sideEffectHash, /^[a-f0-9]{64}$/);
      assert.equal(Object.keys(result.medianStages).length, 5);
    }
  }
  assert.equal(report.conditions.desktop.cold.businessHash, report.conditions.web.cold.businessHash);
  assert.equal(report.conditions.web.cold.businessHash, report.conditions.local.cold.businessHash);
});
