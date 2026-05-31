# Public Agent Instructions

## Scope

This folder contains the public release of a Zotero MCP literature workflow. Keep changes minimal, auditable, and limited to files required by the workflow.

## Runtime

- Node.js >= 18.0.0
- PowerShell 7 or newer
- Zotero Desktop with Zotero MCP available for Stage 2 and Stage 3

## Main Entrypoint

Use this command for the full workflow:

```powershell
cd Automation
node --env-file=.env tools/run_zotero_literature_filter.mjs
```

The entrypoint runs Stage 1, checks MCP readiness, then runs Stage 2, Stage 3, and Stage 4.

## Public Release Hygiene

- Do not commit .env, credentials, logs, generated exports, caches, Zotero database files, or personal review data.
- Use config/ files as templates and replace placeholders locally.
- Keep Skills and Automation files generic.
- Before publishing, scan for local paths, credential values, personal names, email addresses, and project-specific research terms.

## Validation

Run targeted checks first:

```powershell
cd Automation
node --check tools/run_zotero_literature_filter.mjs
node --test tests/*.test.mjs
```
