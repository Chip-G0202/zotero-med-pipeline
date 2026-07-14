import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildNoWriteBackfillFallback,
  buildNoWriteWritebackSummaryFallback,
  buildStage4NoWriteFallbackAudit,
  isNoWriteExportMode,
} from "../tools/stage4/no_write_fallback.mjs";
import { buildStage4RuntimeStateUpdate } from "../tools/stage4/main.mjs";

describe("stage4 no-write fallback", () => {
  it("allows missing Stage3/Stage2 artifacts only in skip Zotero or no-write mode", () => {
    assert.equal(isNoWriteExportMode({
      skip_zotero_mcp: true,
      no_formal_rule_apply: true,
    }), true);

    assert.equal(isNoWriteExportMode({
      runtime_safety_config: { formal_writes_allowed: false },
    }), true);

    assert.equal(isNoWriteExportMode({
      skip_zotero_mcp: false,
      no_formal_rule_apply: false,
      runtime_safety_config: { formal_writes_allowed: true },
    }), false);
  });

  it("does not mark fallback artifacts as real Zotero writeback success", () => {
    const runReport = {
      skip_zotero_mcp: true,
      no_formal_rule_apply: true,
      steps: {
        connector: {
          skipped: true,
          probe_attempted: false,
        },
      },
    };

    const backfill = buildNoWriteBackfillFallback(runReport);
    const writeback = buildNoWriteWritebackSummaryFallback(runReport);

    assert.equal(backfill.fallback_used, true);
    assert.equal(backfill.translation_backfill_missing, true);
    assert.equal(backfill.writeback_attempted, false);
    assert.deepEqual(backfill.updated_items, []);

    assert.equal(writeback.fallback_used, true);
    assert.equal(writeback.writeback_summary_missing, true);
    assert.equal(writeback.probe_attempted, false);
    assert.equal(writeback.writeback_attempted, false);
    assert.deepEqual(writeback.writeback_items, []);
  });

  it("records explicit fallback audit fields for export reports", () => {
    const audit = buildStage4NoWriteFallbackAudit({
      runReport: {
        dry_run: false,
        skip_zotero_mcp: true,
        no_formal_rule_apply: true,
      },
      translationBackfillMissing: true,
      writebackSummaryMissing: true,
    });

    assert.equal(audit.no_write_export_mode, true);
    assert.equal(audit.translation_backfill_missing, true);
    assert.equal(audit.writeback_summary_missing, true);
    assert.equal(audit.fallback_used, true);
    assert.equal(audit.reason, "skip_zotero_or_no_write_mode");
    assert.equal(audit.zotero_writeback_attempted, false);
  });

  it("does not let manual full runs advance the scheduled cadence state", () => {
    const runtimeState = {
      last_successful_full_run_at: "2026-07-02T07:00:00.000Z",
      last_accepted_planned_slot_at: "2026-07-02T07:00:00.000Z",
    };

    const manualUpdate = buildStage4RuntimeStateUpdate({
      runtimeState,
      runReport: { triggerMode: "manual", current_planned_slot_at: "2026-07-05T07:00:00.000Z" },
      completedAt: "2026-07-05T08:00:00.000Z",
    });
    assert.equal(manualUpdate.last_successful_full_run_at, "2026-07-02T07:00:00.000Z");
    assert.equal(manualUpdate.last_accepted_planned_slot_at, "2026-07-02T07:00:00.000Z");
    assert.equal(manualUpdate.last_successful_manual_run_at, "2026-07-05T08:00:00.000Z");

    const scheduledUpdate = buildStage4RuntimeStateUpdate({
      runtimeState,
      runReport: { triggerMode: "scheduled", current_planned_slot_at: "2026-07-09T07:00:00.000Z" },
      completedAt: "2026-07-09T08:00:00.000Z",
    });
    assert.equal(scheduledUpdate.last_successful_full_run_at, "2026-07-09T08:00:00.000Z");
    assert.equal(scheduledUpdate.last_accepted_planned_slot_at, "2026-07-09T07:00:00.000Z");
  });
});
