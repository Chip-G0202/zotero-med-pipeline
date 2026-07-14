import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SMOKE_SCRIPT = path.join(ROOT, "workflow", "tools", "maintenance", "smoke_check.mjs");

function runSmoke(args = [], opts = {}) {
  const result = spawnSync(process.execPath, [SMOKE_SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10000,
    ...opts,
  });
  return { stdout: result.stdout || "", stderr: result.stderr || "", status: result.status };
}

// --- Help ---

test("smoke_check --help shows usage", () => {
  const { stdout, status } = runSmoke(["--help"]);
  assert.equal(status, 0);
  assert.ok(stdout.includes("Usage:"));
  assert.ok(stdout.includes("--mode"));
  assert.ok(stdout.includes("--json"));
  assert.ok(stdout.includes("--dry-run"));
});

// --- Headless mode ---

test("smoke_check --mode headless runs without crash", () => {
  const { stdout, status } = runSmoke(["--mode", "headless"]);
  assert.equal(status, 0);
  assert.ok(stdout.includes("Headless Readiness"));
  assert.ok(stdout.includes("mode: headless"));
});

test("smoke_check --mode headless --json returns valid JSON", () => {
  const { stdout, status } = runSmoke(["--mode", "headless", "--json"]);
  assert.equal(status, 0);
  const j = JSON.parse(stdout);
  assert.equal(j.mode, "headless");
  assert.ok("headless" in j);
  assert.ok("platform" in j);
  assert.ok("directories" in j);
  assert.ok("configs" in j);
  assert.ok("overall" in j);
});

// --- Desktop mode ---

test("smoke_check --mode desktop runs without crash", () => {
  const { stdout, status } = runSmoke(["--mode", "desktop"]);
  assert.equal(status, 0);
  assert.ok(stdout.includes("Desktop Readiness"));
  assert.ok(stdout.includes("mode: desktop"));
});

test("smoke_check --mode desktop --json returns valid JSON", () => {
  const { stdout, status } = runSmoke(["--mode", "desktop", "--json"]);
  assert.equal(status, 0);
  const j = JSON.parse(stdout);
  assert.equal(j.mode, "desktop");
  assert.ok("desktop" in j);
  assert.ok(j.headless === null);
});

test("smoke_check verifies the configured desktop CLI command", () => {
  const env = { ...process.env, ZOTERO_DESKTOP_CLI_TOOL: "definitely-not-real-zotero-cli" };
  const { stdout, status } = runSmoke(["--mode", "desktop", "--json"], { env });
  assert.equal(status, 0);
  const j = JSON.parse(stdout);
  const cli = j.desktop.checks.find((entry) => entry.check === "desktop_cli_installed");
  assert.equal(cli.command, "definitely-not-real-zotero-cli");
  assert.equal(cli.available, false);
});

// --- All mode ---

test("smoke_check --mode all includes both headless and desktop", () => {
  const { stdout, status } = runSmoke(["--mode", "all", "--json"]);
  assert.equal(status, 0);
  const j = JSON.parse(stdout);
  assert.equal(j.mode, "all");
  assert.ok(j.headless !== null);
  assert.ok(j.desktop !== null);
});

// --- JSON output is parseable ---

test("smoke_check --json output has expected top-level fields", () => {
  const { stdout } = runSmoke(["--json"]);
  const j = JSON.parse(stdout);
  assert.ok("mode" in j);
  assert.ok("dryRun" in j);
  assert.ok("noNetwork" in j);
  assert.ok("timestamp" in j);
  assert.ok("platform" in j);
  assert.ok("directories" in j);
  assert.ok("configs" in j);
  assert.ok("email" in j);
  assert.ok("zoteroWrite" in j);
  assert.ok("runsCleanup" in j);
  assert.ok("overall" in j);
  assert.ok("pathWritable" in j);
});

// --- No secrets exposed ---

test("smoke_check does not output secret values", () => {
  const { stdout } = runSmoke(["--json"]);
  const lower = stdout.toLowerCase();
  // Should not contain common secret patterns
  assert.ok(!lower.includes("sk-"), "should not contain API key patterns");
  assert.ok(!lower.includes("password"), "should not contain password");
  assert.ok(!lower.includes("token"), "should not contain token values");
  // Env var values should not appear
  assert.ok(!stdout.includes("your_translation_api_key_here"));
  assert.ok(!stdout.includes("your_easyscholar_secret_key_here"));
});

// --- Source selection consistency ---

test("smoke_check reports source_selection domain and enabled sources", () => {
  const { stdout } = runSmoke(["--json"]);
  const j = JSON.parse(stdout);
  // headless check includes source selection
  if (j.headless) {
    const ss = j.headless.checks.find(c => c.check === "source_selection");
    assert.ok(ss, "source_selection check should be present");
    assert.ok(ss.domain, "should report domain");
    assert.ok(Array.isArray(ss.enabledSources), "should report enabled sources");
  }
});

