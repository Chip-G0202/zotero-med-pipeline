import fs from "node:fs/promises";
import path from "node:path";

export function artifactPath(config, name) {
  return `${config.pipelineDir}/${name}`;
}

export async function defaultStatArtifact(p) {
  try {
    const st = await fs.stat(p);
    return { exists: true, mtimeMs: st.mtimeMs };
  } catch {
    return { exists: false, mtimeMs: null };
  }
}

export async function defaultReadJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

export async function defaultWriteReport(report) {
  await fs.mkdir(report.pipelineDir, { recursive: true });
  await fs.writeFile(`${report.pipelineDir}/orchestrator_report.json`, JSON.stringify(report, null, 2), "utf8");
}

export async function defaultWriteJson(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

export async function inspectArtifact(key, fileName, stageStartedAt, config, statArtifact, readJson) {
  const p = artifactPath(config, fileName);
  const stat = await statArtifact(p);
  const stageStartMs = Date.parse(stageStartedAt);
  const stale = stat.exists ? !(Number(stat.mtimeMs) >= stageStartMs) : true;
  let data = null;
  if (stat.exists && !stale) {
    try {
      data = await readJson(p);
    } catch {
      data = null;
    }
  }
  return {
    key,
    path: p,
    exists: Boolean(stat.exists),
    mtimeMs: stat.mtimeMs ?? null,
    stale,
    currentRun: Boolean(stat.exists && !stale),
    data,
  };
}
