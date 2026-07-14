# Validation Reference

## Lightweight Checks

- `git status --short`
- `node --check <changed-js-file>`
- Targeted `node --test` for changed modules.

Do not run a real Zotero workflow for docs-only or skill-only changes.

## Stage2-Only Benchmark

Use this for writeback performance or correctness work before a full workflow:

```powershell
$env:ZOTERO_BACKEND='cli'
$env:ZOTERO_API_KEY=''
node workflow/tests/stage2_writeback_benchmark.mjs --real-run --limit=74 --run-id=<run_id>
```

Real benchmarks automatically clean only the exact item/collection keys recorded for that run. Set `PAPERFLOW_BENCHMARK_KEEP_ARTIFACTS=true` only when the artifacts must be retained; after a forced termination, dry-run and then apply the generated `stage2_smoke_cleanup_manifest.json` with the matching run id.

Required Stage2 checks:

- created count equals input count
- `write_items` is used and `write_item` is `0`
- fallback is `0` unless intentionally testing failure handling
- source collection count matches created count
- grade collection count matches created count
- root `文献池` count for new items is `0`
- shortTitle is written
- run marker is present
- cleanup residual is `0`

## Full Workflow Acceptance

Run the complete dual-backend harness only for final end-to-end validation:

```powershell
node tests/full_workflow_benchmark/run_dual_backend_benchmark.mjs
```

The Desktop run must complete and restore before the harness starts Web. Required Desktop checks:

- exitCode `0`
- source and grade collections correct
- new root `文献池` membership `0`
- shortTitle correct
- run marker complete
- local/live index correct
- feedback workbook and rules files generated
- recovery is complete and created-key count equals created count
- first and second cleanup leave Zotero/local index residual and unknown counts `0`
- local cache/state existence, size, and SHA-256 match prestate; protected formal outputs are unchanged
