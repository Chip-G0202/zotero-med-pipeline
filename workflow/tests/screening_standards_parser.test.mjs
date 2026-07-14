import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadScreeningStandards } from "../tools/stage1/screening_standards_parser.mjs";
import { screeningStandardsPath } from "../tools/stage1/screening_standards_file.mjs";

describe("screening standards parser loadScreeningStandards", () => {
  it("loads and parses screening_standards.md from the review root", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "screening_standards_parser_"));
    const reviewRoot = path.join(tmpRoot, "review_results", "文献评价");
    fs.mkdirSync(reviewRoot, { recursive: true });
    fs.writeFileSync(
      screeningStandardsPath(reviewRoot),
      [
        "# 筛选标准",
        "",
        "Example Research Topic 的示例机制研究。",
        "",
        "## 严格排除",
        "* 纯材料工程研究。",
        "",
        "## 优先关注",
        "* Example priority rule with mechanism evidence.",
        "",
        "## 降权",
        "* 单纯行为学研究。",
      ].join("\n"),
      "utf8",
    );

    try {
      const standards = loadScreeningStandards(reviewRoot);
      assert.equal(standards.loaded, true);
      assert.equal(standards.parsed, true);
      assert.ok(standards.path.endsWith("screening_standards.md"));
      assert.equal(standards.hard_excludes.length, 1);
      assert.equal(standards.positive_preferences.length, 1);
      assert.equal(standards.negative_preferences.length, 1);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
