# v1.3 update

This folder contains the public automation workflow files. Run commands from this
directory after cloning or uploading the release package.

## Entrypoint

```powershell
cd Automation
node --env-file=.env tools/run_zotero_literature_filter.mjs
```

## Stage Order

1. Stage 1: retrieve, merge, deduplicate, triage, and write audit JSON.
2. MCP readiness: probe Zotero MCP before metadata writeback.
3. Stage 2: write accepted A/B/C items to Zotero through MCP.
4. Stage 3: backfill translated short titles for written items.
5. Stage 4: export user-facing workbook and summary report.

Use placeholder configs in config/ as templates. Do not store credentials or generated review outputs in this repository.
