import { createHash } from "node:crypto";

const VOLATILE_KEYS = new Set([
  "runId", "run_id", "startedAt", "started_at", "finishedAt", "finished_at",
  "generatedAt", "generated_at", "updatedAt", "updated_at", "createdAt", "created_at",
  "durationMs", "duration_ms", "timings", "benchmark", "temporaryPath", "temporary_path",
  "outputRoot", "output_root", "filePath", "file_path", "path",
]);

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => !VOLATILE_KEYS.has(key))
    .sort()
    .map((key) => [key, normalize(value[key])]));
}

export function canonicalizeBusinessOutput(value) {
  return normalize(value);
}

export function canonicalHash(value) {
  return createHash("sha256").update(JSON.stringify(canonicalizeBusinessOutput(value))).digest("hex");
}

export function compareBusinessEquivalence(left, right) {
  const leftHash = canonicalHash(left);
  const rightHash = canonicalHash(right);
  return { equivalent: leftHash === rightHash, leftHash, rightHash };
}
