import { performance } from "node:perf_hooks";

function durationSince(start) {
  return Math.max(0, Number((performance.now() - start).toFixed(3)));
}

export class LocalTiming {
  constructor(runId) {
    this.runId = runId;
    this.startedAt = new Date().toISOString();
    this.totalStarted = performance.now();
    this.stages = [];
  }

  async run(name, operation, metadata = null) {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    try {
      const result = await operation();
      this.stages.push({
        name,
        status: "success",
        duration_ms: durationSince(started),
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        ...(metadata ? { metadata: typeof metadata === "function" ? metadata(result) : metadata } : {}),
      });
      return result;
    } catch (error) {
      this.stages.push({
        name,
        status: "failed",
        duration_ms: durationSince(started),
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        reason: String(error?.message || error).slice(0, 200),
      });
      throw error;
    }
  }

  skip(name, reason) {
    this.stages.push({ name, status: "skipped", duration_ms: 0, reason: String(reason || "not_run") });
  }

  report(status) {
    return {
      schema_version: 1,
      run_id: this.runId,
      started_at: this.startedAt,
      finished_at: new Date().toISOString(),
      status,
      total_duration_ms: durationSince(this.totalStarted),
      stages: this.stages.map((stage) => ({ ...stage })),
    };
  }
}

function formatDuration(durationMs) {
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)} s` : `${durationMs.toFixed(1)} ms`;
}

export function formatTimingSummary(report) {
  const lines = ["Timing:"];
  for (const stage of report?.stages || []) {
    const value = stage.status === "skipped"
      ? `skipped${stage.reason ? ` (${stage.reason})` : ""}`
      : stage.status === "failed"
        ? `failed ${formatDuration(stage.duration_ms)}`
        : formatDuration(stage.duration_ms);
    lines.push(`  ${stage.name.padEnd(22)} ${value}`);
  }
  lines.push(`  ${"total".padEnd(22)} ${formatDuration(report.total_duration_ms)}`);
  return lines.join("\n");
}
