import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSourceSelectionConfig, resolveRetrievalPlan, loadOpenAlexConfig, loadRssSources, loadPubMedPmcSearchConfig } from "../lib/literature_config.mjs";
import { emailTransportConfig } from "../stage5/email_sender.mjs";

const HELP = `Usage: node workflow/tools/maintenance/workflow_dry_run.mjs [options]

End-to-end workflow dry-run — simulates the full pipeline plan without side effects.

Options:
  --mode <mode>     Check mode: headless | desktop | all (default: all)
  --fixture         Use built-in mock literature data (default: enabled)
  --json            Output machine-readable JSON summary
  --help            Show this message

Modes:
  headless   Simulate API-only path (no Zotero Desktop)
  desktop    Simulate Zotero Desktop/CLI path
  all        Simulate both paths

This is a dry-run only: no external APIs called, no emails sent, no Zotero writes, no cleanup.`;

function parseArgs(argv) {
  const args = { mode: "all", fixture: true, json: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { args.help = true; continue; }
    if (a === "--json") { args.json = true; continue; }
    if (a === "--fixture") { args.fixture = true; continue; }
    if (a === "--mode" && i + 1 < argv.length) { args.mode = argv[++i]; continue; }
  }
  return args;
}

// Mock literature data for dedupe simulation
const MOCK_ITEMS = {
  rss: [
    { title: "CRISPR gene editing in sickle cell disease", doi: "10.0000/example.031", source_channel: "rss", publication_date: "2026-06-20" },
    { title: "Machine learning for drug discovery", doi: "10.0000/example.032", source_channel: "rss", publication_date: "2026-06-21" },
    { title: "mRNA vaccine platform advances", doi: "10.0000/example.033", source_channel: "rss", publication_date: "2026-06-22" },
  ],
  pubmed_pmc: [
    { title: "CRISPR gene editing in sickle cell disease", doi: "10.0000/example.031", source_channel: "pubmed", pmid: "990000001", publication_date: "2026-06-20" },
    { title: "CAR-T cell therapy outcomes", doi: "10.0000/example.029", source_channel: "pubmed", pmid: "990000002", publication_date: "2026-06-19" },
    { title: "Protein folding prediction", doi: "10.0000/example.030", source_channel: "pubmed", pmid: "990000003", publication_date: "2026-06-18" },
  ],
  openalex: [
    { title: "Machine learning for drug discovery", doi: "10.0000/example.032", source_channel: "openalex", openalex_id: "W12345", publication_date: "2026-06-21" },
    { title: "Quantum computing in materials science", doi: "10.0000/example.027", source_channel: "openalex", openalex_id: "W12346", publication_date: "2026-06-17" },
    { title: "Graph neural networks for molecular property prediction", doi: "10.0000/example.028", source_channel: "openalex", openalex_id: "W12347", publication_date: "2026-06-16" },
  ],
};

