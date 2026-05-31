---
name: med-entry-parallel
description: v1.3 update
---

# med-entry-parallel

1. Run two channels in parallel:
- `channel_rss`: existing RSS feeds and parser.
- `channel_db`: PubMed/PMC only via `academic-search`.

2. Normalize fields before merge:
- `title`, `doi`, `pmid`, `pmcid`, `url`, `authors`, `year`, `journal_or_venue`, `abstract?`

3. Keep provenance on each record:
- `channel`
- `source_platform`
- `query_id` (db channel)

4. Deduplicate with fixed priority:
- DOI exact
- PMID/PMCID exact
- URL exact
- normalized title exact

5. Guardrails:
- Never fabricate metadata.
- If PubMed/PMC fails, continue RSS and log failure.
- Do not query non-target databases.
