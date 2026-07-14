# Desktop Workflow Reference

## Environment

- Force desktop writeback with `ZOTERO_BACKEND=cli`.
- Set `ZOTERO_API_KEY=''` or ensure the key is unavailable to avoid Web API routing.
- Do not test API / cc / cloud paths during desktop workflow work.

## Startup And Readiness

1. Select the CLI backend.
2. Resolve Zotero executable.
3. Launch or connect to Zotero Desktop.
4. Wait for basic desktop availability.
5. Run `zotero-cli app ping`.
6. Verify JS bridge readiness.
7. Fail with bounded timeout and clear diagnostics if any step cannot become ready.

Executable discovery order when `ZOTERO_EXE` is not set:

1. `ZOTERO_EXE`
2. `ProgramFiles`
3. `ProgramFiles(x86)`
4. `LOCALAPPDATA`
5. `D:/Zotero`
6. `C:/Zotero`
7. `where.exe zotero.exe`
8. bare `zotero`

## Stage2 Writeback

- Use the upper-level `write_items` batch entrypoint.
- The CLI backend sends UTF-8 JS through stdin to `workflow/tools/lib/zotero_cli_stdin_runner.py`, which owns the Desktop JS bridge call.
- Do not embed the complete payload in `zotero-cli js CODE` or recursively split it by Windows command-line length.
- `ZOTERO_CLI_WRITEBACK_BATCH_SIZE` defaults to `50` and is clamped to `1–50`.
- One backend batch is one CLI child process. A transport/process failure stops later batches; there is no per-item fallback.
- Collection attach uses one batch `add_items_to_collections` call when possible.
- shortTitle uses batch metadata JS bridge.
- Initialize recovery before any collection/item side effect. Persist all successful keys from a batch in one atomic mutation before attach, metadata, or the next batch.
- Cleanup uses only exact manifest-owned keys and must pass twice: the second run deletes `0` with residual/unknown `0`.

## Collection And Dedupe Semantics

- New items go to exactly one source collection: `RSS订阅` or `数据库检索`.
- New items go to exactly one grade collection: `A课题相关`, `B专题相关`, or `C领域相关`.
- New items are not force-added to root `文献池`.
- Root `文献池` remains a managed anchor for legacy items, `待删除`, guard scope, and historical dedupe scope.
- Dedupe uses local/live indexes keyed by DOI, PMID, PMCID, arXiv, and exact normalized title.
- Cleanup must be scoped to exact keys persisted as `createdByRun=true`; `run_id` or a run marker alone is not ownership proof.
