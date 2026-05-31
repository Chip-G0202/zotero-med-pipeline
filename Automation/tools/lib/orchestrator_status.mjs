/**
 * Orchestrator report construction and status derivation.
 *
 * Centralizes the repeated report-building logic that was scattered across
 * multiple early-return / failed / skipped / degraded branches in
 * run_zotero_literature_filter.mjs.
 *
 * Design goals:
 *   - Single source of truth for report shape and field names.
 *   - Deterministic status derivation from stage outcomes + artifacts.
 *   - Keep existing orchestrator_report.json field set intact for consumers.
 *   - No side-effects; pure functions only (except the exported builder).
 */

// ── Canonical workflow status values ─────────────────────────────────────────
// These MUST stay in sync with the main process exit-code mapping:
//   exit 0 → completed | completed_stage1_only | degraded_due_to_mcp_unavailable | skipped
//   exit 1 → everything else

export const WORKFLOW_STATUS = Object.freeze({
  COMPLETED: "completed",
  COMPLETED_WITH_WARNINGS: "completed_with_warnings",
  COMPLETED_STAGE1_ONLY: "completed_stage1_only",
  DEGRADED_DUE_TO_MCP_UNAVAILABLE: "degraded_due_to_mcp_unavailable",
  SKIPPED_DUE_TO_INTERVAL: "skipped_due_to_interval",
  FAILED_STAGE1: "failed_stage1",
  FAILED_STAGE2_WRITEBACK: "failed_stage2_writeback",
  FAILED_STAGE3_TRANSLATION: "failed_stage3_translation",
  FAILED_STAGE4_EXPORT: "failed_stage4_export",
  FAILED_DUE_TO_CONFIG_OR_DEPENDENCY: "failed_due_to_config_or_dependency",
});

// ── Run context builder ──────────────────────────────────────────────────────

/**
 * Build the canonical run-context object that every report carries.
 *
 * @param {object} opts
 * @param {string} opts.automationName
 * @param {string} opts.runId
 * @param {string} opts.platform
 * @param {string} opts.startedAt - ISO-8601
 * @param {string} opts.triggerMode
 * @param {object} opts.runMode - from detectRunMode()
 * @param {boolean} opts.manualTrigger
 * @param {string} opts.pipelineDir
 * @returns {object} Frozen run-context snapshot
 */
export function buildRunContext({
  automationName,
  runId,
  platform,
  startedAt,
  triggerMode,
  runMode,
  manualTrigger,
  pipelineDir,
}) {
  const explicitForceRun = Boolean(runMode?.explicitForceRun);
  const forceRun = Boolean(manualTrigger || explicitForceRun);
  const bypassIntervalGate = forceRun; // force implies bypass
  const bypassReason = explicitForceRun
    ? "explicit_force_run"
    : manualTrigger
      ? "manual_bypass_interval_gate"
      : null;

  return Object.freeze({
    automationName,
    runId,
    platform,
    startedAt,
    triggerMode,
    runMode,
    forceRun,
    explicitForceRun,
    bypassIntervalGate,
    bypassReason,
    pipelineDir,
  });
}

// ── Status derivation ────────────────────────────────────────────────────────

/**
 * Derive the canonical workflow status from stage outcomes and artifacts.
 *
 * Call-site responsibilities:
 *   - Pass the caller's explicit status override when the branch already
 *     knows the answer (e.g. "skipped", "completed_stage1_only").
 *   - For the fall-through path (stages ran sequentially), pass null/undefined
 *     and let this function infer from stages + artifacts.
 *
 * @param {object} opts
 * @param {string|null} [opts.explicitStatus] - Caller override; wins over inference.
 * @param {Array<object>} opts.stages - Stage outcome array.
 * @param {object} [opts.artifacts] - Artifact inspection results.
 * @returns {string} One of WORKFLOW_STATUS values.
 */
