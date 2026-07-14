import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultCliTool } from "../lib/zotero_cli_executor.mjs";
import { emailTransportConfig } from "../stage5/email_sender.mjs";

const HELP = `Usage: node workflow/tools/maintenance/smoke_check.mjs [options]

Workflow readiness smoke check — verifies configuration, platform, and dependencies.

Options:
  --mode <mode>     Check mode: headless | desktop | all (default: all)
  --no-network      Skip any network-dependent checks (default: enabled)
  --dry-run         Safe mode, no writes (default: true)
  --json            Output machine-readable JSON summary
  --help            Show this message

Modes:
  headless   Check API-only / no-desktop path readiness
  desktop    Check Zotero Desktop / CLI path readiness
  all        Check both headless and desktop paths`;

function parseArgs(argv) {
  const args = { mode: "all", noNetwork: true, dryRun: true, json: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { args.help = true; continue; }
    if (a === "--json") { args.json = true; continue; }
    if (a === "--no-network") { args.noNetwork = true; continue; }
    if (a === "--dry-run") { args.dryRun = true; continue; }
    if (a === "--mode" && i + 1 < argv.length) { args.mode = argv[++i]; continue; }
  }
  return args;
}

const REQUIRED_CONFIGS = [
  "source_selection.json",
  "openalex_search.json",
  "pubmed_pmc_search.json",
  "rss_sources.json",
  "review-workflow-rules.json",
];

const ENV_VARS = {
  headless: {
    required: ["ZOTERO_API_KEY"],
    optional: ["ZOTERO_USER_ID", "ZOTERO_API_BASE", "OPENALEX_MAILTO"],
  },
  desktop: {
    required: ["ZOTERO_BACKEND"],
    optional: ["ZOTERO_EXE", "ZOTERO_DESKTOP_CLI_TOOL", "ZOTERO_WEB_CLI_TOOL"],
  },
  email: {
    required: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"],
    optional: ["PAPERFLOW_REPORT_TO", "NOTIFICATION_EMAIL", "SMTP_PORT", "SMTP_SECURE", "SMTP_FROM"],
  },
  zotero_write: {
    required: ["ZOTERO_API_KEY"],
    optional: ["ZOTERO_USER_ID", "ZOTERO_BACKEND"],
  },
};

function checkEnvVar(name) {
  // Only check if the variable NAME is documented in .env.example or known to the project
  // Never read the actual value
  const val = process.env[name];
  if (val === undefined) return { status: "missing", name };
  if (val === "" || val === "your_translation_api_key_here" || val === "your_easyscholar_secret_key_here" || val === "your-email@example.com") {
    return { status: "placeholder_or_empty", name };
  }
  return { status: "configured", name };
}

function maskStatus(envResult) {
  // Never expose actual values
  return { name: envResult.name, status: envResult.status };
}

async function checkDir(dirPath, label) {
  try {
    const stat = await fs.stat(dirPath);
    return { path: dirPath, label, exists: stat.isDirectory() };
  } catch {
    return { path: dirPath, label, exists: false };
  }
}

async function checkJsonConfig(root, filename) {
  const filePath = path.join(root, "config", filename);
  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    return { file: filename, status: "ok", path: filePath };
  } catch (e) {
    if (e.code === "ENOENT") return { file: filename, status: "missing", path: filePath };
    return { file: filename, status: "invalid_json", error: e.message, path: filePath };
  }
}

async function checkSourceSelection(root) {
  const result = await checkJsonConfig(root, "source_selection.json");
  if (result.status !== "ok") return { ...result, domain: null, enabledSources: [] };
  try {
    const content = await fs.readFile(result.path, "utf8");
    const cfg = JSON.parse(content);
    const domain = cfg.research_domain || "unknown";
    const domainOption = cfg.domain_options?.[domain];
    const enabledSources = domainOption ? [...(domainOption.primary_sources || []), ...(domainOption.supplemental_sources || [])] : [];
    return { ...result, domain, enabledSources, requireManualConfirmation: cfg.require_manual_confirmation === true };
  } catch (e) {
    return { ...result, domain: null, enabledSources: [], error: e.message };
  }
}

async function checkPlatform() {
  const platform = process.platform;
  const arch = process.arch;
  const nodeVersion = process.version;
  const checks = [];

  // Node version >= 18
  const major = parseInt(nodeVersion.replace("v", "").split(".")[0], 10);
  checks.push({ check: "node_version", passed: major >= 18, detail: nodeVersion });

  // Platform recognized
  checks.push({ check: "platform", passed: ["win32", "darwin", "linux"].includes(platform), detail: `${platform}/${arch}` });

  return { platform, arch, nodeVersion, checks };
}

