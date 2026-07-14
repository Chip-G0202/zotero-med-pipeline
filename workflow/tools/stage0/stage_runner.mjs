export function iso(d) {
  return d.toISOString();
}

export function makeStage(name, scriptPath, handler) {
  return {
    name,
    command: `node ${scriptPath}`,
    scriptPath,
    handler,
  };
}

export function trimLog(s) {
  const v = String(s || "").trim();
  return v.length <= 2000 ? v : `${v.slice(0, 2000)}...`;
}

export function createDefaultRunStage(failureHandlers = {}) {
  return async function defaultRunStage(stage) {
    const originalWrite = process.stdout.write;
    const originalErrorWrite = process.stderr.write;
    let stdout = "";
    let stderr = "";
    process.stdout.write = function writeStdout(chunk, ...args) {
      stdout += String(chunk);
      return originalWrite.call(this, chunk, ...args);
    };
    process.stderr.write = function writeStderr(chunk, ...args) {
      stderr += String(chunk);
      return originalErrorWrite.call(this, chunk, ...args);
    };
    try {
      await stage.handler();
      return { exitCode: 0, stdout, stderr };
    } catch (err) {
      const message = String(err?.stack || err?.message || err);
      stderr += message;
      try {
        const failureHandler = failureHandlers[stage.name];
        if (failureHandler) await failureHandler(err);
      } catch (markErr) {
        stderr += "\n[orchestrator] markFailure also threw: " + String(markErr?.message || markErr);
      }
      return { exitCode: stage.name === "stage3_translation" && /^partial_failed:/i.test(message) ? 2 : 1, stdout, stderr };
    } finally {
      process.stdout.write = originalWrite;
      process.stderr.write = originalErrorWrite;
    }
  };
}

export function skippedStage(name, scriptPath, skipReason, clock) {
  const at = iso(clock());
  return {
    name,
    command: `node ${scriptPath}`,
    startedAt: at,
    finishedAt: at,
    durationMs: 0,
    exitCode: null,
    status: "skipped",
    skipReason,
  };
}

export async function executeStage(stage, runStage, clock) {
  const started = clock();
  const startedAt = iso(started);
  const result = await runStage(stage);
  const finished = clock();
  const finishedAt = iso(finished);
  return {
    name: stage.name,
    command: stage.command,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finished.getTime() - started.getTime()),
    exitCode: Number(result.exitCode ?? 1),
    status: Number(result.exitCode ?? 1) === 0 ? "completed" : "failed",
    stdout: trimLog(result.stdout),
    stderr: trimLog(result.stderr),
  };
}
