import fs from "node:fs/promises";
import path from "node:path";

export async function loadFixtureCandidates({ fixtureRoot = "", dryRun = false, allowFixture = false } = {}) {
  const root = String(fixtureRoot || "").trim();
  if (!root) {
    return { enabled: false, items: [], path: null, skipped_reason: "fixture_root_missing" };
  }
  if (!dryRun && !allowFixture) {
    return { enabled: false, items: [], path: null, skipped_reason: "fixture_requires_dry_run_or_explicit_allow" };
  }
  const inputPath = path.join(root, "candidates.json");
  const parsed = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
  return { enabled: true, items, path: inputPath, skipped_reason: null };
}
