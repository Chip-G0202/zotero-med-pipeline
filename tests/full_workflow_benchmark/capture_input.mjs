import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedIsolatedState } from "../helpers/benchmark_state.mjs";

function arg(name) {
  const prefix = `--${name}=`;
  return String(process.argv.find((value) => String(value).startsWith(prefix)) || "").slice(prefix.length);
}

const runDir = path.resolve(arg("run-dir"));
const snapshotDir = path.join(runDir, "input_snapshot");
const outputRoot = path.join(runDir, "capture");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
Object.assign(process.env, {
  ZOTERO_BACKEND: "cli",
  ZOTERO_API_KEY: "",
  NOTIFICATION_ENABLED: "false",
  review_results_FORCE_RUN: "true",
  FORCE_review_results_RUN: "true",
  review_results_OVERRIDE_DATE: "2096-12-27T00:00:00.000Z",
});
process.argv.push(`--output-root=${outputRoot}`);
await fs.mkdir(snapshotDir, { recursive: true });
const seededState = await seedIsolatedState(repoRoot, outputRoot);
const started = performance.now();
const { runResearchOsPipeline } = await import("../../workflow/tools/stage1/main.mjs");
await runResearchOsPipeline();
const pipelineDir = path.join(outputRoot, "review_results", "pipeline", "96.12.27");
const candidates = JSON.parse(await fs.readFile(path.join(pipelineDir, "merged_items.json"), "utf8"));
const runReport = JSON.parse(await fs.readFile(path.join(pipelineDir, "run_report.json"), "utf8"));
if (!Array.isArray(candidates) || !candidates.length) throw new Error("capture_produced_no_candidates");
const fixture = candidates;
const fixturePath = path.join(snapshotDir, "candidates.json");
const body = `${JSON.stringify(fixture, null, 2)}\n`;
await fs.writeFile(fixturePath, body);
const configFiles = [
  "config/rss_sources.json",
  "config/pubmed_pmc_search.json",
  "config/openalex_search.json",
  "config/review-workflow-rules.json",
  "config/title_translation.config.json",
  "config/prompt-title-translation.md",
];
const configRecords = [];
for (const relative of configFiles) {
  const file = path.join(repoRoot, relative);
  const content = await fs.readFile(file);
  configRecords.push({ relative, sha256: crypto.createHash("sha256").update(content).digest("hex") });
}
const configSha256 = crypto.createHash("sha256").update(JSON.stringify(configRecords)).digest("hex");
const metadata = {
  capturedAt: new Date().toISOString(),
  captureMs: performance.now() - started,
  capturedCandidates: candidates.length,
  replayCandidates: fixture.length,
  truncated: false,
  sha256: crypto.createHash("sha256").update(body).digest("hex"),
  configSha256,
  configFiles: configRecords,
  runtimeModes: {
    llmConfigured: Boolean(String(process.env.PREFERENCE_LEARNING_API_KEY || "").trim()),
    translationConfigured: Boolean(String(process.env.TITLE_TRANSLATION_API_KEY || "").trim()),
    notificationEnabled: false,
  },
  seededState,
  source: "stage1_merged_items",
  sourceCounts: {
    rss: Number(runReport?.counts?.rss_raw || 0),
    pubmedPmc: Number(runReport?.counts?.db_raw || 0),
    openalex: Number(runReport?.counts?.openalex_raw || 0),
    mergedBeforeDedup: Number(runReport?.steps?.dedupe?.fetched_count || 0),
    mergedAfterDedup: candidates.length,
  },
  failedSources: Array.isArray(runReport?.failures) ? runReport.failures.filter((entry) => ["rss", "pubmed", "openalex"].includes(entry?.stage)).length : 0,
  sourceFailures: Array.isArray(runReport?.failures)
    ? runReport.failures.filter((entry) => ["rss", "pubmed", "openalex"].includes(entry?.stage)).map((entry) => ({ stage: entry.stage, code: entry.code || entry.reason || "failed" }))
    : [],
  llmReview: runReport?.llm_review_execution_summary || null,
};
await fs.writeFile(path.join(snapshotDir, "metadata.json"), JSON.stringify(metadata, null, 2));
console.log(JSON.stringify(metadata));
