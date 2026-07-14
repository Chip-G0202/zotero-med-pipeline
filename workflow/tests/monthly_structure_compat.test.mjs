import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { buildCandidateFeedbackFiles } from "../tools/lib/review_workbook_reader.mjs";
import {
  collectRecentDateCollectionNodes as collectWritebackDateCollectionNodes,
} from "../tools/stage2/main.mjs";
import {
  collectRecentDateCollectionNodes,
  parseMonthDayCollectionDate,
} from "../tools/stage3/main.mjs";

function localIsoDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

test("feedback reader checks monthly review folders before legacy week folders", () => {
  const files = buildCandidateFeedbackFiles(new Date("2026-06-08T15:00:00+08:00"), {
    reviewRoot: "C:/repo/review_results/文献评价",
    desktopRoot: "C:/repo/review_results/文献评价",
    projectRoot: "C:/repo",
    researchRoot: "C:/repo/review_results",
    lookbackDays: 1,
  });

  assert.equal(files.length, 1);
  assert.equal(files[0].day, "26.6.7");
  assert.equal(
    files[0].paths[0],
    path.join("C:/repo/review_results/文献评价", "26.06", "06.07", "周报.xlsx"),
  );
  assert.ok(files[0].paths.some((p) => p.includes(path.join("26 Week23", "26.6.7", "周报.xlsx"))));
});

test("zotero pool scan recognizes month/day collections and legacy date collections", () => {
  const tree = [
    {
      key: "month",
      name: "26.06",
      subcollections: [
        { key: "new-day", name: "06.06", subcollections: [] },
      ],
    },
    { key: "legacy-date", name: "2026-06-05", subcollections: [] },
    { key: "old-legacy-date", name: "2026-05-01", subcollections: [] },
  ];

  const nodes = collectRecentDateCollectionNodes(tree, new Date("2026-06-08T15:00:00+08:00"), 7);
  assert.deepEqual(nodes.map((node) => node.key).sort(), ["legacy-date", "new-day"]);
  const writebackNodes = collectWritebackDateCollectionNodes(tree, new Date("2026-06-08T15:00:00+08:00"), 7);
  assert.deepEqual(writebackNodes.map((node) => node.key).sort(), ["legacy-date", "new-day"]);
  assert.equal(localIsoDate(parseMonthDayCollectionDate("06.06", ["文献池", "26.06"])), "2026-06-06");
});
