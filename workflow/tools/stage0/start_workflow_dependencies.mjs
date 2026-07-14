import { pathToFileURL } from "node:url";

import { ensureWorkflowStartupReady } from "../lib/workflow_startup_ready.mjs";

export async function startWorkflowDependencies() {
  return ensureWorkflowStartupReady();
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    const result = await startWorkflowDependencies();
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    process.exit(0);
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      errorCode: err?.code || "UNKNOWN",
      error: String(err?.message || err),
      details: err?.details || null,
    }, null, 2));
    process.exit(1);
  }
}
