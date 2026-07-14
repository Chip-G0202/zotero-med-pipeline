import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { batchOverviewLiterature, generateLiteratureOverview, overviewArtifactPath, selectOverviewLiterature } from "../tools/stage5/literature_overview.mjs";

function summary(root, created = 4) { return { runId: "overview-run", outputRoot: root, counts: { created } }; }
function runtime() { return { llm_mode: "real", apiKeyConfigured: true, model: "mock-overview", max_retries: 9 }; }
async function tempRoot(label) { return fs.mkdtemp(path.join(os.tmpdir(), `paperflow-${label}-`)); }

test("selection uses every normalized unique ABC title in stable grade order", () => {
  const items = Array.from({ length: 21 }, (_, index) => ({ title: `Title ${index}`, abstract: `SECRET-${index}`, grade: ["C", "B", "A"][index % 3] }));
  items.push(
    { title: "  Same\u0000   Title  ", grade: "C" },
    { title: "Same Title", grade: "A" },
    { title: "D title", grade: "D" },
    { title: "Ungraded", grade: "" },
    { title: "   ", grade: "A" },
  );
  const selected = selectOverviewLiterature(items);
  assert.equal(selected.items.length, 22);
  assert.deepEqual(selected.gradeCounts, { A: 8, B: 7, C: 7 });
  assert.equal(selected.items.find((item) => item.title === "Same Title").grade, "A");
  assert.deepEqual([...selected.items].sort((a, b) => ({ A: 0, B: 1, C: 2 }[a.grade] - { A: 0, B: 1, C: 2 }[b.grade])), selected.items);
  assert.equal(JSON.stringify(selected).includes("SECRET"), false);
  assert.equal(JSON.stringify(selected).includes("D title"), false);
  assert.equal(JSON.stringify(selected).includes("Ungraded"), false);
});

test("21+ titles all reach one normal LLM call without abstracts or D items", async () => {
  const root = await tempRoot("overview-all");
  const items = Array.from({ length: 80 }, (_, index) => ({ title: `ABC title ${String(index).padStart(3, "0")}`, abstract: `ABSTRACT-${index}`, grade: ["A", "B", "C"][index % 3] }));
  items.push({ title: "Excluded D", abstract: "D ABSTRACT", grade: "D" });
  const calls = [];
  const result = await generateLiteratureOverview({
    runSummary: summary(root, 81), literatureItems: items, runtime: runtime(),
    llmClient: async (input) => { calls.push(input); return { overview: "根据本轮文献标题，研究主要集中在多个相关主题及其研究方法。" }; },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].items.length, 80);
  assert.equal(JSON.stringify(calls).includes("ABSTRACT"), false);
  assert.equal(JSON.stringify(calls).includes("Excluded D"), false);
  assert.equal(result.sourceCount, 80);
  assert.equal(result.batchCount, 1);
});

test("hash ignores abstracts but changes with title or grade and cache prevents repeat calls", async () => {
  const roots = await Promise.all(["one", "two", "three"].map(tempRoot));
  let calls = 0;
  const llmClient = async () => { calls += 1; return { overview: "根据本轮文献标题，研究主要集中在示例主题。" }; };
  const first = await generateLiteratureOverview({ runSummary: summary(roots[0]), literatureItems: [{ title: "Study", abstract: "one", grade: "A" }], llmClient, runtime: runtime() });
  const cached = await generateLiteratureOverview({ runSummary: summary(roots[0]), literatureItems: [{ title: "Study", abstract: "changed", grade: "A" }], llmClient, runtime: runtime() });
  const changedGrade = await generateLiteratureOverview({ runSummary: summary(roots[1]), literatureItems: [{ title: "Study", grade: "B" }], llmClient, runtime: runtime() });
  const changedTitle = await generateLiteratureOverview({ runSummary: summary(roots[2]), literatureItems: [{ title: "Study 2", grade: "A" }], llmClient, runtime: runtime() });
  assert.equal(cached.cacheHit, true);
  assert.equal(first.inputHash, cached.inputHash);
  assert.notEqual(first.inputHash, changedGrade.inputHash);
  assert.notEqual(first.inputHash, changedTitle.inputHash);
  assert.equal(calls, 3);
});

test("oversized input is deterministically batched with complete exact coverage then merged", async () => {
  const root = await tempRoot("overview-batches");
  const items = Array.from({ length: 25 }, (_, index) => ({ title: `Long title ${String(index).padStart(2, "0")} ${"x".repeat(35)}`, grade: ["A", "B", "C"][index % 3] }));
  const selected = selectOverviewLiterature(items).items;
  const expectedBatches = batchOverviewLiterature(selected, 240);
  const calls = [];
  const result = await generateLiteratureOverview({
    runSummary: summary(root, 25), literatureItems: items, runtime: runtime(), maxInputChars: 240,
    llmClient: async (input) => { calls.push(input); return { overview: input.items ? "批次主题概况" : "根据本轮文献标题，研究主要集中在合并后的总体主题。" }; },
  });
  const submitted = calls.slice(0, -1).flatMap((call) => call.items);
  assert.ok(expectedBatches.length > 1);
  assert.deepEqual(submitted, selected);
  assert.equal(new Set(submitted.map((item) => `${item.grade}:${item.title}`)).size, selected.length);
  assert.equal(result.batchCount, expectedBatches.length);
  assert.equal(calls.length, expectedBatches.length + 1);
  assert.deepEqual(calls.at(-1), { summaries: Array(expectedBatches.length).fill("批次主题概况") });
});

test("fallbacks avoid network and artifact stores only metadata", async () => {
  const failedRoot = await tempRoot("overview-fallback");
  const failed = await generateLiteratureOverview({ runSummary: summary(failedRoot), literatureItems: [
    { title: "Alpha <topic>", abstract: "PRIVATE", grade: "A" }, { title: "Beta", grade: "B" }, { title: "Gamma", grade: "C" },
  ], llmClient: async () => { throw new Error("mock failure"); }, runtime: runtime() });
  assert.equal(failed.status, "fallback");
  assert.match(failed.overview, /《Alpha <topic>》/);
  const artifactText = await fs.readFile(overviewArtifactPath(failedRoot), "utf8");
  assert.equal(artifactText.includes("PRIVATE"), false);
  for (const key of ["prompt", "items", "titles", "abstract"]) assert.equal(key in JSON.parse(artifactText), false);

  let calls = 0;
  const noAbcRoot = await tempRoot("overview-no-abc");
  const noAbc = await generateLiteratureOverview({ runSummary: summary(noAbcRoot, 2), literatureItems: [{ title: "D only", grade: "D" }], llmClient: async () => { calls += 1; }, runtime: runtime() });
  assert.equal(noAbc.overview, "本轮新增文献中暂无可用于总体概括的 A、B 或 C 级标题，详细结果请查看附件。");
  const emptyRoot = await tempRoot("overview-empty");
  const empty = await generateLiteratureOverview({ runSummary: summary(emptyRoot, 0), literatureItems: [{ title: "Ignored", grade: "A" }], llmClient: async () => { calls += 1; }, runtime: runtime() });
  assert.equal(empty.overview, "本轮没有新增文献。");
  assert.equal(calls, 0);
});
