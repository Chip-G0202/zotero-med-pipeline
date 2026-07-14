const STAR_MIGRATION_DISABLED_VALUES = new Set(["disabled", "off", "0", "false", "no"]);
const STAR_MIGRATION_LEGACY_VALUES = new Set(["legacy", "default", "safe", "ab_only", "ab-only", "ab"]);
const STAR_MIGRATION_EXPAND_VALUES = new Set(["expand", "all_grades", "all-grades", "full", "broad"]);
const DEFAULT_WRITEBACK_MCP_RETRIES = 45;
const DEFAULT_WRITEBACK_MCP_INTERVAL_MS = 1000;
const DEFAULT_WRITEBACK_MCP_POST_START_DELAY_MS = 5000;

function parsePositiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function firstConfiguredValue(env, names) {
  for (const name of names) {
    if (env[name] !== undefined && env[name] !== null && String(env[name]).trim() !== "") return env[name];
  }
  return undefined;
}

export function resolveWritebackMcpReadyOptions(env = process.env) {
  return {
    retries: parsePositiveInt(
      firstConfiguredValue(env, ["ZOTERO_WRITEBACK_MCP_RETRIES", "WORKFLOW_STARTUP_ZOTERO_MCP_RETRIES", "ZOTERO_MCP_RETRIES"]),
      DEFAULT_WRITEBACK_MCP_RETRIES,
    ),
    intervalMs: parsePositiveInt(
      firstConfiguredValue(env, ["ZOTERO_WRITEBACK_MCP_INTERVAL_MS", "WORKFLOW_STARTUP_ZOTERO_MCP_INTERVAL_MS", "ZOTERO_MCP_INTERVAL_MS"]),
      DEFAULT_WRITEBACK_MCP_INTERVAL_MS,
    ),
    postStartDelayMs: parsePositiveInt(
      firstConfiguredValue(env, ["ZOTERO_WRITEBACK_MCP_POST_START_DELAY_MS", "WORKFLOW_STARTUP_ZOTERO_POST_START_DELAY_MS", "ZOTERO_MCP_POST_START_DELAY_MS"]),
      DEFAULT_WRITEBACK_MCP_POST_START_DELAY_MS,
    ),
  };
}

export function parseStarMigrationConfig(env = process.env) {
  const rawMode = String(env.ZOTERO_STAR_MIGRATION_MODE || "").trim().toLowerCase();
  const rawWindow = Number(env.ZOTERO_STAR_MIGRATION_WINDOW_DAYS || 10);
  const rawThreshold = Number(env.ZOTERO_STAR_MIGRATION_MIN_STARS || 4);
  const windowDays = Number.isFinite(rawWindow) && rawWindow > 0 ? Math.floor(rawWindow) : 10;
  const starThreshold = Number.isFinite(rawThreshold) && rawThreshold > 0 ? Math.min(5, Math.max(1, Math.floor(rawThreshold))) : 4;

  if (STAR_MIGRATION_DISABLED_VALUES.has(rawMode)) {
    return { enabled: false, mode: rawMode || "disabled", expandAllGrades: false, windowDays, starThreshold };
  }
  if (STAR_MIGRATION_EXPAND_VALUES.has(rawMode)) {
    return { enabled: true, mode: rawMode || "expand", expandAllGrades: true, windowDays: Math.max(windowDays, 14), starThreshold: Math.min(starThreshold, 2) };
  }

  if (!rawMode) {
    return { enabled: true, mode: "expand", expandAllGrades: true, windowDays, starThreshold };
  }

  return { enabled: true, mode: rawMode, expandAllGrades: STAR_MIGRATION_LEGACY_VALUES.has(rawMode) ? false : true, windowDays, starThreshold };
}
