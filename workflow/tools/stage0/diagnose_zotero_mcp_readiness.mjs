import { ensureZoteroBackendReady, getRecommendedBackend } from "../lib/ensure_zotero_backend_ready.mjs";
import { pathToFileURL } from "node:url";

const externalLauncher = String(process.env.ZOTERO_EXTERNAL_LAUNCHER || "").trim().toLowerCase() || null;

export async function checkZoteroBackendDiagnosticStage() {
  let ready;
  const recommended = getRecommendedBackend();
  try {
    ready = await ensureZoteroBackendReady();
  } catch (err) {
    // Attach structured error details so the orchestrator can read them,
    // then re-throw to signal stage failure (exitCode=1).
    err.resultPayload = {
      ok: false,
      ready: false,
      backend: recommended.backend,
      recommended,
      externalLauncher,
      errorCode: err?.code || "UNKNOWN",
      error: String(err?.message || err),
      details: err?.details || null,
      lastProbeError: err?.details?.lastProbeError || null,
    };
    throw err;
  }
  return {
    ok: true,
    ready: true,
    backend: ready.backend,
    recommended,
    externalLauncher,
    diagnostics: ready.diagnostics,
    allResults: ready.allResults || [],
    lastProbeError: ready?.diagnostics?.lastProbeError || null,
  };
}

export const checkZoteroMcpReadyStage = checkZoteroBackendDiagnosticStage;

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    console.log(JSON.stringify(await checkZoteroBackendDiagnosticStage(), null, 2));
    process.exit(0);
  } catch (err) {
    const payload = err?.resultPayload || {
      ok: false,
      ready: false,
      externalLauncher,
      errorCode: err?.code || "UNKNOWN",
      error: String(err?.message || err),
      details: err?.details || null,
      lastProbeError: err?.details?.lastProbeError || null,
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(1);
  }
}
