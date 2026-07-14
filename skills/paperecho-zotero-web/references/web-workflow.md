# Web API Workflow Reference

## Entry contract

Production intent uses one fixed chain:

`$paperecho-zotero-web -> skills/paperecho-zotero-web/scripts/run.mjs -> workflow/tools/runner/main.mjs --mode web -> preflight -> workflow/tools/stage0/main.mjs -> current-run validation`

The launcher fixes `mode=web`; Runner sets `ZOTERO_BACKEND=web_api`. It must not infer mode from residual credentials, switch to Desktop, or launch Zotero Desktop. Direct Stage0 invocation is reserved for scheduled automation, maintenance/tests, or callers that own equivalent configuration and result validation.

## Configuration and preflight

- The API key comes from the configured secret environment-variable reference, normally `ZOTERO_API_KEY`; never place the value in JSON, chat, logs, or Git.
- `ZOTERO_USER_ID` is optional and may be resolved by the production adapter.
- `--check` validates local configuration and secret presence without calling Web API, LLM, SMTP, or production entry.
- `--run` performs preflight, invokes Stage0 once with the Web backend, and validates only that invocation's run ID.

## Stage flow

### Stage1: feedback learning and retrieval

- Reads previous feedback, RSS/PubMed/PMC sources, deduplicates, applies rules, and performs in-process LLM grading when configured.
- Produces triage and preference-learning artifacts shared with Desktop.

### Stage2: Zotero writeback through Web API

1. Create/resolve guarded date, source, and grade collections.
2. Create admitted items in Web API batches of at most 50.
3. Route each new item to exactly one source and one grade collection.
4. Persist run marker/recovery evidence and refresh the shared Zotero presence index.
5. Never add new items to root `文献池`.

### Stage3: translation and `shortTitle`

- Consumes the shared translation service/cache and writes `shortTitle` through version-aware Web API batches.
- Missing versions are fetched in targeted batches; there is no per-item fallback that bypasses the adapter.
- Readback must verify admitted metadata writes.

### Stage4: export

- Exports the current run's `周报.xlsx` with mutually exclusive `每日反馈` and `需人工复核` sheets.
- Produces export audit, optional due monthly report, and Run Summary.

### Stage5: notification

- Runs only after Stage4 succeeds.
- Uses current-run explicit attachments and run-scoped receipt/overview state; it never scans history.
- No recipient is an allowed skip. Notification failure preserves Stage1-Stage4 outputs but fails current-run validation when mail was required.

After the business stages, the entry finishes the schema v1 run-group, records housekeeping/ephemeral cleanup, and Runner reads exactly `<runRoot>/<runId>/run_group.json`. Validation checks schema, Web mode, completed manifest, Stage states, XLSX registration, Stage5, housekeeping, and cleanup.

## Failure boundaries

- Startup/configuration failure skips all business stages and records `failed_due_to_config_or_dependency`.
- Web readiness failure after Stage1 skips Stage2, Stage3, and Stage4 and records `degraded_due_to_zotero_backend_unavailable`; no final XLSX success may be claimed.
- Web never falls back to Desktop, and Local is not available from this launcher.

## Collection routing

- Root anchor: `文献池`.
- Daily: `YYYY-MM-DD` -> `RSS订阅` / `数据库检索` plus `A课题相关` / `B专题相关` / `C领域相关`.
- New items are not added to root `文献池`.

## Validation and cleanup

- Stage2 benchmark or real validation must use a unique run ID and exact item/collection keys from the recovery manifest.
- Cleanup runs twice: first removes exact owned resources; second must remove zero, with cloud/unknown and local-index residuals both zero.
- Real Web API writes require explicit authorization. Mock/unit validation must not call Web API, LLM, or SMTP.