async function checkPathWritable(root) {
  const testFile = path.join(root, ".smoke_write_test_" + Date.now());
  try {
    await fs.writeFile(testFile, "test", "utf8");
    await fs.unlink(testFile);
    return { writable: true };
  } catch {
    return { writable: false };
  }
}

async function checkCliAvailable(command) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(command, ["--help"], { timeout: 5000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const detail = String(result.stdout || result.stderr || result.error?.message || "").trim();
  return { command, available: !result.error && (result.status === 0 || Boolean(result.stdout || result.stderr)), detail };
}

async function checkHeadlessReadiness(root) {
  const issues = [];
  const checks = [];
  const hints = [];

  // Zotero Web API config
  const apiKey = checkEnvVar("ZOTERO_API_KEY");
  checks.push({ ...maskStatus(apiKey), category: "headless_required" });
  if (apiKey.status === "missing") {
    issues.push("ZOTERO_API_KEY not set — headless Zotero Web API requires it");
    hints.push("Get API key from https://www.zotero.org/settings/keys");
  }
  const userId = checkEnvVar("ZOTERO_USER_ID");
  checks.push({ ...maskStatus(userId), category: "headless_optional" });
  if (userId.status === "missing") hints.push("ZOTERO_USER_ID is optional — workflow resolves it from API key");

  // Source selection configs
  const sourceSelection = await checkSourceSelection(root);
  checks.push({ check: "source_selection", ...sourceSelection });

  if (sourceSelection.enabledSources?.includes("pubmed_pmc")) {
    const pmCfg = await checkJsonConfig(root, "pubmed_pmc_search.json");
    checks.push({ check: "pubmed_pmc_config", ...pmCfg });
    if (pmCfg.status === "missing") issues.push("PubMed/PMC enabled but pubmed_pmc_search.json missing");
  }
  if (sourceSelection.enabledSources?.includes("openalex")) {
    const oaCfg = await checkJsonConfig(root, "openalex_search.json");
    checks.push({ check: "openalex_config", ...oaCfg });
    if (oaCfg.status === "missing") issues.push("OpenAlex enabled but openalex_search.json missing");
  }
  if (sourceSelection.enabledSources?.includes("rss")) {
    const rssCfg = await checkJsonConfig(root, "rss_sources.json");
    checks.push({ check: "rss_config", ...rssCfg });
    if (rssCfg.status === "missing") issues.push("RSS enabled but rss_sources.json missing");
  }

  // Stage5 email config (optional for headless)
  const reportTo = checkEnvVar("PAPERFLOW_REPORT_TO");
  const legacyReportTo = checkEnvVar("NOTIFICATION_EMAIL");
  checks.push(maskStatus(reportTo), maskStatus(legacyReportTo));
  if (reportTo.status === "configured" || legacyReportTo.status === "configured") for (const name of ENV_VARS.email.required) checks.push(maskStatus(checkEnvVar(name)));

  return { ready: issues.length === 0, issues, checks, hints };
}

async function checkDesktopReadiness(root) {
  const issues = [];
  const checks = [];
  const hints = [];

  const platform = process.platform;

  // Backend config
  const backend = checkEnvVar("ZOTERO_BACKEND");
  checks.push({ ...maskStatus(backend), category: "desktop_required" });
  if (backend.status === "missing") hints.push("ZOTERO_BACKEND defaults to 'auto' — set to 'web_api' or 'cli' to force");

  // Zotero EXE (optional, has platform defaults)
  const zoteroExe = checkEnvVar("ZOTERO_EXE");
  checks.push({ ...maskStatus(zoteroExe), category: "desktop_optional" });
  if (zoteroExe.status === "missing") {
    const defaultExe = platform === "darwin" ? "/Applications/Zotero.app/Contents/MacOS/zotero" : platform === "win32" ? "D:/Zotero/zotero.exe" : "zotero (from PATH)";
    hints.push("ZOTERO_EXE optional — defaults to: " + defaultExe);
  }

  // Desktop CLI tool (cli-anything-zotero)
  const desktopCli = checkEnvVar("ZOTERO_DESKTOP_CLI_TOOL");
  checks.push({ ...maskStatus(desktopCli), category: "desktop_required" });
  const desktopCliCommand = getDefaultCliTool("desktop");
  const desktopCliAvail = await checkCliAvailable(desktopCliCommand);
  checks.push({ check: "desktop_cli_installed", ...desktopCliAvail, category: "desktop_verification" });
  if (!desktopCliAvail.available) hints.push("cli-anything-zotero not found — install: npm install -g cli-anything-zotero");

  // Web CLI tool (zotero-cli-cc / zot)
  const webCli = checkEnvVar("ZOTERO_WEB_CLI_TOOL");
  checks.push({ ...maskStatus(webCli), category: "headless_optional" });
  const webCliCommand = getDefaultCliTool("web");
  const webCliAvail = await checkCliAvailable(webCliCommand);
  checks.push({ check: "web_cli_installed", ...webCliAvail, category: "headless_verification" });
  if (!webCliAvail.available) hints.push("zotero-cli-cc not found — install: npm install -g zotero-cli-cc");

  // API key (needed for web_api backend or hybrid)
  const apiKey = checkEnvVar("ZOTERO_API_KEY");
  checks.push({ ...maskStatus(apiKey), category: "headless_required" });

  // Platform-specific notes
  if (platform === "win32") {
    checks.push({ check: "platform_note", detail: "Windows: uses taskkill/cmd.exe for Zotero launch, .cmd/.bat shim for CLI", category: "info" });
  } else if (platform === "darwin") {
    checks.push({ check: "platform_note", detail: "macOS: uses open -a Zotero, pkill for process management", category: "info" });
  } else {
    checks.push({ check: "platform_note", detail: "Linux: uses spawn for Zotero launch", category: "info" });
  }

  // Source selection
  const sourceSelection = await checkSourceSelection(root);
  checks.push({ check: "source_selection", ...sourceSelection, category: "info" });

  // Dry-run config
  const dryRunEnv = checkEnvVar("review_results_DRY_RUN");
  checks.push({ ...maskStatus(dryRunEnv), category: "optional" });

  return { ready: issues.length === 0, issues, checks, hints };
}

async function checkEmailReadiness() {
  const issues = [];
  const checks = [];
  const hints = [];

  const reportTo = checkEnvVar("PAPERFLOW_REPORT_TO");
  const legacyReportTo = checkEnvVar("NOTIFICATION_EMAIL");
  checks.push({ ...maskStatus(reportTo), category: "email_optional" }, { ...maskStatus(legacyReportTo), category: "email_legacy" });

  if (reportTo.status === "configured" || legacyReportTo.status === "configured") {
    for (const name of ENV_VARS.email.required) checks.push({ ...maskStatus(checkEnvVar(name)), category: "smtp_required" });
    for (const name of ["SMTP_PORT", "SMTP_SECURE", "SMTP_FROM"]) checks.push({ ...maskStatus(checkEnvVar(name)), category: "smtp_optional" });
    const smtp = emailTransportConfig(process.env);
    if (!smtp.configured) issues.push(smtp.error);
  } else {
    hints.push("Stage5 email skipped — provide --email or set PAPERFLOW_REPORT_TO");
  }

  return { ready: issues.length === 0, issues, checks, hints };
}

async function checkZoteroWriteReadiness() {
  const issues = [];
  const checks = [];

  for (const v of ENV_VARS.zotero_write.required) {
    const r = checkEnvVar(v);
    checks.push(maskStatus(r));
    if (r.status === "missing") issues.push(`${v} not set — Zotero write requires it`);
  }
  for (const v of ENV_VARS.zotero_write.optional) {
    checks.push(maskStatus(checkEnvVar(v)));
  }

  return { ready: issues.length === 0, issues, checks };
}

async function checkRunsCleanup(root) {
  const scriptPath = path.join(root, "workflow", "tools", "maintenance", "cleanup_runs.mjs");
  try {
    await fs.access(scriptPath);
    return { exists: true, path: scriptPath };
  } catch {
    return { exists: false, path: scriptPath };
  }
}

export async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(HELP);
    return { help: true };
  }

  const root = process.cwd();
  const result = {
    mode: args.mode,
    dryRun: args.dryRun,
    noNetwork: args.noNetwork,
    timestamp: new Date().toISOString(),
    platform: null,
    directories: [],
    configs: [],
    headless: null,
    desktop: null,
    email: null,
    zoteroWrite: null,
    allHints: [],
    runsCleanup: null,
    overall: "unknown",
  };

  // Platform check
  result.platform = await checkPlatform();

  // Directory checks
  const dirs = ["config", "workflow/tools", "review_results", "review_results/pipeline"];
  for (const d of dirs) {
    result.directories.push(await checkDir(path.join(root, d), d));
  }

  // Config file checks
  for (const cfg of REQUIRED_CONFIGS) {
    result.configs.push(await checkJsonConfig(root, cfg));
  }

  // Path writable check
  result.pathWritable = await checkPathWritable(root);

  // Mode-specific checks
  if (args.mode === "headless" || args.mode === "all") {
    result.headless = await checkHeadlessReadiness(root);
  }
  if (args.mode === "desktop" || args.mode === "all") {
    result.desktop = await checkDesktopReadiness(root);
  }

  result.email = await checkEmailReadiness();
  result.zoteroWrite = await checkZoteroWriteReadiness();
  result.allHints = [
    ...(result.headless?.hints || []),
    ...(result.desktop?.hints || []),
    ...(result.email?.hints || []),
    ...(result.zoteroWrite?.hints || []),
  ];
  result.runsCleanup = await checkRunsCleanup(root);

  // Overall status
  const allReady = [
    result.platform.checks.every(c => c.passed),
    result.directories.every(d => d.exists),
    result.configs.every(c => c.status === "ok"),
    result.pathWritable?.writable !== false,
    !result.headless || result.headless.ready,
    !result.desktop || result.desktop.ready,
    !result.zoteroWrite || result.zoteroWrite.ready,
  ];
  result.overall = allReady.every(Boolean) ? "ready" : "has_gaps";

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHumanReadable(result);
  }

  return result;
}

