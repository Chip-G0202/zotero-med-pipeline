# Local Workflow

## Entry contract

Production intent follows one fixed chain:

`$paperecho-local -> skills/paperecho-local/scripts/run.mjs -> workflow/tools/runner/main.mjs --mode local -> preflight -> workflow/tools/local/main.mjs -> current-run validation`

The Skill must invoke its launcher, and the launcher must keep `mode=local`. It must not select Desktop/Web, construct a Zotero backend, start Zotero, or call Stage2/Stage3. Direct `workflow/tools/local/main.mjs` invocation is reserved for controlled maintenance, tests, or integrations that own configuration and result validation.

`--check` performs local configuration and filesystem checks only. `--run` invokes the Local entry once after preflight and validates only the run ID emitted by that invocation.

## Stable flow

1. Runner resolves Local configuration and validates the JSON/JSONL input plus a safe writable output root.
2. Local main starts a schema v1 run-group manifest and runs housekeeping.
3. Load Local papers, learning state, feedback, and the shared literature identity index.
4. Import JSON/JSONL candidates; do not perform Zotero or network retrieval implicitly.
5. Run shared Stage1 with `skipZotero: true` and poisoned Zotero boundaries.
6. Generate missing `translatedTitle` values through the shared translation/cache service.
7. Persist Local papers, learning state, feedback checkpoint, and only `presence.local` atomically.
8. Build the Local Stage4 source and export `周报.xlsx` with mutually exclusive `每日反馈` and `需人工复核` sheets.
9. Build the run summary and invoke Stage5 after successful Stage4; no recipient produces an allowed skip.
10. Persist timings, finish the run-group manifest, run registered ephemeral cleanup, and expose housekeeping warnings.
11. Runner reads exactly `<output-root>/runs/<run-id>/run_group.json` and validates schema, mode, manifest status, applicable stages, XLSX registration, Stage5, housekeeping, and cleanup.

Local Stage2 and Stage3 are `NOT_APPLICABLE`, not skipped failures. Monthly Zotero behavior is also `NOT_APPLICABLE`. A Stage5 failure does not delete or roll back the Stage1/Stage4 outputs, but the current production validation must fail.

## Local layout

- `state/papers.json`: Local paper snapshots.
- `state/learning-state.json`: preference audit pointer and consumed feedback event IDs.
- `feedback/events.jsonl`: append-only user feedback.
- `runs/<run-id>/run_group.json`: run-scoped schema v1 manifest (`running`, then `completed` or `failed`).
- `runs/<run-id>/timings.json`: per-run timing state.
- `runs/<run-id>/stage5/`: current-run notification receipt and literature overview when produced.
- `exports/<run-id>/周报.xlsx`: user-facing workbook.

Housekeeping may remove only registered run artifacts after the configured retention period. Local state, feedback, learning state, shared index, translation cache, monthly reports, and screening standards remain protected. Ephemeral cleanup may delete only explicitly registered closed/consumed files, such as a successfully consumed `local_export_source.json`; failed Stage4 input remains for diagnosis.

## Shared state

- `review_results/shared/current_literature_index.json`: canonical identity plus namespaced presence.
- `review_results/translation_cache.json`: title-keyed translations shared with both Zotero paths.

Local output roots never become an alternative authority for shared identity or translation caches. Local updates only `presence.local`; it must not persist Zotero item keys, collection membership, attachments, ratings, or `presence.zotero`.

## Validation and poison boundary

- Current-run validation must use the run ID returned by Local main; never scan `runs/` for the newest directory or reuse old Stage5 state.
- Tests must poison Zotero readiness, backend factories, launchers, Stage2, and Stage3, and assert those call counts remain zero.
- Use temporary roots and mock LLM/SMTP dependencies. Do not run a real Zotero workflow, external network request, or real notification while validating Local changes.
