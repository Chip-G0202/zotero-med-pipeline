import { createCompatMcpToolCall } from "./zotero_backend_compat.mjs";

export { wait } from "./async_utils.mjs";

export function isTransientZoteroBackendError(error) {
  return /timeout|database busy|lock conflict|rate limit|429/i.test(String(error?.message || error));
}

export async function createZoteroBackendToolCall(options = {}) {
  const backendToolCall = await createCompatMcpToolCall(options);
  const { onToolCall } = options;

  async function callTool(name, args, id) {
    if (typeof onToolCall === "function") onToolCall(name);
    return backendToolCall(name, args, id);
  }

  callTool.adapter = backendToolCall.adapter;
  callTool.backendType = backendToolCall.backendType;
  return callTool;
}

export async function createZoteroBackendClient(options = {}) {
  const backendToolCall = await createZoteroBackendToolCall(options);
  return { callTool: backendToolCall };
}