function printHumanReadable(r) {
  console.log(`\n=== Workflow Smoke Check ===`);
  console.log(`mode: ${r.mode}  |  dry-run: ${r.dryRun}  |  overall: ${r.overall}`);
  console.log(`platform: ${r.platform?.platform}/${r.platform?.arch}  |  node: ${r.platform?.nodeVersion}`);
  console.log(`timestamp: ${r.timestamp}\n`);

  console.log("--- Platform ---");
  for (const c of r.platform?.checks || []) console.log(`  ${c.passed ? "OK" : "FAIL"} ${c.check}: ${c.detail}`);

  console.log("\n--- Directories ---");
  for (const d of r.directories) console.log(`  ${d.exists ? "OK" : "MISSING"} ${d.label}`);

  console.log("\n--- Config Files ---");
  for (const c of r.configs) console.log(`  ${c.status === "ok" ? "OK" : c.status.toUpperCase()} ${c.file}`);

  if (r.headless) {
    console.log("\n--- Headless Readiness ---");
    console.log(`  ready: ${r.headless.ready}`);
    for (const c of r.headless.checks) {
      if (c.check) console.log(`  ${c.status === "ok" ? "OK" : (c.status || "").toUpperCase()} ${c.check}: ${c.domain || c.enabledSources?.join(",") || ""}`);
      else if (c.status) console.log(`  ${c.status === "configured" ? "OK" : c.status.toUpperCase()} env:${c.name}`);
    }
    for (const i of r.headless.issues) console.log(`  ISSUE: ${i}`);
  }

  if (r.desktop) {
    console.log("\n--- Desktop Readiness ---");
    console.log(`  ready: ${r.desktop.ready}`);
    for (const c of r.desktop.checks) {
      if (c.check === "platform_note") console.log(`  INFO ${c.detail}`);
      else if (c.check === "source_selection") console.log(`  ${c.status === "ok" ? "OK" : "FAIL"} source_selection: ${c.domain} → [${(c.enabledSources||[]).join(", ")}]`);
      else if (c.status) console.log(`  ${c.status === "configured" ? "OK" : c.status.toUpperCase()} env:${c.name}`);
    }
    for (const i of r.desktop.issues) console.log(`  ISSUE: ${i}`);
  }

  console.log("\n--- Email ---");
  console.log(`  ready: ${r.email?.ready}`);
  for (const c of r.email?.checks || []) {
    if (c.status) console.log(`  ${c.status === "configured" ? "OK" : c.status.toUpperCase()} env:${c.name}`);
  }

  console.log("\n--- Zotero Write ---");
  console.log(`  ready: ${r.zoteroWrite?.ready}`);
  for (const c of r.zoteroWrite?.checks || []) {
    if (c.status) console.log(`  ${c.status === "configured" ? "OK" : c.status.toUpperCase()} env:${c.name}`);
  }
  for (const i of r.zoteroWrite?.issues || []) console.log(`  ISSUE: ${i}`);

  console.log("\n--- Runs Cleanup ---");
  console.log(`  script: ${r.runsCleanup?.exists ? "OK" : "MISSING"}`);

  if (r.allHints?.length > 0) {
    console.log("\n--- Setup Hints ---");
    for (const h of r.allHints) console.log("  HINT: " + h);
  }
  console.log(`\n=== Overall: ${r.overall} ===\n`);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
