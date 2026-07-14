import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const SCRIPT = "workflow/tools/diagnostics/zotero_cli_probe.mjs";

test("zotero_cli_probe --help documents safe read-only default", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Default mode is read-only/);
  assert.match(result.stdout, /--tool <name>/);
});

test("zotero_cli_probe rejects unsupported tool values instead of reporting a false pass", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--tool=none", "--no-report"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unsupported --tool value: none/);
});
