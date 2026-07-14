import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const captureSource = await fs.readFile(new URL("./capture_input.mjs", import.meta.url), "utf8");
const backendSource = await fs.readFile(new URL("./run_backend.mjs", import.meta.url), "utf8");
const suiteSource = await fs.readFile(new URL("./run_dual_backend_benchmark.mjs", import.meta.url), "utf8");

test("full benchmark replays every merged Stage 1 candidate without sampling flags", () => {
  assert.match(captureSource, /const fixture = candidates;/);
  assert.match(captureSource, /source: "stage1_merged_items"/);
  for (const source of [captureSource, backendSource]) {
    assert.doesNotMatch(source, /slice\(0,\s*1\)/);
    assert.doesNotMatch(source, /--(?:sample|fetch)-limit=1/);
  }
});

test("full benchmark keeps formal LLM and migration modes while disabling notifications", () => {
  assert.doesNotMatch(captureSource, /LLM_MODE:\s*"disabled"/);
  assert.match(backendSource, /ZOTERO_STAR_MIGRATION_MODE:\s*"expand"/);
  assert.match(backendSource, /APPLY_FEEDBACK_ITEM_ACTIONS:\s*"true"/);
  assert.match(captureSource, /NOTIFICATION_ENABLED:\s*"false"/);
  assert.match(backendSource, /NOTIFICATION_ENABLED:\s*"false"/);
});

test("each backend is gated by idempotent cleanup and exact state restoration", () => {
  assert.match(backendSource, /const first = await runStage2SmokeCleanup/);
  assert.match(backendSource, /const second = await runStage2SmokeCleanup/);
  assert.match(backendSource, /second\.deleted_items === 0/);
  assert.match(backendSource, /second\.deleted_collections === 0/);
  assert.match(suiteSource, /if \(backend === "web_api"\)/);
  assert.match(suiteSource, /pendingDryRun: verified\.failures\.length/);
  assert.match(suiteSource, /protectedOutput: outputVerified/);
});

test("backend rejects a truncated or count-mismatched snapshot", () => {
  assert.match(backendSource, /fixture\.length !== fixtureMetadata\.replayCandidates/);
  assert.match(backendSource, /fixtureMetadata\.truncated !== false/);
});
