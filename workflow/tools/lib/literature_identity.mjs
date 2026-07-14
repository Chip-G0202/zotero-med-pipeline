import { normalizeDoi } from "./doi_normalization.mjs";

export const LITERATURE_IDENTITY_PRIORITY = ["doi", "pmid", "pmcid", "arxiv", "openalex", "url", "title"];

function normalizeValue(value) {
  return String(value || "").toLowerCase().trim();
}

export function normalizeLiteratureUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return raw.replace(/#.*$/, "").replace(/\/$/, "").toLowerCase();
  }
}

export function normalizeTitleForExistingDedupe(value) {
  return String(value || "")
    .normalize("NFKC").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/[\u2010-\u2015\u2212\uff0d]/g, "-").replace(/[\u2018\u2019\u201A\u201B\u02BC\u2032\uff07]/g, "'").replace(/[\u201C\u201D\u201E\u201F\u2033\uff02]/g, '"')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ").replace(/[\uFE30\uFE31\uFE32\uFE33\uFE34\uFE58\uFE63\uff0d]/g, "-")
    .replace(/\.{3}/g, " ").replace(/…/g, " ").replace(/~/g, " ").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[\uff10-\uff19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 48))
    .replace(/[\uff21-\uff3a]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF21 + 97))
    .replace(/[\uff41-\uff5a]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF41 + 97))
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "").replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
}

export function getLiteratureDedupeFingerprints(item = {}) {
  const extra = String(item.extra || item.Extra || "");
  return {
    doi: normalizeDoi(item.doi || item.DOI || ""),
    pmid: normalizeValue(item.pmid || extra.match(/PMID:\s*([^\s]+)/i)?.[1] || ""),
    pmcid: normalizeValue(item.pmcid || extra.match(/PMCID:\s*([^\s]+)/i)?.[1] || ""),
    arxiv: normalizeValue(item.arxiv || item.arxiv_id || item.arXiv || extra.match(/arXiv:\s*([^\s]+)/i)?.[1] || ""),
    openalex: normalizeValue(item.openalex || item.openalex_id || item.openAlex || "").replace(/^https?:\/\/openalex\.org\//, ""),
    url: normalizeLiteratureUrl(item.url || item.URL || ""),
    title: normalizeTitleForExistingDedupe(item.title || ""),
  };
}

export function getLiteratureIdentityKeys(item = {}) {
  const fingerprints = getLiteratureDedupeFingerprints(item);
  return LITERATURE_IDENTITY_PRIORITY
    .map((type) => fingerprints[type] ? `${type}:${fingerprints[type]}` : "")
    .filter(Boolean);
}

export function matchLiteratureIdentity(item, fingerprintMaps = {}) {
  const fingerprints = getLiteratureDedupeFingerprints(item);
  for (const type of LITERATURE_IDENTITY_PRIORITY) {
    const value = fingerprints[type];
    const match = value && fingerprintMaps[type]?.[value];
    if (match) return { ...match, type, value };
  }
  return null;
}
