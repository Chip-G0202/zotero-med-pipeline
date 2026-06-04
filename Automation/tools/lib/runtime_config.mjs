import path from "node:path";
import { fileURLToPath } from "node:url";

function toPosix(p) {
  return String(p || "").replace(/\\/g, "/");
}

function normalizePath(p) {
  return toPosix(path.resolve(p));
}

function resolveUnderRoot(root, raw, fallback) {
  const value = String(raw || fallback || "").trim();
  if (!value) return normalizePath(root);
  if (path.isAbsolute(value)) return normalizePath(value);
  return normalizePath(path.join(root, value));
}

export function yyMd(d) {
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
}

export function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function defaultProjectRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return normalizePath(path.resolve(here, "../.."));
}

function defaultZoteroExe() {
  if (process.platform === "darwin") return "/Applications/Zotero.app/Contents/MacOS/zotero";
  if (process.platform === "win32") return "D:/Zotero/zotero.exe";
  return "zotero";
}

export function buildRuntimeConfig({ cwd = process.cwd(), env = process.env, now } = {}) {
  if (!now) {
    const overrideDate = String(env.RESEARCH_OS_OVERRIDE_DATE || "").trim();
    now = overrideDate ? new Date(overrideDate) : new Date();
  }
  const repoRoot = defaultProjectRoot();
  const projectRoot = normalizePath(env.ZOTERO_PROJECT_ROOT || cwd || repoRoot);
  const researchRoot = resolveUnderRoot(projectRoot, env.RESEARCH_OS_ROOT, "research_os");
  const reviewRoot = resolveUnderRoot(projectRoot, env.DESKTOP_REVIEW_ROOT, "research_os/文献评价");
  const legacyDesktopReviewRoot = normalizePath(env.LEGACY_DESKTOP_REVIEW_ROOT || env.DESKTOP_REVIEW_ROOT_LEGACY || path.join(projectRoot, "research_os", "文献评价"));
  const translationCachePath = normalizePath(path.join(researchRoot, "translation_cache.json"));
  const week = isoWeek(now);
  const day = yyMd(now);
  const pipelineDir = normalizePath(path.join(researchRoot, "pipeline", day));
  const toolsDir = normalizePath(path.join(repoRoot, "tools"));

  return {
    platform: process.platform,
    now,
    repoRoot,
    projectRoot,
    researchRoot,
    reviewRoot,
    legacyDesktopReviewRoot,
    translationCachePath,
    week,
    day,
    pipelineDir,
    zoteroExe: env.ZOTERO_EXE || defaultZoteroExe(),
    mcpUrl: env.ZOTERO_MCP_URL || env.MCP_URL || "http://127.0.0.1:23120/mcp",
    ollamaUrl: env.OLLAMA_HOST || "http://127.0.0.1:11434",
    externalLauncher: String(env.ZOTERO_EXTERNAL_LAUNCHER || "").trim().toLowerCase(),
    pwshPath: toPosix(env.PWSH_PATH || "pwsh"),
    scripts: {
      stage1: `${toolsDir}/run_research_os_pipeline.mjs`,
      mcpReady: `${toolsDir}/check_zotero_mcp_ready.mjs`,
      stage2: `${toolsDir}/mcp_bulk_writeback.mjs`,
      stage3: `${toolsDir}/mcp_translation_backfill.mjs`,
      stage4: `${toolsDir}/finalize_research_os_exports.mjs`,
    },
  };
}
