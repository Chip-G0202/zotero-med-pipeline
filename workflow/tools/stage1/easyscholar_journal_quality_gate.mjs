const EASY_SCHOLAR_URL = "https://www.easyscholar.cc/open/getPublicationRank";
const DEFAULT_MIN_IMPACT_FACTOR = 3;
const DEFAULT_RATE_LIMIT_PER_SECOND = 2;
const DEFAULT_PREPRINT_SOURCES = ["biorxiv", "medrxiv", "arxiv", "research square", "ssrn"];
const DEFAULT_NON_RESEARCH_TITLE_PREFIXES = ["correction to:", "correction:", "erratum:", "retraction:", "withdrawn:"];
const JOURNAL_CACHE_SCHEMA_VERSION = 1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeJournalName(value) {
  return cleanText(value)
    .normalize("NFKC")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeIssn(value) {
  return cleanText(value).toUpperCase().replace(/[^0-9X]/g, "");
}

function journalCacheKeys(item = {}, journal = "") {
  const keys = [];
  const issnValues = [
    item.issn,
    item.ISSN,
    item.eissn,
    item.eISSN,
    item["e-issn"],
    item.print_issn,
    item.online_issn,
  ].flatMap((value) => Array.isArray(value) ? value : [value]);
  for (const value of issnValues) {
    const normalized = normalizeIssn(value);
    if (normalized) keys.push(`issn:${normalized}`);
  }
  const normalizedJournal = normalizeJournalName(journal);
  if (normalizedJournal) keys.push(`journal:${normalizedJournal}`);
  return [...new Set(keys)];
}

async function readJournalCache(cachePath) {
  if (!cachePath) return { entries: {}, stats: { read_count: 0, parse_error_count: 0 } };
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      entries: parsed && typeof parsed.entries === "object" ? parsed.entries : {},
      stats: { read_count: 1, parse_error_count: 0 },
    };
  } catch (error) {
    return {
      entries: {},
      stats: { read_count: error?.code === "ENOENT" ? 0 : 1, parse_error_count: error?.code === "ENOENT" ? 0 : 1 },
    };
  }
}

async function writeJournalCache(cachePath, entries) {
  if (!cachePath) return false;
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify({
    schema_version: JOURNAL_CACHE_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    entries,
  }, null, 2), "utf8");
  return true;
}

function metricsFromCacheEntry(entry = {}) {
  const metrics = entry.metrics && typeof entry.metrics === "object" ? entry.metrics : entry;
  return {
    found: Boolean(metrics.found),
    impactFactor: metrics.impactFactor ?? metrics.impact_factor ?? null,
    impactFactor5Year: metrics.impactFactor5Year ?? metrics.impact_factor_5y ?? null,
    casSmallPartition: metrics.casSmallPartition ?? metrics.cas_small_partition ?? "",
    raw: metrics.raw || {},
    error: metrics.error || "",
    queriedName: metrics.queriedName || metrics.queried_name || entry.queried_name || "",
    cache_source: entry.source || "journal_quality_cache",
  };
}

function cacheEntryFromMetrics(metrics = {}, key = "") {
  return {
    source: metrics?.error ? "easyscholar_negative_cache" : "easyscholar",
    normalized_key: key,
    fetched_at: new Date().toISOString(),
    queried_name: metrics?.queriedName || "",
    metrics: {
      found: Boolean(metrics?.found),
      impactFactor: metrics?.impactFactor ?? null,
      impactFactor5Year: metrics?.impactFactor5Year ?? null,
      casSmallPartition: metrics?.casSmallPartition || "",
      raw: metrics?.raw || {},
      error: metrics?.error || "",
    },
  };
}

function sourcePlatform(item = {}) {
  return String(item.source_platform || item.source || item.source_channel || "").trim().toLowerCase();
}

function journalName(item = {}) {
  return cleanText(item.journal || item.publicationTitle || item["container-title"] || "");
}

function titleText(item = {}) {
  return cleanText(item.title || item.Title || "");
}

