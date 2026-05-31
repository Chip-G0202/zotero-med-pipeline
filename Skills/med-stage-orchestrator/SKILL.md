---
name: med-stage-orchestrator
description: v1.3 update
---

# med-stage-orchestrator

1. Enforce fixed stage order:
- Stage1: `run_research_os_pipeline.mjs` (JSON/triage/alignment artifacts only)
- Stage2: `mcp_bulk_writeback.mjs` (ABC writeback only)
- Stage3: `mcp_translation_backfill.mjs` (ABC shortTitle backfill only)
- Stage4: `finalize_research_os_exports.mjs` (final xlsx export only)

2. Stage boundary rules:
- Stage1/2/3 do not emit final xlsx deliverables.
- Stage4 is the only stage that emits final xlsx deliverables.
- Stage2 does not wait for translation completion.
- Stage4 must run after Stage2+Stage3 completion checks.

3. Upstream gates before Stage4 export:
- verify Stage2 status and required artifacts
- verify Stage3 status and required artifacts
- verify stale-artifact checks
- if gate fails, mark degraded/failed in report and skip normal-success xlsx

4. Output location policy:
- final xlsx export root: `research_os/文献评价` (relative to project root; resolved by `runtime_config.mjs` per platform)
- pipeline JSON/audit/state: `research_os/.../pipeline`
- Cross-platform: all paths use forward-slash normalization via `toPosix()` in `runtime_config.mjs`. No hardcoded Windows/macOS absolute paths in code.

5. Failure policy:
- keep safe downstream artifacts when possible
- record downgrade/skip reasons in generated report files
- never claim stage success from stale artifacts
