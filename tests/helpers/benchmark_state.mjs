import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const MUTABLE_PATHS = [
  "review_results/runtime_state.json",
  "review_results/translation_cache.json",
  "review_results/journal_quality_cache.json",
  "review_results/zotero_index/current_library_index.json",
];

export const PROTECTED_OUTPUT_PATHS = [
  "review_results/文献评价",
  "review_results/run_manifests",
];

export async function sha256(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

async function listFiles(root, relative = "") {
  const directory = path.join(root, relative);
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

export async function captureOutputInventory(repoRoot) {
  const records = [];
  for (const relativeRoot of PROTECTED_OUTPUT_PATHS) {
    const absoluteRoot = path.join(repoRoot, relativeRoot);
    for (const child of await listFiles(absoluteRoot)) {
      const file = path.join(absoluteRoot, child);
      const stat = await fs.stat(file);
      records.push({
        relative: path.join(relativeRoot, child).replaceAll("\\", "/"),
        size: stat.size,
        sha256: await sha256(file),
      });
    }
  }
  return records;
}

export function compareOutputInventories(before = [], after = []) {
  const serialize = (records) => JSON.stringify([...records].sort((a, b) => a.relative.localeCompare(b.relative)));
  return { ok: serialize(before) === serialize(after), beforeCount: before.length, afterCount: after.length };
}

export async function seedIsolatedState(repoRoot, outputRoot) {
  const copied = [];
  for (const relative of MUTABLE_PATHS) {
    const source = path.join(repoRoot, relative);
    const target = path.join(outputRoot, relative);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
      copied.push(relative);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return copied;
}

export async function captureState(repoRoot, prestateDir) {
  await fs.mkdir(prestateDir, { recursive: true });
  const files = [];
  for (const relative of MUTABLE_PATHS) {
    const source = path.join(repoRoot, relative);
    const record = { relative, exists: false, size: 0, sha256: "" };
    try {
      const stat = await fs.stat(source);
      record.exists = true;
      record.size = stat.size;
      record.sha256 = await sha256(source);
      const copy = path.join(prestateDir, relative);
      await fs.mkdir(path.dirname(copy), { recursive: true });
      await fs.copyFile(source, copy);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    files.push(record);
  }
  const manifest = { capturedAt: new Date().toISOString(), files };
  await fs.writeFile(path.join(prestateDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function restoreState(repoRoot, prestateDir) {
  const manifest = JSON.parse(await fs.readFile(path.join(prestateDir, "manifest.json"), "utf8"));
  for (const record of manifest.files) {
    const target = path.join(repoRoot, record.relative);
    if (!record.exists) {
      await fs.rm(target, { force: true });
      continue;
    }
    const tmp = `${target}.benchmark-restore.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(prestateDir, record.relative), tmp);
    await fs.rename(tmp, target);
  }
  return verifyState(repoRoot, manifest);
}

export async function verifyState(repoRoot, manifest) {
  const failures = [];
  for (const record of manifest.files) {
    const target = path.join(repoRoot, record.relative);
    try {
      const stat = await fs.stat(target);
      if (!record.exists || stat.size !== record.size || await sha256(target) !== record.sha256) failures.push(record.relative);
    } catch (error) {
      if (record.exists || error?.code !== "ENOENT") failures.push(record.relative);
    }
  }
  return { ok: failures.length === 0, failures };
}