function dedupItems(items) {
  const seen = new Map();
  for (const item of items) {
    const key = item.doi || item.pmid || item.openalex_id || item.title;
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

function checkEnvVar(name) {
  const val = process.env[name];
  if (val === undefined) return "missing";
  if (val === "" || val.startsWith("your_")) return "placeholder";
  return "configured";
}

function buildRetrievalPlan(sourceSelection, openAlexConfig, rssConfig, pubmedConfig, mode) {
  const plan = resolveRetrievalPlan(sourceSelection);
  const sources = [];

  // RSS
  sources.push({
    name: "rss",
    enabled: plan.rssEnabled,
    configPath: rssConfig?.path || "config/rss_sources.json",
    configStatus: rssConfig ? "ok" : "missing",
    queryDescription: plan.rssEnabled ? `${rssConfig?.sources?.length || 0} RSS feeds configured` : "disabled by source selection",
    mockItemCount: plan.rssEnabled ? MOCK_ITEMS.rss.length : 0,
  });

  // PubMed/PMC
  sources.push({
    name: "pubmed_pmc",
    enabled: plan.pubmedEnabled,
    configPath: pubmedConfig?.path || "config/pubmed_pmc_search.json",
    configStatus: pubmedConfig ? "ok" : "missing",
    queryDescription: plan.pubmedEnabled ? `PubMed/PMC query configured, days_back=${pubmedConfig?.days_back || 10}` : "disabled by source selection",
    mockItemCount: plan.pubmedEnabled ? MOCK_ITEMS.pubmed_pmc.length : 0,
  });

  // OpenAlex
  sources.push({
    name: "openalex",
    enabled: plan.openalexEnabled,
    configPath: openAlexConfig?.path || "config/openalex_search.json",
    configStatus: openAlexConfig ? (openAlexConfig.enabled ? "ok" : "disabled_in_config") : "missing",
    queryDescription: plan.openalexEnabled ? `OpenAlex query: "${(openAlexConfig?.query || "").substring(0, 50)}"` : "disabled by source selection",
    mockItemCount: plan.openalexEnabled ? MOCK_ITEMS.openalex.length : 0,
  });

  return { plan, sources, mode };
}

function buildReadinessGaps(mode) {
  const gaps = [];
  const skipped = [];

  // Zotero readiness
  if (mode === "headless" || mode === "all") {
    const apiKey = checkEnvVar("ZOTERO_API_KEY");
    if (apiKey !== "configured") gaps.push({ area: "zotero_headless", issue: "ZOTERO_API_KEY not configured", severity: "required_for_write" });
    skipped.push({ action: "zotero_web_api_call", reason: "dry-run: no real Zotero API calls" });
  }

  if (mode === "desktop" || mode === "all") {
    const backend = checkEnvVar("ZOTERO_BACKEND");
    if (backend !== "configured") gaps.push({ area: "zotero_desktop", issue: "ZOTERO_BACKEND not configured", severity: "optional_defaults_to_auto" });
    skipped.push({ action: "zotero_desktop_write", reason: "dry-run: no Zotero writes" });
    skipped.push({ action: "zotero_cli_call", reason: "dry-run: no CLI calls" });
  }

  // Email readiness
  const reportTo = checkEnvVar("PAPERFLOW_REPORT_TO") === "configured" || checkEnvVar("NOTIFICATION_EMAIL") === "configured";
  if (reportTo) {
    const smtp = emailTransportConfig(process.env);
    if (!smtp.configured) gaps.push({ area: "email", issue: smtp.error, severity: "required_for_notification" });
  }
  skipped.push({ action: "send_email", reason: "dry-run: no emails sent" });

  // External API calls
  skipped.push({ action: "fetch_pubmed", reason: "dry-run: no PubMed API calls" });
  skipped.push({ action: "fetch_openalex", reason: "dry-run: no OpenAlex API calls" });
  skipped.push({ action: "fetch_rss", reason: "dry-run: no RSS fetches" });
  skipped.push({ action: "cleanup_apply", reason: "dry-run: no file deletions" });

  return { gaps, skipped };
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
    dryRun: true,
    fixture: args.fixture,
    timestamp: new Date().toISOString(),
    platform: process.platform,
    root,
    sourceSelection: null,
    retrievalPlan: null,
    mockDedupe: null,
    readinessGaps: { headless: null, desktop: null },
    overall: "unknown",
  };

  // 1. Load source selection
  try {
    const sourceSelection = loadSourceSelectionConfig({ root });
    result.sourceSelection = {
      domain: sourceSelection.research_domain,
      primarySources: sourceSelection.primary_sources,
      supplementalSources: sourceSelection.supplemental_sources,
      enabledSources: sourceSelection.enabled_sources,
      requireManualConfirmation: sourceSelection.require_manual_confirmation,
    };

    // Check if manual confirmation blocks execution
    if (sourceSelection.require_manual_confirmation && sourceSelection.research_domain === "unknown") {
      result.overall = "blocked";
      result.blockReason = "require_manual_confirmation=true with unknown domain";
      if (args.json) { console.log(JSON.stringify(result, null, 2)); } else { printResult(result); }
      return result;
    }

    // 2. Load config files
    const openAlexConfig = loadOpenAlexConfig({ root });
    let rssConfig = null;
    let pubmedConfig = null;
    try { rssConfig = loadRssSources({ root }); } catch { /* missing */ }
    try { pubmedConfig = loadPubMedPmcSearchConfig({ root }); } catch { /* missing */ }

    // 3. Build retrieval plan
    const retrievalPlan = buildRetrievalPlan(sourceSelection, openAlexConfig, rssConfig, pubmedConfig, args.mode);
    result.retrievalPlan = retrievalPlan;

    // 4. Simulate retrieval with mock data
    const enabledSources = retrievalPlan.sources.filter(s => s.enabled);
    const mockItems = [];
    for (const src of enabledSources) {
      mockItems.push(...(MOCK_ITEMS[src.name] || []));
    }

    // 5. Simulate dedupe
    const deduped = dedupItems(mockItems);
    result.mockDedupe = {
      inputCount: mockItems.length,
      dedupedCount: deduped.length,
      duplicatesRemoved: mockItems.length - deduped.length,
      bySource: Object.fromEntries(
        ["rss", "pubmed", "openalex"].map(s => [s, mockItems.filter(i => i.source_channel === s).length])
      ),
    };

    // 6. Readiness gaps per mode
    if (args.mode === "headless" || args.mode === "all") {
      result.readinessGaps.headless = buildReadinessGaps("headless");
    }
    if (args.mode === "desktop" || args.mode === "all") {
      result.readinessGaps.desktop = buildReadinessGaps("desktop");
    }

    // 7. Report plan output paths
    result.artifactPlan = {
      runReportPath: "review_results/pipeline/<date>/run_report.json",
      triagedItemsPath: "review_results/pipeline/<date>/triaged_items.json",
      mergedItemsPath: "review_results/pipeline/<date>/merged_items.json",
      note: "These are planned paths only; no files written in dry-run mode.",
    };

    // 8. Overall status
    const allGaps = [
      ...(result.readinessGaps.headless?.gaps || []),
      ...(result.readinessGaps.desktop?.gaps || []),
    ];
    const requiredGaps = allGaps.filter(g => g.severity === "required_for_write" || g.severity === "required_for_notification");
    result.overall = requiredGaps.length > 0 ? "has_gaps" : "ok";

  } catch (e) {
    result.overall = "error";
    result.error = e.message;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printResult(result);
  }
  return result;
}

function printResult(r) {
  console.log(`\n=== Workflow E2E Dry-Run ===`);
  console.log(`mode: ${r.mode}  |  dry-run: true  |  overall: ${r.overall}`);
  console.log(`platform: ${r.platform}  |  root: ${r.root}`);
  console.log(`timestamp: ${r.timestamp}\n`);

  if (r.blockReason) {
    console.log(`BLOCKED: ${r.blockReason}\n`);
    return;
  }

  if (r.sourceSelection) {
    console.log("--- Source Selection ---");
    console.log(`  domain: ${r.sourceSelection.domain}`);
    console.log(`  primary: [${r.sourceSelection.primarySources.join(", ")}]`);
    console.log(`  supplemental: [${r.sourceSelection.supplementalSources.join(", ")}]`);
    console.log(`  enabled: [${r.sourceSelection.enabledSources.join(", ")}]`);
    if (r.sourceSelection.requireManualConfirmation) console.log("  WARNING: require_manual_confirmation=true");
  }

  if (r.retrievalPlan) {
    console.log("\n--- Retrieval Plan ---");
    for (const src of r.retrievalPlan.sources) {
      const status = src.enabled ? "ENABLED" : "disabled";
      console.log(`  ${status} ${src.name}: ${src.queryDescription} (${src.configStatus})`);
    }
  }

  if (r.mockDedupe) {
    console.log("\n--- Mock Dedupe Simulation ---");
    console.log(`  input items: ${r.mockDedupe.inputCount}`);
    console.log(`  after dedup: ${r.mockDedupe.dedupedCount}`);
    console.log(`  duplicates removed: ${r.mockDedupe.duplicatesRemoved}`);
    console.log(`  by source: rss=${r.mockDedupe.bySource.rss} pubmed=${r.mockDedupe.bySource.pubmed} openalex=${r.mockDedupe.bySource.openalex}`);
  }

  if (r.artifactPlan) {
    console.log("\n--- Artifact Plan (not written) ---");
    console.log(`  run report: ${r.artifactPlan.runReportPath}`);
    console.log(`  triaged items: ${r.artifactPlan.triagedItemsPath}`);
  }

  const gaps = r.readinessGaps;
  if (gaps.headless) {
    console.log("\n--- Headless Readiness ---");
    console.log(`  gaps: ${gaps.headless.gaps.length}`);
    for (const g of gaps.headless.gaps) console.log(`    ${g.severity}: ${g.issue}`);
  }
  if (gaps.desktop) {
    console.log("\n--- Desktop Readiness ---");
    console.log(`  gaps: ${gaps.desktop.gaps.length}`);
    for (const g of gaps.desktop.gaps) console.log(`    ${g.severity}: ${g.issue}`);
  }

  const allSkipped = [...(gaps.headless?.skipped || []), ...(gaps.desktop?.skipped || [])];
  if (allSkipped.length > 0) {
    console.log("\n--- Skipped Actions (dry-run) ---");
    for (const s of allSkipped) console.log(`  SKIP ${s.action}: ${s.reason}`);
  }

  console.log(`\n=== Overall: ${r.overall} ===\n`);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
