import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkflowRules } from "../tools/lib/literature_config.mjs";
import { classifyItem } from "../tools/stage1/rule_classifier.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("loadWorkflowRules defaults to project config root", () => {
  const rules = loadWorkflowRules();
  assert.equal(rules.path, path.join(repoRoot, "config", "review-workflow-rules.json"));
  assert.deepEqual(rules.warnings, []);
  assert.ok(rules.config.triage?.research_focus?.core_biology_terms?.includes("example biological context"));
});

test("configured terms do not match inside ordinary words", () => {
  assert.equal(classifyItem({
    title: "Developing example biological context opportunities",
    abstract: "",
  }).grade, "C");

  assert.equal(classifyItem({
    title: "Synthetic example exposure links example biological context to example mechanism evidence",
    abstract: "",
  }).grade, "A");
});
