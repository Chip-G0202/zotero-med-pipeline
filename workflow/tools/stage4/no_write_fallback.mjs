export const NO_WRITE_FALLBACK_REASON = "skip_zotero_or_no_write_mode";

export function resolveNoWriteExportFlags(runReport = {}) {
  const runtimeSafety = runReport.runtime_safety_config || runReport.runtime_safety || {};
  const connector = runReport.steps?.connector || {};
  return {
    dry_run: Boolean(runReport.dry_run || runReport.dryRun || runtimeSafety.dry_run),
    skip_zotero_mcp: Boolean(
      runReport.skip_zotero_mcp ||
        runReport.skipZoteroMcp ||
        runtimeSafety.skip_zotero_mcp ||
        connector.skip_zotero_mcp ||
        connector.skipped
    ),
    no_formal_rule_apply: Boolean(
      runReport.no_formal_rule_apply ||
        runReport.noFormalRuleApply ||
        runtimeSafety.no_formal_rule_apply ||
        runtimeSafety.formal_writes_allowed === false
    ),
    zotero_probe_attempted: connector.probe_attempted === true || runReport.zotero_probe_attempted === true,
    zotero_writeback_attempted: connector.writeback_attempted === true || runReport.zotero_writeback_attempted === true,
  };
}

export function isNoWriteExportMode(runReport = {}) {
  const flags = resolveNoWriteExportFlags(runReport);
  return flags.dry_run || flags.skip_zotero_mcp || flags.no_formal_rule_apply;
}

export function buildNoWriteBackfillFallback(runReport = {}) {
  const flags = resolveNoWriteExportFlags(runReport);
  return {
    ok: false,
    skipped: true,
    fallback_used: true,
    translation_backfill_missing: true,
    reason: NO_WRITE_FALLBACK_REASON,
    skip_zotero_mcp: flags.skip_zotero_mcp,
    no_formal_rule_apply: flags.no_formal_rule_apply,
    writeback_attempted: false,
    updated_items: [],
    failure_count: 0,
    failures: [],
  };
}

export function buildNoWriteWritebackSummaryFallback(runReport = {}) {
  const flags = resolveNoWriteExportFlags(runReport);
  return {
    ok: false,
    skipped: true,
    fallback_used: true,
    writeback_summary_missing: true,
    reason: NO_WRITE_FALLBACK_REASON,
    skip_zotero_mcp: flags.skip_zotero_mcp,
    no_formal_rule_apply: flags.no_formal_rule_apply,
    probe_attempted: false,
    writeback_attempted: false,
    writeback_items: [],
    failures: [],
  };
}

export function buildStage4NoWriteFallbackAudit({
  runReport = {},
  translationBackfillMissing = false,
  writebackSummaryMissing = false,
} = {}) {
  const flags = resolveNoWriteExportFlags(runReport);
  const fallbackUsed = Boolean(translationBackfillMissing || writebackSummaryMissing);
  return {
    no_write_export_mode: isNoWriteExportMode(runReport),
    dry_run: flags.dry_run,
    skip_zotero_mcp: flags.skip_zotero_mcp,
    no_formal_rule_apply: flags.no_formal_rule_apply,
    zotero_probe_attempted: flags.zotero_probe_attempted,
    zotero_writeback_attempted: flags.zotero_writeback_attempted,
    translation_backfill_missing: Boolean(translationBackfillMissing),
    writeback_summary_missing: Boolean(writebackSummaryMissing),
    fallback_used: fallbackUsed,
    reason: fallbackUsed ? NO_WRITE_FALLBACK_REASON : "",
  };
}