export function deriveWorkflowStatus({ explicitStatus, stages, artifacts }) {
  // Caller already decided (e.g. "skipped", "completed_stage1_only", "degraded…")
  if (explicitStatus) return explicitStatus;

  // ── Infer from stages ──────────────────────────────────────────────────
  const stageByName = new Map(stages.map((s) => [s.name, s]));

  // Stage 1 failed → failed_stage1
  const s1 = stageByName.get("stage1");
  if (s1 && s1.status === "failed") return WORKFLOW_STATUS.FAILED_STAGE1;

  // MCP readiness failed → degraded (if stage1 ok) or failed (if stage1 also failed)
  const mcp = stageByName.get("mcp_ready");
  if (mcp && mcp.status === "failed") {
    return s1?.status === "completed"
      ? WORKFLOW_STATUS.DEGRADED_DUE_TO_MCP_UNAVAILABLE
      : WORKFLOW_STATUS.FAILED_STAGE1; // stage1 failed is already caught above, defensive
  }

  // Stage 2 failed → failed_stage2_writeback
  const s2 = stageByName.get("stage2_writeback");
  if (s2 && s2.status === "failed") return WORKFLOW_STATUS.FAILED_STAGE2_WRITEBACK;

  // Stage 3 failed (hard failure, not partial) → failed_stage3_translation
  const s3 = stageByName.get("stage3_translation");
  if (s3 && s3.status === "failed") return WORKFLOW_STATUS.FAILED_STAGE3_TRANSLATION;

  // Stage 4 failed → failed_stage4_export
  const s4 = stageByName.get("stage4_exports");
  if (s4 && s4.status === "failed") return WORKFLOW_STATUS.FAILED_STAGE4_EXPORT;

  // Stage 4 completed but stage3 had partial failures → completed_with_warnings
  if (s4?.status === "completed" && s3?.status === "partial_failed") {
    return WORKFLOW_STATUS.COMPLETED_WITH_WARNINGS;
  }

  // All completed → completed
  if (s4?.status === "completed") return WORKFLOW_STATUS.COMPLETED;

  // Fallback: should not happen in normal flow
  return WORKFLOW_STATUS.FAILED_DUE_TO_CONFIG_OR_DEPENDENCY;
}

// ── Orchestrator report builder ──────────────────────────────────────────────

/**
 * Build the full orchestrator report object.
 *
 * @param {object} opts
 * @param {string} opts.status - From deriveWorkflowStatus or caller override.
 * @param {object} opts.runContext - From buildRunContext.
 * @param {string} opts.finishedAt - ISO-8601
 * @param {Array<object>} opts.stages
 * @param {object} opts.artifacts
 * @param {Array<string>} [opts.warnings] - Optional warning strings.
 * @param {object} [opts.extra] - Additional top-level fields (e.g. skipReport, stage1Only).
 * @returns {object} The report object ready for JSON serialization.
 */
export function buildOrchestratorReport({
  status,
  runContext,
  finishedAt,
  stages,
  artifacts,
  warnings,
  extra,
}) {
  const report = {
    // ── Core identity ──────────────────────────────────────────────────
    automationName: runContext.automationName,
    runId: runContext.runId,
    platform: runContext.platform,
    startedAt: runContext.startedAt,
    finishedAt,

    // ── Status ─────────────────────────────────────────────────────────
    status,

    // ── Trigger / mode ─────────────────────────────────────────────────
    triggerMode: runContext.triggerMode,
    runMode: runContext.runMode,
    forceRun: runContext.forceRun,
    explicitForceRun: runContext.explicitForceRun,
    bypassIntervalGate: runContext.bypassIntervalGate,
    bypassReason: runContext.bypassReason,

    // ── Location ───────────────────────────────────────────────────────
    pipelineDir: runContext.pipelineDir,

    // ── Pipeline outcomes ──────────────────────────────────────────────
    stages,
    artifacts,
  };

  // Attach warnings if present and non-empty
  if (warnings && warnings.length > 0) {
    report.warnings = warnings;
  }

  // Merge extra fields (skipReport, stage1Only, etc.)
  if (extra && typeof extra === "object") {
    Object.assign(report, extra);
  }

  return report;
}

// ── Convenience: exit-code mapping ───────────────────────────────────────────

// Statuses that map to exit code 0
const EXIT_ZERO_STATUSES = new Set([
  WORKFLOW_STATUS.COMPLETED,
  WORKFLOW_STATUS.COMPLETED_STAGE1_ONLY,
  WORKFLOW_STATUS.DEGRADED_DUE_TO_MCP_UNAVAILABLE,
  WORKFLOW_STATUS.SKIPPED_DUE_TO_INTERVAL,
  // Legacy alias: original code used "skipped" for interval gate
  "skipped",
]);

/**
 * Map a workflow status to the process exit code.
 *
 * @param {string} status
 * @returns {number} 0 or 1
 */
export function workflowStatusToExitCode(status) {
  return EXIT_ZERO_STATUSES.has(status) ? 0 : 1;
}
