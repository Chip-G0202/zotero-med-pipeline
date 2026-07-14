import fs from "node:fs/promises";
import { buildIntervalGateDiagnostics, evaluateRunInterval, resolveRuntimeStateReference } from "../lib/schedule_support.mjs";

export async function evaluateStage1IntervalGate({
  runtimeStatePath,
  now,
  runIntervalDays = 7,
  triggerMode = "",
  manualTrigger = false,
  explicitForceRun = false,
} = {}) {
  const forceRun = Boolean(manualTrigger || explicitForceRun);
  let runtimeStateReference = {
    reference_state_field: null,
    last_reference_time: null,
  };
  try {
    const runtimeState = JSON.parse(await fs.readFile(runtimeStatePath, "utf8"));
    runtimeStateReference = resolveRuntimeStateReference(runtimeState, [
      "last_accepted_planned_slot_at",
      "last_successful_full_run_at",
    ]);
  } catch {}

  const intervalInfo = evaluateRunInterval({
    now,
    lastSuccessfulRunAt: runtimeStateReference.last_reference_time,
    intervalDays: runIntervalDays,
    forceRun,
  });
  const runDue = intervalInfo.run_due;
  const skipReason = !runDue && !forceRun
    ? "interval_not_reached"
    : manualTrigger
      ? "manual_bypass"
      : explicitForceRun
        ? "force_run_bypass"
        : runtimeStateReference.last_reference_time
          ? "run_due"
          : "no_previous_run";

  return {
    forceRun,
    runDue,
    intervalInfo,
    nextEligibleRunAt: intervalInfo.next_eligible_run_at,
    currentRunAtIso: intervalInfo.current_run_at,
    intervalGateDiagnostics: buildIntervalGateDiagnostics({
      gateName: "stage1_internal_interval_gate",
      trigger: triggerMode || "unknown",
      forceRun,
      manualTrigger,
      intervalInfo,
      referenceStateField: runtimeStateReference.reference_state_field,
      lastReferenceTime: runtimeStateReference.last_reference_time,
      skipReason,
      source: "runResearchOsPipeline",
      writtenStateFields: [],
    }),
  };
}
