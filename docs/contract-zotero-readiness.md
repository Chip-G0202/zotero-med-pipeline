# Zotero Backend Readiness Contract

Zotero readiness belongs to the explicitly selected Desktop or Web adapter. Interactive runs first use the path launcher and shared Runner preflight; the Stage0 production entry performs the runtime startup/readiness gates. Local does not participate in this contract.

## Backend selection

| Runner mode | Backend | Desktop required | Required secret | Selection rule |
|---|---|---:|---|---|
| `desktop` | `cli` | yes | none | Desktop launcher fixes mode and Runner sets `ZOTERO_BACKEND=cli` |
| `web` | `web_api` | no | configured `ZOTERO_API_KEY` reference | Web launcher fixes mode and Runner sets `ZOTERO_BACKEND=web_api` |

Runner must not infer mode from `ZOTERO_BACKEND`, API key residue, SMTP, or LLM configuration. Desktop and Web fail closed on their own backend and never switch adapters. Scheduled/maintenance direct Stage0 callers must select and validate their backend explicitly.

## Preflight and runtime readiness

- Runner `--check` performs local configuration and presence checks only; it does not call Zotero/Web API or start production.
- Desktop preflight checks the configured executable/CLI bridge locally. Runtime startup may launch Desktop with the selected platform command, then requires CLI/JS bridge readiness.
- Web preflight checks credential presence without network access. Runtime readiness uses the authenticated Web API and must not launch Desktop.
- Process existence is diagnostic evidence only. Stage2/Stage3 require a successful selected-backend readiness probe.
- `ZOTERO_EXE` is only for Desktop launch and must never be used to access `zotero.sqlite` directly.

## Failure semantics

- Startup/configuration failure before Stage1 skips all business stages and reports `failed_due_to_config_or_dependency` with diagnostics.
- Backend readiness failure after Stage1 skips Stage2, Stage3, and Stage4 and reports `degraded_due_to_zotero_backend_unavailable`.
- A readiness failure must not claim writeback, translation backfill, final XLSX, or Stage5 success.
- Stale `zotero_writeback_summary.json` and `abc_translation_backfill.json` are never current-run success evidence.

## Validation

Desktop validation uses Desktop mocks/contract tests; Web validation uses Web API mocks/contract tests. Real backend probes or writes require explicit authorization. After a production entry exits, Runner must validate the emitted run ID and exact schema v1 `run_group.json`, including mode, stages, current XLSX registration, Stage5, housekeeping, and ephemeral cleanup.
