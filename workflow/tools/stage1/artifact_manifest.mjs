import path from "node:path";

function artifactEntry({
  pipelineDir,
  name,
  purpose,
  required = false,
  written = "unknown",
  stageDependency = null,
  guardedByOrchestrator = false,
} = {}) {
  return {
    name,
    path: path.join(pipelineDir, name),
    purpose,
    required,
    written,
    stage_dependency: stageDependency,
    guarded_by_orchestrator: guardedByOrchestrator,
  };
}

export function buildStage1ArtifactManifest({
  pipelineDay = "",
  pipelineDir = "",
  mode = "completed",
  written = true,
  retrievalWritten = written,
} = {}) {
  const isSkipped = mode === "skipped";
  const completedWritten = isSkipped ? "skipped" : written;
  const reportWritten = isSkipped ? true : written;
  return {
    pipeline_day: pipelineDay,
    pipeline_dir: pipelineDir,
    run_mode: mode,
    required_for_stage2: [
      artifactEntry({
        pipelineDir,
        name: "writeback_ready_items.json",
        purpose: "Stage 1 to Stage 2 Zotero writeback input",
        required: true,
        written: completedWritten,
        stageDependency: "stage2",
        guardedByOrchestrator: true,
      }),
    ],
    review_outputs: isSkipped ? [] : [
      artifactEntry({
        pipelineDir,
        name: "triaged_export_items.json",
        purpose: "Daily review/export item subset",
        written,
      }),
      artifactEntry({
        pipelineDir,
        name: "desktop_daily_review_source.json",
        purpose: "Desktop daily review source payload",
        written,
      }),
    ],
    audit_outputs: isSkipped ? [] : [
      artifactEntry({ pipelineDir, name: "retrieval_audit.json", purpose: "Atomic retrieval completeness and source-state commit evidence", written: retrievalWritten }),
      artifactEntry({ pipelineDir, name: "timing_diagnostics.json", purpose: "Stage 1 timing diagnostics", written: "unknown" }),
      artifactEntry({ pipelineDir, name: "manual_standard_evaluation_audit.json", purpose: "Screening standards manual evaluation audit", written: "unknown" }),
      artifactEntry({ pipelineDir, name: "semantic_preference_refinement.json", purpose: "Compatibility report for removed semantic preference refinement", written }),
      artifactEntry({ pipelineDir, name: "llm_preference_learning.json", purpose: "LLM preference learning report", written: "unknown" }),
      artifactEntry({ pipelineDir, name: "preference_learning_audit.json", purpose: "Preference learning audit", written }),
      artifactEntry({ pipelineDir, name: "preference_learning_initial_audit.json", purpose: "Preference learning initial audit (pre-screening-standards update)", written }),
      artifactEntry({ pipelineDir, name: "pubmed_journal_quality_gate_report.json", purpose: "EasyScholar journal quality gate audit", written }),
      artifactEntry({ pipelineDir, name: "llm_grade_review.json", purpose: "LLM grade review report", written: "unknown" }),
      artifactEntry({ pipelineDir, name: "standards_rule_suggestions.json", purpose: "Pending screening standards rule suggestions snapshot", written: "unknown" }),
      artifactEntry({ pipelineDir, name: "daily_failed_feeds.json", purpose: "RSS failure audit", written }),
      artifactEntry({ pipelineDir, name: "feedback_item_actions_plan.json", purpose: "Feedback item action plan when generated", written: "unknown" }),
    ],
    report_outputs: [
      artifactEntry({
        pipelineDir,
        name: "run_report.json",
        purpose: isSkipped ? "Stage 1 internal interval skip report alias" : "Stage 1 run report",
        written: reportWritten,
      }),
      ...(isSkipped ? [] : [
        artifactEntry({ pipelineDir, name: "skill_alignment.json", purpose: "Stage skill alignment diagnostics", written }),
        artifactEntry({ pipelineDir, name: "pending_zotero_writeback.json", purpose: "Stage 2 writeback handoff summary", written }),
      ]),
    ],
    skipped_outputs: isSkipped ? [
      artifactEntry({
        pipelineDir,
        name: "run_skip_report.json",
        purpose: "Stage 1 internal interval skip report",
        written: true,
      }),
    ] : [],
    notes: [
      "manifest_records_paths_and_write_status_only",
      "writeback_ready_items_json_remains_the_orchestrator_guarded_stage2_input",
      isSkipped
        ? "interval_skip_does_not_write_writeback_ready_items_json"
        : "completed_path_writes_writeback_ready_items_json_before_stage2",
    ],
  };
}
