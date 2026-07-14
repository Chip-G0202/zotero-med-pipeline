/**
 * Stage 1 completed-path artifact writer.
 *
 * Writes the bulk of Stage 1 pipeline artifacts to disk in the same
 * order as the original inline writes in stage1/main.mjs.
 *
 * This function HAS side effects (writes files) but:
 *   - does NOT call external services
 *   - does NOT access the network
 *   - does NOT call LLM
 *   - does NOT read or modify process.env
 *   - does NOT mutate input objects
 *
 * Intentionally NOT extracted writes (retained in pipeline):
 *   - skip-path writes (run_skip_report.json + run_report.json alias)
 *   - timing diagnostics (writeTimingDiagnostics / flushTimingDiagnostics)
 *   - semantic_preference_refinement.json (interleaved with med_query_learning)
 *   - preference_learning_initial_audit.json (early, before screening standards)
 *   - pubmed_journal_quality_gate_report.json (immediately after gate)
 *   - preference_learning_audit.json (final, before report assembly)
 *   - standards_rule_suggestions.json (in try block)
 *   - feedback_item_actions_plan.json (in try block)
 *   - top-level catch timing diagnostics (outside runResearchOsPipeline)
 */

import fs from "node:fs/promises";
import path from "node:path";

/**
 * @param {Object} params
 * @param {string} params.pipeDir
 * @param {Object[]} params.rssItems
 * @param {Object[]} params.rssFailed
 * @param {Object[]} params.dbItems
 * @param {Object[]} params.mergedItems
 * @param {Object[]} params.triagedAll
 * @param {Object[]} params.triaged
 * @param {Object[]} params.writebackReady
 * @param {string} params.dateStr
 * @param {Object} params.report
 * @param {Object[]} params.abcAllItems
 * @param {Object} params.preferenceAuditWithImpact

 * @returns {Promise<void>}
 */
export async function writeStage1CompletedArtifacts({
  pipeDir,
  rssItems = [],
  rssFailed = [],
  dbItems = [],
  mergedItems = [],
  triagedAll = [],
  triaged = [],
  writebackReady = [],
  dateStr = "",
  report = {},
  abcAllItems = [],
  preferenceAuditWithImpact = null,
} = {}) {
  // Phase 1: raw/intermediate data artifacts (order preserved)
  await fs.writeFile(path.join(pipeDir, "rss_items.json"), JSON.stringify(rssItems, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "db_items.json"), JSON.stringify(dbItems, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "merged_items.json"), JSON.stringify(mergedItems, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "triaged_items.json"), JSON.stringify(triagedAll, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "triaged_export_items.json"), JSON.stringify(triaged, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "writeback_ready_items.json"), JSON.stringify(writebackReady, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "daily_failed_feeds.json"), JSON.stringify({
    date: dateStr,
    failed_count: rssFailed.length,
    failed_feeds: rssFailed,
  }, null, 2), "utf8");
  await fs.writeFile(path.join(pipeDir, "pending_zotero_writeback.json"), JSON.stringify(report.pending_zotero_writeback, null, 2), "utf8");

  // Phase 2: first run_report write (caller mutates manifest before this)
  await fs.writeFile(path.join(pipeDir, "run_report.json"), JSON.stringify(report, null, 2), "utf8");

  // Phase 3: desktop review source + final metadata
  const desktopJsonPath = path.join(pipeDir, "desktop_daily_review_source.json");
  await fs.writeFile(desktopJsonPath, JSON.stringify({
    date: dateStr,
    triaged: abcAllItems,
    reportContext: {
      feedbackLearning: report.steps?.feedback_learning,
      preferenceLearningAudit: preferenceAuditWithImpact,
      translation: report.steps?.translation,
      connector: report.steps?.connector,
      counts: report.counts,
      failures: report.failures,
      skillAlignment: report.steps?.skill_alignment,
    },
  }, null, 2), "utf8");

  // Phase 4: skill alignment + final run_report (caller mutates report metadata before this)
  await fs.writeFile(path.join(pipeDir, "skill_alignment.json"), JSON.stringify(report.steps?.skill_alignment, null, 2), "utf8");

  await fs.writeFile(path.join(pipeDir, "run_report.json"), JSON.stringify(report, null, 2), "utf8");
}
