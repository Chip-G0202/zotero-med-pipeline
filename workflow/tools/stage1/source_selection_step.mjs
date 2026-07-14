/**
 * Source selection and retrieval step.
 *
 * Determines which retrieval sources to run based on source_selection.json,
 * executes the enabled sources, and returns the results.
 */
import { loadSourceSelectionConfig, loadOpenAlexConfig, resolveRetrievalPlan } from "../lib/literature_config.mjs";
import { runSelectedRetrievalSources } from "./retrieval_step.mjs";
import { buildStage1SourceSummary } from "./source_summary.mjs";

/**
 * Run source selection and retrieval.
 *
 * @param {Object} options
 * @param {string} options.root - Project root
 * @param {Object} options.pubmedPmcConfig - PubMed/PMC config
 * @param {Object} options.now - Current date
 * @returns {Promise<{merged: Array, sourceSummary: Object, sourceSelection: Object, rss: Object, db: Object, openalex: Object}>}
 */
export async function runSourceSelectionAndFetch({ root, pubmedPmcConfig, now }) {
  // Load source selection config
  const sourceSelection = loadSourceSelectionConfig({ root });
  const { rssEnabled, pubmedEnabled, openalexEnabled, manualConfirmationRequired } = resolveRetrievalPlan(sourceSelection);

  // Build source selection report
  const sourceSelectionReport = {
    ok: true,
    research_domain: sourceSelection.research_domain,
    primary_sources: sourceSelection.primary_sources,
    supplemental_sources: sourceSelection.supplemental_sources,
    enabled_sources: sourceSelection.enabled_sources || [],
    require_manual_confirmation: manualConfirmationRequired,
    warnings: sourceSelection.warnings || [],
  };

  // Load OpenAlex config if enabled
  const openAlexCfg = openalexEnabled ? loadOpenAlexConfig({ root }) : null;

  // Run retrieval
  const { rss, db, openalex } = await runSelectedRetrievalSources({
    root,
    pubmedPmcConfig,
    openAlexConfig: openAlexCfg,
    plan: { rssEnabled, pubmedEnabled, openalexEnabled },
  });

  // Build source summary
  const sourceCollectionSummary = buildStage1SourceSummary({
    sources: [
      {
        name: "rss",
        enabled: rssEnabled,
        triggered: rssEnabled,
        itemsCollectedCount: rss.items.length,
        enteredPreDedupCollection: rss.items.length > 0,
        skippedReason: !rssEnabled ? "not_enabled_in_source_selection" : (rss.items.length === 0 ? "no_items" : null),
        failureReason: rss.failed.length > 0 ? "partial_failure" : null,
        degraded: rss.failed.length > 0,
        warningsCount: (rss.config?.warnings || []).length,
      },
      {
        name: "pubmed_pmc",
        enabled: pubmedEnabled,
        triggered: pubmedEnabled,
        itemsCollectedCount: db.items.length,
        enteredPreDedupCollection: db.items.length > 0,
        skippedReason: !pubmedEnabled ? "not_enabled_in_source_selection" : (db.items.length === 0 ? "no_items" : null),
        failureReason: db.failed.length > 0 ? "partial_failure" : null,
        degraded: db.failed.length > 0,
        warningsCount: (db.config?.warnings || []).length,
      },
      {
        name: "openalex",
        enabled: openalexEnabled,
        triggered: openalexEnabled,
        itemsCollectedCount: openalex.items.length,
        enteredPreDedupCollection: openalex.items.length > 0,
        skippedReason: !openalexEnabled ? "not_enabled_in_source_selection" : (openalex.items.length === 0 ? "no_items" : null),
        failureReason: openalex.failed.length > 0 ? "partial_failure" : null,
        degraded: openalex.failed.length > 0,
        warningsCount: (openalex.config?.warnings || []).length,
      },
    ],
    preDedupItemsCount: rss.items.length + db.items.length + openalex.items.length,
  });

  return {
    sourceSelection: sourceSelectionReport,
    sourceCollectionSummary,
    rss,
    db,
    openalex,
  };
}
