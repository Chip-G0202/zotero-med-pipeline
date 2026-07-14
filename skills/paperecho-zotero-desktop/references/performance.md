# Performance Reference

## Baseline Comparison

- Compare the same immutable input hash, configuration, LLM/translation mode, and cache baseline.
- Normalize item writeback as items/s and process count as `ceil(created / batch_size)`; do not preserve one-off run IDs or timings as hard rules.
- Investigate a regression only after separating Stage 0–4, CLI process time, cleanup, restore, external LLM/translation wait, and cache effects.

## Stage2 Hotspots

- collection setup should use batch `ensure_writeback_collections` and avoid serial `create_collection` when collections already exist.
- item writeback should use stdin batches with default size `50`; process count should be close to `ceil(created / 50)` and per-item fallback should remain `0`.
- collection attach, shortTitle update, and cleanup should stay batched through JS bridge.
- Watch for repeated ping/readiness, repeated collection tree reads, and unexpected fallback.

## Journal Quality Cache

- Runtime cache path: `review_results/journal_quality_cache.json`.
- Do not commit the cache file.
- Use stable keys: ISSN/eISSN first, then normalized journal/source title.
- Cache hits should avoid EasyScholar/provider calls.
- Provider failures must degrade without crashing the workflow and should not cause repeated same-run calls for the same journal.

## Output Hygiene

Never stage or commit:

- `.planning`
- `review_results`
- runtime/cache/backup/benchmark output
- logs
- `.env` or secrets
- real workflow data