function isPreprintSource(value, sources = DEFAULT_PREPRINT_SOURCES) {
  const normalized = normalizeJournalName(value);
  if (!normalized) return false;
  if (normalized.includes("preprint server")) return true;
  return sources.some((source) => {
    const wanted = normalizeJournalName(source);
    return wanted && (normalized === wanted || normalized.startsWith(`${wanted} `) || normalized.includes(` ${wanted} `));
  });
}

function isNonResearchRecordTitle(value, prefixes = DEFAULT_NON_RESEARCH_TITLE_PREFIXES) {
  const normalized = cleanText(value).toLowerCase();
  if (!normalized) return false;
  return prefixes.some((prefix) => normalized.startsWith(String(prefix || "").toLowerCase()));
}

function gradeLetter(item = {}) {
  const raw = String(item.rule_grade || item.grade || item.final_grade || "").trim();
  const match = raw.match(/^[ABCD]/i);
  return match ? match[0].toUpperCase() : "";
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isCasPartitionExcluded(value, excluded = []) {
  const text = cleanText(value);
  if (!text) return false;
  const normalized = text.replace(/\s+/g, "");
  return excluded.some((entry) => {
    const wanted = cleanText(entry).replace(/\s+/g, "");
    if (!wanted) return false;
    if (normalized === wanted || normalized.includes(wanted)) return true;
    if ((wanted === "4区" || wanted === "四区") && (/4区/.test(normalized) || /四区/.test(normalized) || normalized === "4")) return true;
    return false;
  });
}

function itemAuditRecord(item = {}, extra = {}) {
  return {
    title: item.title || "",
    journal: item.journal || item.publicationTitle || item["container-title"] || "",
    pmid: item.pmid || "",
    pmcid: item.pmcid || "",
    source_platform: item.source_platform || "",
    grade: item.grade || "",
    rule_grade: item.rule_grade || "",
    ...extra,
  };
}

export function parseEasyScholarRank(payload = {}) {
  const all = payload?.data?.officialRank?.all || payload?.data?.officialRank?.select || payload?.officialRank?.all || payload?.officialRank?.select || {};
  const impactFactor = parseNumber(all.sciif);
  const impactFactor5Year = parseNumber(all.sciif5);
  const casSmallPartition = cleanText(all.sciUpSmall || "");
  return {
    found: Boolean(Object.keys(all).length),
    impactFactor,
    impactFactor5Year,
    casSmallPartition,
    raw: all,
  };
}

export function buildJournalQualityConfig(raw = {}) {
  const filter = raw?.triage?.journal_quality_filter || raw?.journal_quality_filter || raw || {};
  return {
    enabled: filter.enabled !== false,
    applyToSources: Array.isArray(filter.apply_to_sources) ? filter.apply_to_sources : (Array.isArray(filter.applyToSources) ? filter.applyToSources : ["pubmed", "pmc"]),
    minImpactFactor: Number(filter.min_impact_factor ?? filter.minImpactFactor ?? DEFAULT_MIN_IMPACT_FACTOR),
    excludeCasSmallPartitions: filter.exclude_cas_small_partitions || filter.excludeCasSmallPartitions || ["4区"],
    excludePreprints: filter.exclude_preprints ?? filter.excludePreprints ?? true,
    preprintSources: filter.preprint_sources || filter.preprintSources || DEFAULT_PREPRINT_SOURCES,
    excludeNonResearchRecords: filter.exclude_non_research_records ?? filter.excludeNonResearchRecords ?? true,
    nonResearchTitlePrefixes: filter.non_research_title_prefixes || filter.nonResearchTitlePrefixes || DEFAULT_NON_RESEARCH_TITLE_PREFIXES,
    missingPolicy: filter.missing_policy || filter.missingPolicy || "keep",
    exemptJournals: Array.isArray(filter.exempt_journals) ? filter.exempt_journals.map((j) => normalizeJournalName(String(j))) : [],
    rateLimitPerSecond: Number(process.env.EASYSCHOLAR_RATE_LIMIT_PER_SECOND || filter.rate_limit_per_second || filter.rateLimitPerSecond || DEFAULT_RATE_LIMIT_PER_SECOND),
  };
}

function classifyFailureReason(reason = "") {
  const text = cleanText(reason).toLowerCase();
  if (!text) return "unknown";
  if (text === "missing_secret_key" || text === "missing_api_key") return "missing_api_key";
  if (text === "fetch_unavailable") return "fetch_unavailable";
  if (/^http_\d{3}$/.test(text)) return text;
  if (text.includes("abort") || text.includes("timeout")) return "timeout";
  return "lookup_failed";
}

export function buildEasyScholarSummary(report = {}, {
  apiKeyPresent = Boolean(process.env.EASYSCHOLAR_SECRET_KEY),
  dryRunBlocked = "unknown",
} = {}) {
  const enabled = typeof report.enabled === "boolean" ? report.enabled : "unknown";
  const keyPresent = typeof apiKeyPresent === "boolean" ? apiKeyPresent : "unknown";
  const dryRunState = typeof dryRunBlocked === "boolean" ? dryRunBlocked : "unknown";
  const consideredCount = Number(report.input_count || 0);
  const queriedCount = Number(report.queried_journal_count || 0);
  const failedCount = Number(report.failed_count || 0);
  const attemptedCount = enabled === true && keyPresent === true && dryRunState !== true ? queriedCount : 0;
  const failureReasons = [...new Set((report.failed_items || [])
    .map((item) => classifyFailureReason(item?.reason || item?.error || ""))
    .filter(Boolean))];
  const missingKey = enabled === true && keyPresent === false && (queriedCount > 0 || failureReasons.includes("missing_api_key"));

  let skippedReason = "";
  if (enabled === false) skippedReason = "disabled";
  else if (dryRunState === true) skippedReason = "dry_run";
  else if (missingKey) skippedReason = "missing_api_key";
  else if (enabled === true && consideredCount === 0) skippedReason = "no_items";
  else if (enabled === true && queriedCount === 0 && failedCount === 0) skippedReason = "no_items";

  return {
    enabled,
    configured: enabled === "unknown" || keyPresent === "unknown" ? "unknown" : Boolean(enabled && keyPresent),
    api_key_present: keyPresent,
    triggered: enabled === true && keyPresent === true && dryRunState !== true && queriedCount > 0,
    items_considered_count: consideredCount,
    items_attempted_count: attemptedCount,
    items_succeeded_count: Math.max(0, attemptedCount - failedCount),
    items_failed_count: failedCount,
    skipped_reason: skippedReason,
    failure_reasons: failureReasons,
    degraded: failedCount > 0,
    dry_run_blocked: dryRunState,
  };
}

export function shouldQueryJournalQuality(item = {}, config = {}) {
  const sources = new Set((config.applyToSources || ["pubmed", "pmc"]).map((x) => String(x).toLowerCase()));
  const source = sourcePlatform(item);
  if (!sources.has(source)) return { query: false, reason: source === "rss" ? "rss" : "source_not_configured" };
  const grade = gradeLetter(item);
  if (grade === "D") return { query: false, reason: "d_grade" };
  if (!["A", "B", "C"].includes(grade)) return { query: false, reason: "not_abc" };
  if (config.excludeNonResearchRecords !== false && isNonResearchRecordTitle(titleText(item), config.nonResearchTitlePrefixes)) {
    return { query: false, reason: "non_research_record" };
  }
  const journal = journalName(item);
  if (!journal) return { query: false, reason: "missing_journal" };
  if (config.exemptJournals?.length > 0 && config.exemptJournals.includes(normalizeJournalName(journal))) {
    return { query: false, reason: "exempt", journal };
  }
  if (config.excludePreprints !== false && isPreprintSource(journal, config.preprintSources)) {
    return { query: false, reason: "preprint", journal };
  }
  return { query: true, journal };
}

export async function fetchEasyScholarJournalRank(journal, {
  secretKey = process.env.EASYSCHOLAR_SECRET_KEY || "",
  fetchImpl = globalThis.fetch,
  attempts = 3,
  timeoutMs = 15000,
} = {}) {
  if (!secretKey) {
    return { found: false, impactFactor: null, casSmallPartition: "", raw: {}, error: "missing_secret_key" };
  }
  if (typeof fetchImpl !== "function") {
    return { found: false, impactFactor: null, casSmallPartition: "", raw: {}, error: "fetch_unavailable" };
  }

  const url = new URL(EASY_SCHOLAR_URL);
  url.searchParams.set("secretKey", secretKey);
  url.searchParams.set("publicationName", journal);
  let lastError = null;
  for (let i = 1; i <= attempts; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        lastError = new Error(`http_${res.status}`);
        if ((res.status === 429 || res.status >= 500) && i < attempts) {
          await sleep(500 * i);
          continue;
        }
        return { found: false, impactFactor: null, casSmallPartition: "", raw: {}, error: `http_${res.status}` };
      }
      const payload = await res.json();
      const parsed = parseEasyScholarRank(payload);
      return { ...parsed, error: "" };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (i < attempts) await sleep(500 * i);
    }
  }
  return { found: false, impactFactor: null, casSmallPartition: "", raw: {}, error: String(lastError?.message || lastError || "lookup_failed") };
}

