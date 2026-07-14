import fs from "node:fs/promises";
import path from "node:path";

export async function readRuntimeState(runtimeStatePath) {
  try {
    return JSON.parse(await fs.readFile(runtimeStatePath, "utf8"));
  } catch {
    return {};
  }
}

export async function mergeRuntimeState(runtimeStatePath, patch) {
  const current = await readRuntimeState(runtimeStatePath);
  await fs.mkdir(path.dirname(runtimeStatePath), { recursive: true });
  await fs.writeFile(runtimeStatePath, JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
}

export function elapsedDaysSince(isoValue, now) {
  if (!isoValue) return Infinity;
  const t = Date.parse(isoValue);
  if (!Number.isFinite(t)) return Infinity;
  return (now.getTime() - t) / 86400000;
}
