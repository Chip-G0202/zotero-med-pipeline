import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const IMPORTS = [
  "./workflow/tools/diagnostics/check_med_query_learning_feedback.mjs",
  "./workflow/tools/diagnostics/check_previous_feedback_learning.mjs",
  "./workflow/tools/diagnostics/zotero_cli_probe.mjs",
  "./workflow/tools/stage2/diagnose_zotero_writeback_dedupe.mjs",
];

test("diagnostic entry modules are safe to import without executing main", () => {
  const script = [
    "const modules = JSON.parse(process.argv[1]);",
    "for (const mod of modules) await import(mod);",
    "console.log('imported');",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, JSON.stringify(IMPORTS)], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "imported");
});