function classifyQuality(metrics = {}, config = {}) {
  const impactFactor = parseNumber(metrics.impactFactor);
  if (impactFactor !== null && impactFactor < config.minImpactFactor) {
    return { keep: false, reason: "impact_factor_below_threshold" };
  }
  if (isCasPartitionExcluded(metrics.casSmallPartition, config.excludeCasSmallPartitions)) {
    return { keep: false, reason: "cas_small_partition_excluded" };
  }
  return { keep: true, reason: "" };
}

async function lookupWithAliases(journal, lookup) {
  const names = [journal];
  const cleaned = cleanText(journal).replace(/^The\s+/i, "");
  const noSubtitle = cleaned.split(/\s+:\s+/)[0]?.trim();
  if (noSubtitle && !names.includes(noSubtitle)) names.push(noSubtitle);
  if (cleaned && cleaned !== journal && cleaned !== noSubtitle) names.push(cleaned);

  let last = null;
  for (const name of names) {
    try {
      const result = await lookup(name);
      last = { ...result, queriedName: name };
      if (result?.found || result?.impactFactor !== null || result?.casSmallPartition) return last;
    } catch (error) {
      last = { found: false, impactFactor: null, casSmallPartition: "", raw: {}, error: String(error?.message || error), queriedName: name };
    }
  }
  return last || { found: false, impactFactor: null, casSmallPartition: "", raw: {}, error: "lookup_failed", queriedName: journal };
}

