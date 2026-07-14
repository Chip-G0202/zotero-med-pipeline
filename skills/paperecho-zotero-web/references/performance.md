# Web API Performance Reference

## Baseline Comparison

- Compare only identical input/config/LLM/translation/cache baselines, and report the input hash.
- Separate Stage 0–4, request wait, metadata writeback, cleanup, and restore; cleanup verification is not backend writeback time.
- Normalize metadata writeback as items/s plus GET/POST batch counts. Do not preserve one-off run IDs or timings as hard rules.

## Key Optimizations Applied

### Batch Create Accumulation
- `setTimeout(0)` → `setTimeout(1000)` in writeback worker flush
- Report actual batch sizes and fallback count for each run; do not preserve a one-off percentage as a contract.

### Batch Version Fetching And Metadata Writes
- `writeMetadataBatch` fetches missing versions with `/items?itemKey=key1,key2,...` (up to 50 per request).
- Multi-object metadata writes use `POST /items` in batches of at most 50; per-item and `PATCH /items` fallback remain disabled.

### Rate Limit Handling
- 429 + Retry-After: request-level retry with exponential backoff
- Backoff header: delays subsequent requests
- Unconditional sleeps removed; only adaptive waits remain

## Performance Hotspots

- `item_writeback`: dominated by batch create + rate limit waits
- `collection_attach`: bounded batch writes via `addItemsToCollections`, preserving each item's complete collection list
- `shortTitle update`: batch metadata `POST /items` with version fetching
- `cleanup`: batch delete with version fetching

## Guardrails

- Keep request concurrency at or below 4; do not trade version/recovery correctness for throughput.
- Treat external rate-limit/network variance separately from request-count regressions.
