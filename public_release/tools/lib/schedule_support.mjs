const ASIA_SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const SLOT_HOUR_LOCAL = 15;

function toBeijingDate(date) {
  return new Date(date.getTime() + ASIA_SHANGHAI_OFFSET_MS);
}

export function resolvePlannedSlotAt(date) {
  const bj = toBeijingDate(new Date(date));
  const slot = new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate(), SLOT_HOUR_LOCAL, 0, 0, 0));
  return new Date(slot.getTime() - ASIA_SHANGHAI_OFFSET_MS);
}

function parseNullableIso(value) {
  if (value === undefined || value === null || value === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

export function evaluateRunInterval({
  now = new Date(),
  lastSuccessfulRunAt = null,
  intervalDays = 2,
  forceRun = false,
} = {}) {
  const currentRunAt = new Date(now).toISOString();
  const currentSlot = resolvePlannedSlotAt(now);
  const currentSlotIso = currentSlot.toISOString();
  const lastAcceptedSlot = parseNullableIso(lastSuccessfulRunAt)
    ? resolvePlannedSlotAt(lastSuccessfulRunAt)
    : null;
  const lastAcceptedSlotIso = lastAcceptedSlot ? lastAcceptedSlot.toISOString() : null;

  const slotIntervalMs = Math.max(1, Math.round(Number(intervalDays) * 24 * 60 * 60 * 1000));
  const elapsedHoursSinceLastSuccess = lastAcceptedSlot
    ? (currentSlot.getTime() - lastAcceptedSlot.getTime()) / 3600000
    : null;
  const runDue = lastAcceptedSlot === null || (elapsedHoursSinceLastSuccess !== null && currentSlot.getTime() - lastAcceptedSlot.getTime() >= slotIntervalMs);
  const nextEligibleRunAt = lastAcceptedSlot
    ? new Date(lastAcceptedSlot.getTime() + slotIntervalMs).toISOString()
    : currentSlotIso;
  const skippedDueToInterval = !runDue && !forceRun;

  return {
    run_interval_days: Number(intervalDays),
    last_successful_run_at: lastSuccessfulRunAt,
    last_accepted_planned_slot_at: lastAcceptedSlotIso,
    current_run_at: currentRunAt,
    current_planned_slot_at: currentSlotIso,
    elapsed_hours_since_last_success: elapsedHoursSinceLastSuccess,
    run_due: runDue,
    force_run: Boolean(forceRun),
    skipped_due_to_interval: skippedDueToInterval,
    next_eligible_run_at: nextEligibleRunAt,
  };
}