export async function applyJournalQualityGate(items = [], {
  config: rawConfig = {},
  lookup = fetchEasyScholarJournalRank,
  wait = sleep,
  cachePath = "",
} = {}) {
  const config = buildJournalQualityConfig(rawConfig);
  const persistentCache = await readJournalCache(cachePath);
  const persistentEntries = persistentCache.entries;
  const report = {
    enabled: Boolean(config.enabled),
    apply_to_sources: config.applyToSources,
    min_impact_factor: config.minImpactFactor,
    exclude_cas_small_partitions: config.excludeCasSmallPartitions,
    exclude_preprints: config.excludePreprints,
    preprint_sources: config.preprintSources,
    exclude_non_research_records: config.excludeNonResearchRecords,
    non_research_title_prefixes: config.nonResearchTitlePrefixes,
    missing_policy: config.missingPolicy,
    rate_limit_per_second: config.rateLimitPerSecond,
    input_count: items.length,
    output_count: 0,
    queried_journal_count: 0,
    cache_hit_count: 0,
    run_cache_hit_count: 0,
    local_cache_hit_count: 0,
    local_cache_miss_count: 0,
    local_cache_read_count: persistentCache.stats.read_count,
    local_cache_write_count: 0,
    local_cache_parse_error_count: persistentCache.stats.parse_error_count,
    local_cache_path: cachePath || "",
    excluded_count: 0,
    missing_count: 0,
    failed_count: 0,
    skipped_rss_count: 0,
    skipped_d_count: 0,
    skipped_other_count: 0,
    excluded_items: [],
    exempt_count: 0,
    exempt_items: [],
    missing_items: [],
    failed_items: [],
  };
  if (!config.enabled) {
    report.output_count = items.length;
    return { items, report };
  }

  const cache = new Map();
  const output = [];
  let lookupCount = 0;
  let persistentCacheDirty = false;
  const delayMs = Math.ceil(1000 / Math.max(1, config.rateLimitPerSecond || DEFAULT_RATE_LIMIT_PER_SECOND));

  for (const item of items) {
    const decision = shouldQueryJournalQuality(item, config);
    if (!decision.query) {
      if (decision.reason === "rss") report.skipped_rss_count += 1;
      else if (decision.reason === "d_grade") report.skipped_d_count += 1;
      else if (decision.reason === "exempt") {
        report.exempt_count += 1;
        report.exempt_items.push(itemAuditRecord(item, { reason: "exempt_journal", journal: decision.journal }));
      }
      else if (decision.reason === "preprint") {
        report.excluded_count += 1;
        report.excluded_items.push(itemAuditRecord(item, { reason: "preprint_excluded" }));
        continue;
      }
      else if (decision.reason === "non_research_record") {
        report.excluded_count += 1;
        report.excluded_items.push(itemAuditRecord(item, { reason: "non_research_record_excluded" }));
        continue;
      }
      else report.skipped_other_count += 1;
      output.push(item);
      continue;
    }

    const cacheKeys = journalCacheKeys(item, decision.journal);
    const cacheKey = cacheKeys[0] || `journal:${normalizeJournalName(decision.journal)}`;
    let metrics = cache.get(cacheKey);
    if (metrics) {
      report.cache_hit_count += 1;
      report.run_cache_hit_count += 1;
    } else {
      const persistentKey = cacheKeys.find((key) => persistentEntries[key]);
      if (persistentKey) {
        metrics = metricsFromCacheEntry(persistentEntries[persistentKey]);
        report.cache_hit_count += 1;
        report.local_cache_hit_count += 1;
      } else {
        report.local_cache_miss_count += 1;
        if (lookupCount > 0) await wait(delayMs);
        lookupCount += 1;
        metrics = await lookupWithAliases(decision.journal, lookup);
        report.queried_journal_count += 1;
        if (cacheKeys.length) {
          const entry = cacheEntryFromMetrics(metrics, cacheKey);
          for (const key of cacheKeys) persistentEntries[key] = { ...entry, normalized_key: key };
          persistentCacheDirty = true;
        }
      }
      cache.set(cacheKey, metrics);
    }

    const enriched = {
      ...item,
      journal_metrics: {
        source: "easyscholar",
        found: Boolean(metrics?.found),
        queried_name: metrics?.queriedName || decision.journal,
        impact_factor: metrics?.impactFactor ?? null,
        impact_factor_5y: metrics?.impactFactor5Year ?? null,
        cas_small_partition: metrics?.casSmallPartition || "",
        error: metrics?.error || "",
      },
    };

    if (metrics?.error) {
      report.failed_count += 1;
      report.failed_items.push(itemAuditRecord(enriched, { reason: metrics.error }));
      output.push(enriched);
      continue;
    }
    if (!metrics?.found && metrics?.impactFactor === null && !metrics?.casSmallPartition) {
      report.missing_count += 1;
      report.missing_items.push(itemAuditRecord(enriched, { reason: "missing_metrics" }));
      output.push(enriched);
      continue;
    }

    const quality = classifyQuality(metrics, config);
    if (!quality.keep) {
      report.excluded_count += 1;
      report.excluded_items.push(itemAuditRecord(enriched, {
        reason: quality.reason,
        impact_factor: metrics?.impactFactor ?? null,
        cas_small_partition: metrics?.casSmallPartition || "",
      }));
      continue;
    }
    output.push(enriched);
  }

  report.output_count = output.length;
  if (persistentCacheDirty) {
    try {
      await writeJournalCache(cachePath, persistentEntries);
      report.local_cache_write_count = 1;
    } catch (error) {
      report.local_cache_write_count = 0;
      report.failed_items.push(itemAuditRecord({}, { reason: "journal_cache_write_failed", error: String(error?.message || error).slice(0, 180) }));
    }
  }
  return { items: output, report };
}
