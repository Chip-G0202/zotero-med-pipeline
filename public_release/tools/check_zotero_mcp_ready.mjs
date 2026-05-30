import { ensureZoteroMcpReady } from "./lib/ensure_zotero_mcp_ready.mjs";
import { pathToFileURL } from "node:url";

const mcpUrl = process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp";
const externalLauncher = String(process.env.ZOTERO_EXTERNAL_LAUNCHER || "").trim().toLowerCase() || null;

async function mcpProbe(attempt) {
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 880000 + attempt,
      method: "tools/call",
      params: { name: "get_collections", arguments: { mode: "minimal", limit: 1 } },
    }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`MCP get_collections failed: ${JSON.stringify(json.error)}`);
  }
}

export async function checkZoteroMcpReadyStage() {
  const ready = await ensureZoteroMcpReady({ mcpProbe });
  return {
    ok: true,
    ready: true,
    mcpUrl,
    externalLauncher,
    attempts: ready.attempts,
    started_now: ready.started_now,
    diagnostics: ready.diagnostics,
    lastProbeError: ready?.diagnostics?.lastProbeError || null,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    console.log(JSON.stringify(await checkZoteroMcpReadyStage(), null, 2));
    process.exit(0);
  } catch (err) {
    console.log(JSON.stringify({
    ok: false,
    ready: false,
    mcpUrl,
    externalLauncher,
    errorCode: err?.code || "UNKNOWN",
    error: String(err?.message || err),
    details: err?.details || null,
    lastProbeError: err?.details?.lastProbeError || null,
    }, null, 2));
    process.exit(1);
  }
}