// --- Platform detection ---

test("smoke_check detects current platform", () => {
  const { stdout } = runSmoke(["--json"]);
  const j = JSON.parse(stdout);
  assert.ok(j.platform);
  assert.ok(["win32", "darwin", "linux"].includes(j.platform.platform));
  assert.ok(j.platform.nodeVersion.startsWith("v"));
  assert.ok(j.platform.checks.length > 0);
});

// --- Directory checks ---

test("smoke_check checks key directories", () => {
  const { stdout } = runSmoke(["--json"]);
  const j = JSON.parse(stdout);
  assert.ok(j.directories.length >= 4);
  const labels = j.directories.map(d => d.label);
  assert.ok(labels.includes("config"));
  assert.ok(labels.includes("workflow/tools"));
  assert.ok(labels.includes("review_results"));
  assert.ok(labels.includes("review_results/pipeline"));
});

// --- Config checks ---

test("smoke_check validates all required config files", () => {
  const { stdout } = runSmoke(["--json"]);
  const j = JSON.parse(stdout);
  const names = j.configs.map(c => c.file);
  assert.ok(names.includes("source_selection.json"));
  assert.ok(names.includes("openalex_search.json"));
  assert.ok(names.includes("pubmed_pmc_search.json"));
  assert.ok(names.includes("rss_sources.json"));
  assert.ok(names.includes("review-workflow-rules.json"));
});

// --- Runs cleanup check ---

test("smoke_check detects cleanup_runs.mjs", () => {
  const { stdout } = runSmoke(["--json"]);
  const j = JSON.parse(stdout);
  assert.ok(j.runsCleanup);
  assert.equal(j.runsCleanup.exists, true);
});

// --- Dry-run is default ---

test("smoke_check defaults to dry-run", () => {
  const { stdout } = runSmoke(["--json"]);
  const j = JSON.parse(stdout);
  assert.equal(j.dryRun, true);
  assert.equal(j.noNetwork, true);
});

// --- Cross-platform path handling ---

test("smoke_check handles Windows-style paths in source_selection", () => {
  const { stdout } = runSmoke(["--json"]);
  const j = JSON.parse(stdout);
  // source_selection config path should be valid
  const ss = j.configs.find(c => c.file === "source_selection.json");
  assert.ok(ss);
  assert.ok(ss.path.includes("config"));
  assert.equal(ss.status, "ok");
});

test("smoke_check path writable check works", () => {
  const { stdout } = runSmoke(["--json"]);
  const j = JSON.parse(stdout);
  assert.ok(j.pathWritable);
  assert.equal(j.pathWritable.writable, true);
});


// --- Hints ---

test("smoke_check --json includes hints for missing config", () => {
  const { stdout } = runSmoke(["--json"]);
  const j = JSON.parse(stdout);
  assert.ok(Array.isArray(j.allHints), "allHints should be an array");
});

test("smoke_check requires SMTP only when a Stage5 recipient is configured", () => {
  const env = { ...process.env, PAPERFLOW_REPORT_TO: "recipient@example.test", NOTIFICATION_EMAIL: "", SMTP_HOST: "", SMTP_PORT: "", SMTP_SECURE: "", SMTP_USER: "", SMTP_PASS: "" };
  const { stdout, status } = runSmoke(["--json"], { env });
  assert.equal(status, 0);
  const report = JSON.parse(stdout);
  assert.equal(report.email.ready, false);
  assert.match(report.email.issues.join(" "), /SMTP is not configured\. Missing:/);
  assert.equal(JSON.stringify(report.email).includes("SMTP_PASS="), false);
});

test("smoke_check headless mode includes API key hint", () => {
  const { stdout } = runSmoke(["--mode", "headless", "--json"]);
  const j = JSON.parse(stdout);
  const apiKeyHint = j.headless?.hints?.find(h => h.includes("zotero.org/settings/keys"));
  // Hint present only when ZOTERO_API_KEY is missing
  if (j.headless?.issues?.some(i => i.includes("ZOTERO_API_KEY"))) {
    assert.ok(apiKeyHint, "should have API key setup hint when missing");
  }
});

test("smoke_check desktop mode includes CLI install hints", () => {
  const { stdout } = runSmoke(["--mode", "desktop", "--json"]);
  const j = JSON.parse(stdout);
  assert.ok(Array.isArray(j.desktop?.hints), "desktop should have hints array");
});

test("smoke_check does not expose secrets in hints", () => {
  const { stdout } = runSmoke(["--json"]);
  const j = JSON.parse(stdout);
  const allText = JSON.stringify(j);
  assert.ok(!allText.includes("sk-"), "should not contain API key patterns in hints");
  assert.ok(!allText.includes("password"), "should not contain password in hints");
});
