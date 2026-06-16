import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const p = join('C:\\Users\\GaoChen\\Documents\\Zotero MCP', 'tools', 'run_research_os_pipeline.mjs');
let code = readFileSync(p, 'utf8');

// 1. Add import for cleanJournalName and inferJournalFromUrlSync
const importLine = 'import { createZoteroSemanticAdapter } from "./lib/zotero_semantic_search.mjs";';
const newImport = 'import { cleanJournalName, inferJournalFromUrlSync } from "./lib/journal_name_cleaner.mjs";\n' + importLine;
if (!code.includes('cleanJournalName')) {
  code = code.replace(importLine, newImport);
  console.log('Added cleanJournalName import');
} else {
  console.log('cleanJournalName import already exists');
}

// 2. Add publicationTitle to parseRssItems
const oldRssPush = `    items.push({
      source_channel: "rss",
      source_platform: "rss",
      feed_url: sourceUrl,
      journal: channelTitle,
      item_type_hint: "journalArticle",`;
const newRssPush = `    const cleanedJournal = cleanJournalName(channelTitle);
    const inferredJournal = cleanedJournal || inferJournalFromUrlSync(link) || "";
    items.push({
      source_channel: "rss",
      source_platform: "rss",
      feed_url: sourceUrl,
      journal: channelTitle,
      publicationTitle: inferredJournal,
      item_type_hint: "journalArticle",`;
if (!code.includes('publicationTitle: inferredJournal')) {
  code = code.replace(oldRssPush, newRssPush);
  console.log('Added publicationTitle to parseRssItems');
} else {
  console.log('publicationTitle in parseRssItems already exists');
}

// 3. Add publicationTitle to fetchNcbiDatabase
const oldDbPush = `      journal: r.fulljournalname || "",
      pubdate: r.pubdate || "",`;
const newDbPush = `      journal: r.fulljournalname || "",
      publicationTitle: r.fulljournalname || "",
      pubdate: r.pubdate || "",`;
if (!code.includes('publicationTitle: r.fulljournalname')) {
  code = code.replace(oldDbPush, newDbPush);
  console.log('Added publicationTitle to fetchNcbiDatabase');
} else {
  console.log('publicationTitle in fetchNcbiDatabase already exists');
}

writeFileSync(p, code, 'utf8');
console.log('File saved.');

// Verify
const check = readFileSync(p, 'utf8');
console.log('Verify - Has cleanJournalName import:', check.includes('cleanJournalName'));
console.log('Verify - Has publicationTitle: inferredJournal:', check.includes('publicationTitle: inferredJournal'));
console.log('Verify - Has publicationTitle: r.fulljournalname:', check.includes('publicationTitle: r.fulljournalname'));
