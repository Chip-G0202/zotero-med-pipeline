import { ensureOllamaReady } from "./lib/ensure_ollama_ready.mjs";
import { pathToFileURL } from "node:url";

async function checkOllamaReady() {
  const result = await ensureOllamaReady();
  return {
    ok: true,
    ...result,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    const result = await checkOllamaReady();
    console.log(JSON.stringify(result, null, 2));
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
