import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function configPath(root, name) {
  return path.join(root || repoRoot(), "config", name);
}

function readJsonConfig(filePath, fallback) {
  if (!fs.existsSync(filePath)) return { config: fallback, path: filePath, warnings: ["config_missing_using_default"] };
  try {
    return { config: JSON.parse(fs.readFileSync(filePath, "utf8")), path: filePath, warnings: [] };
  } catch (error) {
    throw new Error(`CONFIG_PARSE_ERROR ${filePath}: ${error.message}`);
  }
}

function enabled(entry) {
  return entry?.enabled !== false;
}

export function loadRssSources({ root } = {}) {
  const filePath = configPath(root, "rss_sources.json");
  const { config, path: resolvedPath, warnings } = readJsonConfig(filePath, { sources: [] });
  const rawSources = Array.isArray(config) ? config : Array.isArray(config.sources) ? config.sources : [];
  const sources = rawSources
    .map((entry) => typeof entry === "string" ? { url: entry, enabled: true } : entry)
    .filter((entry) => enabled(entry) && String(entry?.url || "").trim())
    .map((entry) => ({ name: String(entry.name || entry.url).trim(), url: String(entry.url).trim() }));
  return { path: resolvedPath, sources, warnings, raw_count: rawSources.length, enabled_count: sources.length };
}

function safePositiveInteger(value, fallback, warnings, field) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  warnings.push(`${field}_invalid_using_default_${fallback}`);
  return fallback;
}

function uniq(values) {
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
}

function normalizeRequiredGroups(value) {
  if (!Array.isArray(value)) return [];
  if (value.every((entry) => typeof entry === "string")) return [uniq(value)];
  return value
    .map((group) => uniq(Array.isArray(group) ? group : [group]))
    .filter((group) => group.length);
}

export function normalizePubMedKeywordGroups(value = {}) {
  return {
    required: normalizeRequiredGroups(value.required),
    optional: uniq(value.optional || []),
    negative: uniq(value.negative || []),
  };
}

function stripOuterParens(value) {
  let out = String(value || "").trim();
  while (out.startsWith("(") && out.endsWith(")")) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

export function parsePubMedQueryKeywordGroups(query = "") {
  const raw = String(query || "").trim();
  if (!raw) return normalizePubMedKeywordGroups();
  const notMatch = raw.match(/\s+NOT\s+\(([^)]*)\)\s*$/i);
  const negative = notMatch ? uniq(notMatch[1].split(/\s+OR\s+/i)) : [];
  const positiveRaw = notMatch ? raw.slice(0, notMatch.index).trim() : raw;
  const required = positiveRaw
    .split(/\s+AND\s+/i)
    .map((part) => uniq(stripOuterParens(part).split(/\s+OR\s+/i)))
    .filter((group) => group.length);
  return normalizePubMedKeywordGroups({ required, optional: [], negative });
}

export function buildPubMedQueryFromKeywordGroups(groups = {}) {
  const normalized = normalizePubMedKeywordGroups(groups);
  const positive = normalized.required
    .filter((group) => group.length)
    .map((group) => `(${group.join(" OR ")})`);
  const negative = normalized.negative.length ? `NOT (${normalized.negative.join(" OR ")})` : "";
  return [...positive, negative].filter(Boolean).join(" AND ").replace(/\s+AND\s+NOT\s+/i, " NOT ");
}

export function loadPubMedKeywordGroupsFromConfig(config = {}) {
  if (config.keyword_groups && typeof config.keyword_groups === "object") {
    return normalizePubMedKeywordGroups(config.keyword_groups);
  }
  return parsePubMedQueryKeywordGroups(config.query || "");
}

function removeTerms(groups, terms) {
  const removeSet = new Set(uniq(terms).map((term) => term.toLowerCase()));
  if (!removeSet.size) return groups;
  return {
    required: groups.required.map((group) => group.filter((term) => !removeSet.has(term.toLowerCase()))).filter((group) => group.length),
    optional: groups.optional.filter((term) => !removeSet.has(term.toLowerCase())),
    negative: groups.negative.filter((term) => !removeSet.has(term.toLowerCase())),
  };
}

export function applyKeywordModifications(groups = {}, modifications = {}) {
  let next = normalizePubMedKeywordGroups(groups);
  next = removeTerms(next, modifications.keywords_removed || []);
  const added = modifications.keywords_added || {};
  const requiredAdds = normalizeRequiredGroups(added.required || []);
  next.required = [...next.required, ...requiredAdds].map(uniq).filter((group) => group.length);
  next.optional = uniq([...next.optional, ...(Array.isArray(added.optional) ? added.optional : [])]);
  next.negative = uniq([
    ...next.negative,
    ...(Array.isArray(added.negative) ? added.negative : []),
    ...(Array.isArray(modifications.negative_keywords_added) ? modifications.negative_keywords_added : []),
  ]);
  return normalizePubMedKeywordGroups(next);
}

