---
name: med-stage-orchestrator
description: 四阶段编排与边界控制技能。Use when enforcing Stage1→Stage2→Stage3→Stage4 order, upstream gates, and downgrade reporting.
---

# med-stage-orchestrator

1. Enforce fixed stage order:
- Stage1: `run_research_os_pipeline.mjs` (JSON/triage/alignment artifacts only)
- Stage2: `mcp_bulk_writeback.mjs` (ABC writeback only)
- Stage3: `mcp_translation_backfill.mjs` (ABC shortTitle backfill only)
- Stage4: `finalize_research_os_exports.mjs` (final xlsx export + monthly docx export only)

2. Stage boundary rules:
- Stage1/2/3 do not emit final user-facing deliverables.
- Stage4 is the only stage that emits final daily xlsx and monthly docx deliverables.
- Stage2 does not wait for translation completion.
- Stage4 must run after Stage2+Stage3 completion checks.

3. Upstream gates before Stage4 export:
- verify Stage2 status and required artifacts
- verify Stage3 status and required artifacts
- verify stale-artifact checks
- if gate fails, mark degraded/failed in report and skip normal-success xlsx

4. Output location policy:
- daily xlsx: `research_os/<yy.MM>/<MM.dd>/隔日报.xlsx`
- monthly docx: `research_os/<yy.MM>/月报-<period>.docx`
- pipeline JSON/audit/state: `research_os/<yy.MM>/<MM.dd>/pipeline`
- Cross-platform: all paths use forward-slash normalization via `toPosix()` in `runtime_config.mjs`. No hardcoded Windows/macOS absolute paths in code.

5. Failure policy:
- keep safe downstream artifacts when possible
- record downgrade/skip reasons in generated report files
- never claim stage success from stale artifacts
