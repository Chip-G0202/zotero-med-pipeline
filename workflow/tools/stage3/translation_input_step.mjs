import fs from "node:fs/promises";

import { elapsedDaysSince, readRuntimeState } from "./runtime_state.mjs";
import { collectExistingItemsMissingShortTitle } from "./translation_pool_scan.mjs";

export async function prepareStage3BackfillInput({
  argv = [],
  summaryPath,
  legacySummaryPath = null,
  runtimeStatePath,
  now,
  localIndexPath = "",
  zoteroBackendCall,
  mcpToolCall,
} = {}) {
  const callZotero = zoteroBackendCall || mcpToolCall;
  let summary;
  try {
    summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
  } catch (err) {
    if (!legacySummaryPath) throw err;
    summary = JSON.parse(await fs.readFile(legacySummaryPath, "utf8"));
  }
  const limitArg = argv.find((x) => x.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : null;
  const offsetArg = argv.find((x) => x.startsWith("--offset="));
  const offset = offsetArg ? Number(offsetArg.split("=")[1]) : 0;
  let summaryForRun = limit
    ? { ...summary, writeback_items: (summary.writeback_items || []).slice(offset, offset + limit) }
    : { ...summary, writeback_items: (summary.writeback_items || []).slice(offset) };

  const poolScanOptOut = /^(0|false|no|off)$/i.test(String(process.env.ZOTERO_TRANSLATION_POOL_SCAN_ENABLED ?? "true"));
  const poolScanIntervalDays = Math.max(1, Number(process.env.ZOTERO_TRANSLATION_POOL_SCAN_INTERVAL_DAYS || 14));
  const poolScanWindowDays = Math.max(1, Number(process.env.ZOTERO_TRANSLATION_POOL_SCAN_WINDOW_DAYS || 14));
  const runtimeState = await readRuntimeState(runtimeStatePath);
  const lastPoolScanAt = runtimeState.last_translation_pool_scan_at || null;
  const daysSincePoolScan = elapsedDaysSince(lastPoolScanAt, now);
  const poolScanDue = !poolScanOptOut && daysSincePoolScan >= poolScanIntervalDays;
  const rootKey = summary?.pool_collection_key || summary?.root_collection?.key || "";
  const poolScanEnabled = Boolean(rootKey && poolScanDue);
  const writebackKeys = new Set((summaryForRun.writeback_items || []).map((it) => it.itemKey).filter(Boolean));
  const poolScanSkipReason = poolScanOptOut
    ? "disabled_by_env"
    : !rootKey
      ? "pool_collection_key_missing"
      : !poolScanDue
        ? "interval_not_reached"
        : "";
  const poolScan = poolScanEnabled
    ? await collectExistingItemsMissingShortTitle(rootKey, writebackKeys, {
        now,
        windowDays: poolScanWindowDays,
        idBase: 1100000,
        maxScan: Math.max(10, Number(process.env.ZOTERO_TRANSLATION_POOL_SCAN_MAX_ITEMS || 100)),
        localIndexPath,
        zoteroBackendCall: callZotero,
      })
    : {
        candidates: [],
        scanStats: {
          date_collections_scanned: 0,
          items_scanned: 0,
          items_missing_shorttitle: 0,
          errors: 0,
          scan_limited: false,
          scan_disabled: true,
          scan_skip_reason: poolScanSkipReason,
        },
      };

  if (poolScan.candidates.length > 0) {
    const poolScanLimit = Math.max(1, Number(process.env.ZOTERO_TRANSLATION_POOL_SCAN_LIMIT || 50));
    const limited = poolScan.candidates.slice(0, poolScanLimit);
    const merged = [...summaryForRun.writeback_items, ...limited.map((c) => ({ ...c, backfill_short_title: true }))];
    summaryForRun = { ...summaryForRun, writeback_items: merged };
    console.error(`[translation_backfill] pool scan: ${poolScan.scanStats.items_missing_shorttitle} missing shortTitle, ${limited.length} added (limit=${poolScanLimit})`);
  }

  return {
    summary,
    summaryForRun,
    poolScan,
    poolScanEnabled,
    poolScanIntervalDays,
    poolScanWindowDays,
    lastPoolScanAt,
    daysSincePoolScan,
    poolScanSkipReason,
  };
}