export function updatePubMedPmcKeywordGroups(filePath, modifications = {}) {
  const raw = readJsonConfig(filePath, {}).config;
  const beforeGroups = loadPubMedKeywordGroupsFromConfig(raw);
  const queryBefore = String(raw.query || buildPubMedQueryFromKeywordGroups(beforeGroups));
  const nextGroups = applyKeywordModifications(beforeGroups, modifications);
  const queryAfter = buildPubMedQueryFromKeywordGroups(nextGroups);
  const nextConfig = {
    ...raw,
    keyword_groups: nextGroups,
    query: queryAfter,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  return {
    config: nextConfig,
    keyword_groups_before: beforeGroups,
    keyword_groups_after: nextGroups,
    query_before: queryBefore,
    query_after: queryAfter,
  };
}

export function formatNcbiDate(date) {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

export function buildDateRangeFromDaysBack(now = new Date(), daysBack = 7) {
  const max = new Date(now);
  const min = new Date(now);
  min.setDate(max.getDate() - daysBack);
  return { minDate: formatNcbiDate(min), maxDate: formatNcbiDate(max) };
}

export function loadPubMedPmcSearchConfig({ root, now = new Date() } = {}) {
  const filePath = configPath(root, "pubmed_pmc_search.json");
  const fallback = {
    databases: ["pubmed"],
    days_back: 7,
    retmax: 300,
    sort: "date",
    datetype: "pdat",
    query: "(microplastic OR PFAS OR PM2.5 OR pollutant OR exposure) AND (neurotoxicity OR microglia OR neuroinflammation OR brain)",
  };
  const { config, path: resolvedPath, warnings } = readJsonConfig(filePath, fallback);
  const daysBack = safePositiveInteger(config.days_back, 7, warnings, "days_back");
  const retmax = safePositiveInteger(config.retmax, 300, warnings, "retmax");
  const databases = (Array.isArray(config.databases) ? config.databases : fallback.databases)
    .map((db) => String(db || "").trim().toLowerCase())
    .filter((db) => db === "pubmed" || db === "pmc");
  if (!databases.length) {
    warnings.push("databases_invalid_using_pubmed");
    databases.push("pubmed");
  }
  const keywordGroups = loadPubMedKeywordGroupsFromConfig(config);
  const query = String(config.query || buildPubMedQueryFromKeywordGroups(keywordGroups) || fallback.query).trim() || fallback.query;
  const dateRange = buildDateRangeFromDaysBack(now, daysBack);
  return {
    path: resolvedPath,
    databases,
    days_back: daysBack,
    retmax,
    sort: String(config.sort || fallback.sort),
    datetype: String(config.datetype || fallback.datetype),
    query,
    keyword_groups: keywordGroups,
    ...dateRange,
    warnings,
  };
}

export function buildNcbiESearchUrl(cfg, database = "pubmed") {
  const params = new URLSearchParams({
    db: database,
    retmode: "json",
    retmax: String(cfg.retmax || 300),
    sort: cfg.sort || "date",
    datetype: cfg.datetype || "pdat",
    mindate: cfg.minDate,
    maxdate: cfg.maxDate,
    term: cfg.query,
  });
  return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params.toString()}`;
}

export function loadWorkflowRules({ root } = {}) {
  const filePath = configPath(root, "workflow_rules.json");
  const fallback = {
    triage: {
      version: "2026-05-21-v2",
      labels: { A: "A课题相关", B: "B专题相关", C: "C领域相关", D: "D无关" },
      source_labels: { rss: "RSS", pubmed: "PubMed", pmc: "PMC", other: "other" },
      terms: {
        pollutant: ["pollution", "pollutant", "microplastic", "pm2.5", "pfas", "exposure", "toxic"],
        core_topic: ["microglia", "neuroinflamm", "brain", "cognitive", "mitochond", "synap", "neurotox"],
        mechanism: ["pathway", "mechanism", "axis", "oxidative", "omics", "signaling", "model"],
      },
      journal_whitelist: ["nature", "nature neuroscience", "nature reviews neuroscience", "science", "science advances", "cell", "cell reports", "neuron", "environmental health perspectives", "environmental science & technology", "environment international", "environmental pollution", "journal of neuroinflammation"],
      weights: { pollutant: 1.6, core_topic: 1.5, mechanism: 0.7, journal_quality: 1.2, feedback_positive: 0.6, feedback_negative: -1.0 },
      thresholds: { A_score: 6.0, A_min_pollutant_hits: 2, A_min_core_hits: 2, B_score: 3.4, C_score: 1.4, B_uncertain_below: 4.2, C_uncertain_below: 2.3 },
      grade_reasons: { A: "直接命中当前课题关键词组合，与核心课题问题高度贴合。", B: "与当前专题或邻近专题明显相关，可作为专题背景或方法参考。", C: "与所在研究领域相关，但距离当前课题和专题较远，低优先级保留。", D: "与当前课题、专题和领域相关性不足，仅保留审计记录。" },
    },
  };
  return readJsonConfig(filePath, fallback);
}
