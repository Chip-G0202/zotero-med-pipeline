import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadFixtureCandidates } from "../tools/stage1/fixture_input.mjs";

describe("pipeline fixture input", () => {
  it("loads candidates.json only from an explicit fixture root", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline_fixture_"));
    await fs.writeFile(path.join(fixtureRoot, "candidates.json"), JSON.stringify([
      { id: "fx-1", title: "Mechanistic inflammation study", source_channel: "fixture" },
      { id: "fx-2", title: "Weakly related monitoring note", source_channel: "fixture" },
    ]), "utf8");

    const result = await loadFixtureCandidates({ fixtureRoot, dryRun: true });

    assert.equal(result.enabled, true);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].source_channel, "fixture");
    assert.match(result.path, /candidates\.json$/);
  });

  it("does not load fixture candidates without dry-run or explicit allow flag", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline_fixture_"));
    await fs.writeFile(path.join(fixtureRoot, "candidates.json"), JSON.stringify([
      { id: "fx-1", title: "Should not load" },
    ]), "utf8");

    const result = await loadFixtureCandidates({ fixtureRoot, dryRun: false });

    assert.equal(result.enabled, false);
    assert.equal(result.items.length, 0);
    assert.equal(result.skipped_reason, "fixture_requires_dry_run_or_explicit_allow");
  });
});
