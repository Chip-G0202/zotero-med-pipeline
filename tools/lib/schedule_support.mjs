export function evaluateRunInterval({
  now = new Date(),
  lastSuccessfulRunAt = null,
  intervalDays = 2,
  forceRun = false,
} = {}) {
  const runIntervalHours = Number(intervalDays) * 24;
  const currentRunAt = new Date(now).toISOString();
  const elapsedHoursSinceLastSuccess = lastSuccessfulRunAt
    ? (new Date(now).getTime() - Date.parse(lastSuccessfulRunAt)) / 3600000
    : null;
  const runDue = lastSuccessfulRunAt === null || (elapsedHoursSinceLastSuccess !== null && elapsedHoursSinceLastSuccess >= runIntervalHours);
  const nextEligibleRunAt = lastSuccessfulRunAt
    ? new Date(Date.parse(lastSuccessfulRunAt) + runIntervalHours * 3600000).toISOString()
    : currentRunAt;
  const skippedDueToInterval = !runDue && !forceRun;
  return {
    run_interval_days: Number(intervalDays),
    last_successful_run_at: lastSuccessfulRunAt,
    current_run_at: currentRunAt,
    elapsed_hours_since_last_success: elapsedHoursSinceLastSuccess,
    run_due: runDue,
    force_run: Boolean(forceRun),
    skipped_due_to_interval: skippedDueToInterval,
    next_eligible_run_at: nextEligibleRunAt,
  };
}

