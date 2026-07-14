import { isTransientZoteroBackendError, wait } from "../lib/zotero_backend_client.mjs";

export async function createItemWithDedupeRetry({
  retryLimit = 0,
  createItem = null,
  findExisting = null,
  wait: waitImpl = wait,
  isTransientError = isTransientZoteroBackendError,
} = {}) {
  let retryCount = 0;
  const maxRetries = Math.max(0, Number(retryLimit || 0));
  let attempt = 0;
  while (true) {
    if (attempt > 0) await waitImpl(1000 * attempt);
    try {
      const itemKey = await createItem({ attempt });
      return { itemKey, retryCount, duplicatePrevented: false };
    } catch (createError) {
      if (!isTransientError(createError) || attempt >= maxRetries) throw createError;
      retryCount += 1;
      const existing = typeof findExisting === "function"
        ? await findExisting({ attempt, error: createError })
        : null;
      if (existing) {
        return { itemKey: existing, retryCount, duplicatePrevented: true };
      }
      attempt += 1;
    }
  }
}
