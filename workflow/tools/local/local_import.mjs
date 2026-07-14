import fs from "node:fs/promises";
import path from "node:path";
import { normalizeDoi } from "../lib/doi_normalization.mjs";

function normalizeCandidate(value, sourceFile, line = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("record_must_be_object");
  const title = String(value.title || value.name || "").trim();
  const doi = normalizeDoi(value.doi || value.DOI || "");
  const pmid = String(value.pmid || value.PMID || "").trim();
  const pmcid = String(value.pmcid || value.PMCID || "").trim();
  const url = String(value.url || value.URL || "").trim();
  if (!title || !(doi || pmid || pmcid || url || value.openalex_id || value.external_id)) throw new Error("title_and_stable_identifier_required");
  return {
    title,
    abstract: String(value.abstract || "").trim(),
    doi,
    pmid,
    pmcid,
    url,
    openalex_id: String(value.openalex_id || "").trim(),
    external_id: String(value.external_id || value.id || "").trim(),
    authors: value.authors || "",
    journal: String(value.journal || value.publicationTitle || "").trim(),
    publicationTitle: String(value.publicationTitle || value.journal || "").trim(),
    pubdate: String(value.pubdate || value.publication_date || "").trim(),
    source_channel: String(value.source_channel || "local_import"),
    source_platform: String(value.source_platform || "local"),
    source_file: sourceFile,
    ...(line ? { source_line: line } : {}),
  };
}

async function readOne(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (![".json", ".jsonl"].includes(ext)) return { items: [], errors: [] };
  const text = await fs.readFile(filePath, "utf8");
  const records = [];
  const errors = [];
  if (ext === ".jsonl") {
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try { records.push({ value: JSON.parse(line), line: index + 1 }); }
      catch (error) { errors.push({ file: filePath, line: index + 1, error: error.message }); }
    }
  } else {
    const value = JSON.parse(text);
    for (const entry of Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [value]) records.push({ value: entry, line: null });
  }
  const items = [];
  for (const record of records) {
    try { items.push(normalizeCandidate(record.value, filePath, record.line)); }
    catch (error) { errors.push({ file: filePath, line: record.line, error: error.message }); }
  }
  return { items, errors };
}

export async function importLocalCandidates(inputPath) {
  const resolved = path.resolve(inputPath);
  const stat = await fs.stat(resolved);
  const files = stat.isDirectory()
    ? (await fs.readdir(resolved, { withFileTypes: true })).filter((entry) => entry.isFile() && /\.jsonl?$/i.test(entry.name)).map((entry) => path.join(resolved, entry.name)).sort()
    : [resolved];
  const items = [];
  const errors = [];
  for (const file of files) {
    try {
      const result = await readOne(file);
      items.push(...result.items);
      errors.push(...result.errors);
    } catch (error) {
      errors.push({ file, line: null, error: error.message });
    }
  }
  if (!items.length) throw Object.assign(new Error("LOCAL_IMPORT_NO_VALID_ITEMS"), { details: errors });
  return { items, errors, files };
}
