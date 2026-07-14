export function cleanText(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTitleForDedupe(value) {
  return cleanText(value)
    .normalize("NFKC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[""]/g, "\"")
    .replace(/['']/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
}

export function normalizeIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

export function buildDedupeKey(item = {}) {
  const doi = normalizeIdentifier(item.doi || item.DOI);
  if (doi) return `doi:${doi}`;
  const pmid = normalizeIdentifier(item.pmid);
  if (pmid) return `pmid:${pmid}`;
  const pmcid = normalizeIdentifier(item.pmcid);
  if (pmcid) return `pmcid:${pmcid}`;
  const title = normalizeTitleForDedupe(item.title || "");
  if (title) return `title:${title}`;
  const url = normalizeIdentifier(item.url);
  return `url:${url}`;
}
