# Web API Validation Reference

## Lightweight Checks

- `git status --short`
- `node --check <changed-js-file>`
- Targeted `node --test` for changed modules.

Do not run a real Zotero workflow for docs-only or skill-only changes.

## Stage2-Only Benchmark

Use this for writeback performance or correctness work before a full workflow:

```powershell
$env:ZOTERO_BACKEND='web_api'
$env:ZOTERO_WRITEBACK_OBSERVATION_MODE='0'
node workflow/tests/stage2_api_writeback_benchmark.mjs --real-run --limit=74 --run-id=<run_id>
```

Required Stage2 checks:
- backend = `ZoteroWebApiBackend`
- `desktop_launched=false`
- created count equals input count
- `write_items` is primary path; `write_item` is fallback only
- source collection count matches created count
- grade collection count matches created count
- root `文献池` count for new items = 0
- shortTitle verified via readback
- run marker present
- cleanup residual = 0 (items and collections)
- cloud residual = 0
- local index residual = 0
- API request count, retry/rate-limit stats reported

## Full Workflow Acceptance

Run only for final end-to-end validation. The harness closes Desktop before Web and will not start Web unless Desktop cleanup/restore passes:

```powershell
node tests/full_workflow_benchmark/run_dual_backend_benchmark.mjs
```

Required checks:
- exitCode 0
- `desktop_launched=false`
- created count, source/grade correct
- root `文献池` count = 0
- shortTitle verified = created count
- run marker complete
- local/live index correct
- feedback workbook and rules files generated
- `POST /items` metadata batches are at most 50; `PATCH /items` and per-item fallback are 0
- request concurrency peak is at most 4; version/partial-failure/retry counters are reported
- first and second cleanup residual/unknown = 0; second deleted = 0
- local cache/state hashes and protected formal outputs match prestate
- API request/retry/rate-limit stats reported

## Common Test Commands

```powershell
node --check workflow/tools/lib/zotero_web_api_backend.mjs
node --test workflow/tests/zotero_backend.test.mjs
node --test workflow/tests/writeback_to_zotero.test.mjs
```
