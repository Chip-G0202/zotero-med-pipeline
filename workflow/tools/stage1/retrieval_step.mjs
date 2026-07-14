import { buildNcbiESearchUrl, loadOpenAlexConfig, loadPubMedPmcSearchConfig, loadRssSources } from "../lib/literature_config.mjs";
import { cleanJournalName, inferJournalFromUrlSync } from "../lib/journal_name_cleaner.mjs";

function cleanText(s) {
  return String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchTextWithRetry(url, attempts = 3, timeoutMs = 15000) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetchText(url, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 600 * i));
    }
  }
  throw lastErr || new Error("UNKNOWN_FETCH_ERROR");
}

export function parseRssItems(xml, sourceUrl) {
  const items = [];
  const channelTitle = cleanText((xml.match(/<channel[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const title = cleanText((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const link = cleanText((b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || "");
    const desc = cleanText((b.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || "");
    if (!title) continue;
    const doi = (desc.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i) || [])[0] || "";
    const cleanedJournal = cleanJournalName(channelTitle);
    const inferredJournal = cleanedJournal || inferJournalFromUrlSync(link) || "";
    items.push({
      source_channel: "rss",
      source_platform: "rss",
      feed_url: sourceUrl,
      journal: channelTitle,
      publicationTitle: inferredJournal,
      item_type_hint: "journalArticle",
      title,
      url: link,
      abstract: desc,
      doi: doi.toLowerCase(),
    });
  }
  return items;
}

export async function fetchRssAll({ root } = {}) {
  const out = [];
  const failed = [];
  const rssConfig = loadRssSources({ root });
  await Promise.all(
    rssConfig.sources.map(async ({ url: u }) => {
      try {
        const xml = await fetchTextWithRetry(u, 3, 15000);
        out.push(...parseRssItems(xml, u));
      } catch (e) {
        failed.push({ feed: u, error: String(e.message || e) });
      }
    }),
  );
  return { items: out, failed, config: rssConfig };
}

export async function fetchNcbiDatabase(database, cfg) {
  const esearchUrl = buildNcbiESearchUrl(cfg, database);
  const txt = await fetchText(esearchUrl, 20000);
  const json = JSON.parse(txt);
  const ids = json?.esearchresult?.idlist || [];
  if (!ids.length) return { items: [], failed: [] };
  const esummaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=${encodeURIComponent(database)}&retmode=json&id=${ids.join(",")}`;
  const sumTxt = await fetchText(esummaryUrl, 20000);
  const sum = JSON.parse(sumTxt);
  const items = ids
    .map((id) => sum?.result?.[id])
    .filter(Boolean)
    .map((r, i) => ({
      source_channel: "database",
      source_platform: database,
      item_type_hint: "journalArticle",
      title: cleanText(r.title || ""),
      url: database === "pmc" ? `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${ids[i]}/` : `https://pubmed.ncbi.nlm.nih.gov/${ids[i]}/`,
      abstract: "",
      doi: "",
      pmid: database === "pubmed" ? String(ids[i]) : "",
      pmcid: database === "pmc" ? `PMC${ids[i]}` : "",
      journal: r.fulljournalname || "",
      publicationTitle: r.fulljournalname || "",
      pubdate: r.pubdate || "",
    }));
  return { items, failed: [] };
}

export async function fetchPubMed(externalCfg, { root } = {}) {
  const cfg = externalCfg || loadPubMedPmcSearchConfig({ root, now: new Date() });
  const items = [];
  const failed = [];
  for (const database of cfg.databases) {
    try {
      const result = await fetchNcbiDatabase(database, cfg);
      items.push(...result.items);
      failed.push(...(result.failed || []));
    } catch (error) {
      failed.push({ source: database, error: String(error.message || error) });
    }
  }
  return { items, failed, config: cfg };
}

function normalizeDoi(doi) {
  return String(doi || "").replace(/^https?:\/\/doi\.org\//i, "").toLowerCase().trim();
}

function decodeAbstractFromInvertedIndex(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== "object") return "";
  try {
    const wordPositions = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
      if (Array.isArray(positions)) {
        for (const pos of positions) {
          if (typeof pos === "number") {
            wordPositions.push({ word, pos });
          }
        }
      }
    }
    wordPositions.sort((a, b) => a.pos - b.pos);
    return wordPositions.map((wp) => wp.word).join(" ").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function formatAuthors(authorships) {
  if (!Array.isArray(authorships)) return "";
  return authorships
    .slice(0, 10)
    .map((a) => a?.author?.display_name || "")
    .filter(Boolean)
    .join(", ");
}

function extractVenue(primaryLocation) {
  if (!primaryLocation) return "";
  const source = primaryLocation.source;
  if (source?.display_name) return source.display_name;
  if (primaryLocation.venue) return primaryLocation.venue;
  return "";
}

export function normalizeOpenAlexItem(work) {
  const doi = normalizeDoi(work?.doi);
  const title = String(work?.title || "").replace(/\s+/g, " ").trim();
  const publicationYear = work?.publication_year || null;
  const publicationDate = work?.publication_date || "";
  const authors = formatAuthors(work?.authorships);
  const venue = extractVenue(work?.primary_location);
  const url = work?.primary_location?.landing_page_url || (doi ? "https://doi.org/" + doi : "");
  const abstract = decodeAbstractFromInvertedIndex(work?.abstract_inverted_index);
  const openalexId = String(work?.id || "").replace("https://openalex.org/", "");
  const isOpenAccess = work?.open_access?.is_oa === true;
  const oaUrl = work?.open_access?.oa_url || "";
  return {
    source_channel: "openalex",
    source_platform: "openalex",
    item_type_hint: "journalArticle",
    title,
    url: url || oaUrl,
    abstract,
    doi,
    authors,
    publication_year: publicationYear,
    publication_date: publicationDate,
    journal: venue,
    publicationTitle: venue,
    openalex_id: openalexId,
    is_open_access: isOpenAccess,
    oa_url: oaUrl,
    pmid: "",
    pmcid: "",
  };
}

export function buildOpenAlexSearchParams(cfg) {
  const params = new URLSearchParams();
  if (cfg.query) {
    params.set("search", cfg.query);
  }
  params.set("per_page", String(cfg.per_page || 50));
  params.set("select", cfg.select || "id,doi,title,publication_year,publication_date,authorships,primary_location,abstract_inverted_index,open_access,type");
  if (cfg.mailto) {
    params.set("mailto", cfg.mailto);
  }
  const filters = [];
  if (cfg.filters?.type) {
    filters.push("type:" + cfg.filters.type);
  }
  if (cfg.filters?.from_publication_date) {
    filters.push("from_publication_date:" + cfg.filters.from_publication_date);
  } else if (cfg.days_back) {
    const max = new Date();
    const min = new Date(max);
    min.setDate(max.getDate() - cfg.days_back);
    const fmt = (d) => d.toISOString().slice(0, 10);
    filters.push("from_publication_date:" + fmt(min));
  }
  if (cfg.filters?.to_publication_date) {
    filters.push("to_publication_date:" + cfg.filters.to_publication_date);
  }
  if (cfg.filters?.is_oa === true) {
    filters.push("is_oa:true");
  }
  if (Array.isArray(cfg.filters?.concepts) && cfg.filters.concepts.length > 0) {
    filters.push("concepts:" + cfg.filters.concepts.join("|"));
  }
  if (filters.length > 0) {
    params.set("filter", filters.join(","));
  }
  if (cfg.sort) {
    params.set("sort", cfg.sort);
  }
  return "https://api.openalex.org/works?" + params.toString();
}

export async function fetchOpenAlex(externalCfg, { root } = {}) {
  const cfg = externalCfg || loadOpenAlexConfig({ root });
  if (!cfg.enabled) {
    return { items: [], failed: [], config: cfg, skipped_reason: "openalex_disabled" };
  }
  if (!cfg.query) {
    return { items: [], failed: [], config: cfg, skipped_reason: "empty_query" };
  }
  const items = [];
  const failed = [];
  try {
    const url = buildOpenAlexSearchParams(cfg);
    const txt = await fetchTextWithRetry(url, 3, 20000);
    const json = JSON.parse(txt);
    const results = json?.results || [];
    for (const work of results) {
      try {
        items.push(normalizeOpenAlexItem(work));
      } catch (e) {
        failed.push({ source: "openalex", error: "normalize_error: " + String(e.message || e) });
      }
    }
  } catch (e) {
    failed.push({ source: "openalex", error: String(e.message || e) });
  }
  return { items, failed, config: cfg };
}

function retrievalFailureResult(source, error) {
  const message = String(error?.message || error);
  if (source === "rss") return { items: [], failed: [{ source: "rss", error: message }], config: { enabled_count: 0, warnings: [] } };
  if (source === "pubmed") return { items: [], failed: [{ source: "pubmed", error: message }], config: { databases: [], warnings: [] } };
  return { items: [], failed: [{ source: "openalex", error: message }], config: { enabled: true, warnings: [] } };
}

export async function runSelectedRetrievalSources({
  root,
  pubmedPmcConfig,
  openAlexConfig = null,
  plan = {},
  fetchers = {},
} = {}) {
  const {
    rssEnabled = false,
    pubmedEnabled = false,
    openalexEnabled = false,
  } = plan;
  const fetchRss = fetchers.fetchRssAll || fetchRssAll;
  const fetchPubmed = fetchers.fetchPubMed || fetchPubMed;
  const fetchOpenalex = fetchers.fetchOpenAlex || fetchOpenAlex;
  const tasks = [
    {
      key: "rss",
      enabled: rssEnabled,
      disabled: { items: [], failed: [], config: { enabled_count: 0, warnings: [] } },
      run: () => fetchRss({ root }),
    },
    {
      key: "db",
      failureSource: "pubmed",
      enabled: pubmedEnabled,
      disabled: { items: [], failed: [], config: { databases: [], warnings: [] } },
      run: () => fetchPubmed(pubmedPmcConfig, { root }),
    },
    {
      key: "openalex",
      enabled: openalexEnabled,
      disabled: { items: [], failed: [], config: { enabled: false, warnings: [] } },
      run: () => fetchOpenalex(openAlexConfig || loadOpenAlexConfig({ root }), { root }),
    },
  ];
  const settled = await Promise.allSettled(
    tasks.map(async (task) => {
      if (!task.enabled) return [task.key, task.disabled];
      return [task.key, await task.run()];
    }),
  );
  const result = {};
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const entry = settled[i];
    if (entry.status === "fulfilled") {
      const [key, value] = entry.value;
      result[key] = value;
    } else {
      result[task.key] = retrievalFailureResult(task.failureSource || task.key, entry.reason);
    }
  }
  return result;
}
