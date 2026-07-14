import { pathToFileURL } from "node:url";

import { ensureZoteroBackendReady, getRecommendedBackend } from "../lib/ensure_zotero_backend_ready.mjs";

export async function checkZoteroBackendReadyStage() {
  let ready;
  const recommended = getRecommendedBackend();
  try {
    ready = await ensureZoteroBackendReady();
  } catch (err) {
    err.resultPayload = {
      ok: false,
      ready: false,
      backend: recommended.backend,
      recommended,
      errorCode: err?.code || "UNKNOWN",
      error: String(err?.message || err),
      details: err?.details || null,
    };
    throw err;
  }
  return {
    ok: true,
    ready: true,
    backend: ready.backend,
    recommended,
    diagnostics: ready.diagnostics,
    allResults: ready.allResults || [],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    console.log(JSON.stringify(await checkZoteroBackendReadyStage(), null, 2));
    process.exit(0);
  } catch (err) {
    const payload = err?.resultPayload || {
      ok: false,
      ready: false,
      errorCode: err?.code || "UNKNOWN",
      error: String(err?.message || err),
      details: err?.details || null,
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(1);
  }
}
