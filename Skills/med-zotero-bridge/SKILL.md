---
name: med-zotero-bridge
description: v1.3 update
---

# med-zotero-bridge

1. Runtime gates:
- Use `pwsh` version `>=7.0.0`; exact pinning like `7.6.1` is not required unless a future task explicitly changes the gate.
- **Platform-aware Zotero startup** (same function, different commands per OS):
  - **Windows**: Agent layer launches Zotero via Desktop Commander MCP tool `mcp__desktop_commander__.start_process` using only fixed command `schtasks /Run /TN StartZoteroForCodex` (or `cmd /c schtasks /Run /TN StartZoteroForCodex` when shell semantics require it). Set `ZOTERO_EXTERNAL_LAUNCHER=desktop_commander`.
  - **macOS**: Do NOT use `schtasks` or `desktop_commander`. Instead, `open -a Zotero` is called automatically by Stage 1 (`startZotero()` in `run_research_os_pipeline.mjs`) and by `ensure_zotero_mcp_ready.mjs` (via `startWithMacOpen`). No extra authorization needed after first manual launch (Gatekeeper).
  - **Linux**: Direct `spawn` of `ZOTERO_EXE` binary.
  - All platforms: `ZOTERO_EXE` env override has highest priority. Default: darwin → `/Applications/Zotero.app/Contents/MacOS/zotero`, win32 → `zotero.exe`, linux → `zotero` (PATH).
- Do not hardcode `execute_command`; current sessions may expose `start_process` only.
- Wait 3000ms after launcher success, then run MCP ready check via `tools/check_zotero_mcp_ready.mjs`.
- MCP URL must be `process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp"`.
- If MCP not ready, Stage2/Stage3 must stop with `MCP_NOT_READY_AFTER_EXTERNAL_LAUNCHER` or `MCP_NOT_READY_WITH_RUNNING_ZOTERO`.
- **Cross-platform principle**: Different OS → different launch/detect commands → same functional gate (MCP `get_collections` probe). Process existence ≠ MCP ready.

2. Literature information IO (MCP only):
- Use `zotero-mcp` for collection lookup/create and item add/move/update.
- Root collection priority: `文献池`, fallback `RSS文献池`.
- Under root, create date `YYYY-MM-DD`; under date create `RSS订阅` and `数据库检索`.
- Under date also create grade collections: `A课题相关`, `B专题相关`, `C领域相关`.
- For each non-D item, add to exactly one source collection (`RSS订阅`/`数据库检索`) and one grade collection (`A课题相关`/`B专题相关`/`C领域相关`).
- Do not place items directly in root or date parent collection.
- Skip writing `D无关` items to Zotero source/grade collections.
- Write translated Chinese title to item field `shortTitle`.
- Tag cleanup must use supported MCP tag interface only (for example `write_tag:set`).
- Duplicate policy (exact normalized dedupe):
  - before any create/add, build/read dedupe indexes for `文献池`, `文献池/待删除`, and `值得精读`.
  - match priority: `DOI > PMID > PMCID > arXiv > exact normalized title`.
  - title normalization must include at least:
    - NFKC normalize
    - HTML/entity cleanup
    - unify hyphen/dash variants
    - unify quotes
    - collapse whitespace and ideographic spaces
    - trim trailing sentence punctuation noise
    - fullwidth alphanumerics to halfwidth
    - NFKD + strip combining marks
    - collapse circled numbers/common unicode fractions when applicable
    - drop zero-width/control characters
  - per candidate:
    - if duplicate in any of `文献池`, `待删除`, `值得精读`: do not create item; do not add to root/date/source/grade collections.
    - record `skipped_duplicate_in_pool`, `skipped_duplicate_in_trash`, `skipped_duplicate_in_worthy` in writeback summary.
    - if not duplicate: create item, add to root pool first, then add to daily source/grade collections.
  - summary counters must include at least:
    - `created`
    - `added_to_pool`
    - `added_to_daily_collection`
    - `skipped_duplicate_in_pool`
    - `skipped_duplicate_in_trash`
    - `skipped_duplicate_in_worthy`

3. Star migration (MCP only):
- Scan previous 7 natural days of system-screened `A课题相关` / `B专题相关` / `C领域相关` items (mode `expand`).
- Determine star level from item tags that contain star symbols (`⭐`), e.g. `⭐⭐⭐⭐` or `⭐⭐⭐⭐⭐`.
- If tag-derived star level >= threshold (default 4), add item to root `值得精读`.
- After add succeeds (or already exists), remove the item from same-day six subcollections:
  `RSS订阅`, `数据库检索`, `A课题相关`, `B专题相关`, `C领域相关`.
- **Also remove the item from root `文献池`** — mandatory to keep root and date subcollections in sync.
- Removal order: date subcollections first, then root pool. If root removal fails, log error and continue.
- Do not delete the item entity itself; only remove collection memberships.
- Audit: stats must include `removed_from_root_pool` counter. Code: `tools/mcp_bulk_writeback.mjs` → `migrateRatedItems`.

4. Scope boundary:
- PDF acquisition is out of automation scope and must not block Stage1 JSON outputs.
- Stage summaries must not treat stale `mcp_writeback_summary.json` or stale `abc_translation_backfill.json` as current-run success artifacts.

5. Forbidden actions:
- Never use local API/business write path for literature metadata or collection mutation.
- Never edit `<zotero-data-dir>/zotero.sqlite` directly.
- Never bypass paywalls, CAPTCHA, or permission controls.
- In external launcher mode (`ZOTERO_EXTERNAL_LAUNCHER=desktop_commander`, Windows-only), never trigger local fallback launch logic (`pwsh`, `tasklist`, `Get-Process`, `powershell.exe Start-Process`, node spawn).
- On macOS, never call Windows-only commands (`schtasks`, `tasklist`, `powershell.exe`, `cmd.exe`, `Start-Process`). Use `open`/`ps` equivalents instead.

6. Feedback item actions (dry-run by default):
- 	ools/zotero_feedback_collection_corrections.mjs provides eadCollections (exported) and CLI-driven correction logic.
- Pipeline imports eadCollections to build correction plans; do not trigger CLI main-flow side effects when importing.
- Default mode is **dry-run**: generate action plan, do not move items.
- Only APPLY_FEEDBACK_ITEM_ACTIONS=true allows real moves.
- Action plan records: source feedback file, item identifier (DOI/PMID/Zotero key/title fallback), title, feedback value, planned action, from_collection, to_collection, reason, status (planned/skipped/executed/failed).
- Items already in target collection must be skipped, not re-moved.
- Items with no matching Zotero entry must be skipped with reason.
- Unknown feedback values must be skipped with unsupported_feedback_value record.
- If Zotero MCP is unavailable, pipeline must not crash; record item action stage as failed/skipped.
- un_report fields: eedback_used_for_item_actions, eedback_item_actions_mode (dry_run/apply), planned_actions_count, xecuted_actions_count, skipped_actions_count, ailed_actions_count, eedback_item_actions_plan_path.
- Real Zotero moves cannot be verified in automated tests; mark as unverified.