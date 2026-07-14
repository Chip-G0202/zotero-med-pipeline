import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildBalancedCandidatePool,
  selectRepresentativeCandidateSample,
} from "../tools/stage1/candidate_sampling.mjs";

describe("candidate sampling diagnostics", () => {
  it("balances RSS and database candidates before applying a fetch limit", () => {
    const rss = Array.from({ length: 5 }, (_, i) => ({ id: `rss-${i + 1}`, source_channel: "rss" }));
    const db = Array.from({ length: 5 }, (_, i) => ({ id: `db-${i + 1}`, source_channel: "database" }));

    const result = buildBalancedCandidatePool({ rssItems: rss, dbItems: db, limit: 6 });

    assert.equal(result.items.length, 6);
    assert.deepEqual(result.items.map((item) => item.id), ["rss-1", "db-1", "rss-2", "db-2", "rss-3", "db-3"]);
    assert.equal(result.audit.strategy, "balanced_sources");
  });

  it("selects a representative rule-grade sample instead of taking only leading D items", () => {
    const items = [
      { id: "d-1" },
      { id: "d-2" },
      { id: "b-1" },
      { id: "c-1" },
      { id: "a-1" },
    ];
    const gradeById = new Map([
      ["d-1", "D"],
      ["d-2", "D"],
      ["b-1", "B"],
      ["c-1", "C"],
      ["a-1", "A"],
    ]);

    const result = selectRepresentativeCandidateSample({
      items,
      limit: 4,
      classify: (item) => ({ grade: gradeById.get(item.id), grade_reason: `reason-${item.id}` }),
    });

    assert.deepEqual(result.items.map((item) => item.id), ["a-1", "b-1", "c-1", "d-1"]);
    assert.deepEqual(result.diagnostics.pre_sample_grade_counts, { A: 1, B: 1, C: 1, D: 2 });
    assert.deepEqual(result.diagnostics.selected_grade_counts, { A: 1, B: 1, C: 1, D: 1 });
  });
});
