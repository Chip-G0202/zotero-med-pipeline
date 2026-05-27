# `med-*` Skills to Automation Mapping

This workflow is script-first. The scripts implement the same operational contract as the `med-*` skills referenced by [`<YOUR_PROJECT_ROOT>/AGENTS.md`](<YOUR_PROJECT_ROOT>/AGENTS.md).

## Matrix

| Skill | Current implementation path | Expected evidence |
| --- | --- | --- |
| `med-query-learning` | [`run_research_os_pipeline.mjs`](<YOUR_PROJECT_ROOT>/tools/run_research_os_pipeline.mjs) uses unified Node/JS workbook reader [`review_workbook_reader.mjs`](<YOUR_PROJECT_ROOT>/tools/lib/review_workbook_reader.mjs) to read previous-cycle feedback from `<YOUR_PROJECT_ROOT>/research_os/文献评价` first (隔日报 preferred, `daily_review.xlsx` compatibility retained), with desktop/project roots as legacy fallback only. Dry-run/diagnostic path and formal Stage1 path must share this same reader. `feedback_column_missing` is valid only after successful workbook+header read and only when the `feedback` column is absent; `comment` / `备注` is optional legacy context. Preference refinement is now a persistent three-layer flow: A) row-level evidence from `feedback/title` plus optional comment, B) primary rationale from `screening_standards.md`, C) evidence clustering and stabilization against the existing `screening_preferences.xlsx` store, then cluster-level screening preference rules. Each run reads, normalizes, and may write `screening_standards.md`; legacy `当前筛选标准摘要` feedback is fallback only. Optional Zotero MCP `semantic_search` remains weak evidence enrichment only and must not bypass clustering. | `pipeline/run_report.json`, `pipeline/semantic_preference_refinement.json`, and `pipeline/preference_learning_audit.json` contain selected previous-feedback file, workbook read method, detected headers, column detection, sample counts, evidence-to-cluster mapping, cluster counts/statuses, blockers classification (`workbook_unreadable` vs `required_feedback_columns_missing`), semantic degrade status, `primary_rationale_source`, `screening_standards_path`, standard-file read/write markers, and cluster-level preference changes. |
| `med-entry-parallel` | [`run_research_os_pipeline.mjs`](<YOUR_PROJECT_ROOT>/tools/run_research_os_pipeline.mjs) fetches RSS and PubMed/PMC in parallel and deduplicates by DOI/PMID/PMCID/title/URL priority. RSS sources are user-editable in [`config/rss_sources.json`](<YOUR_PROJECT_ROOT>/config/rss_sources.json). PubMed/PMC database conditions are user-editable in [`config/pubmed_pmc_search.json`](<YOUR_PROJECT_ROOT>/config/pubmed_pmc_search.json), whose default `days_back` is 7 and must become NCBI `mindate/maxdate` request parameters. | `steps.med_entry_parallel`, `rss_items.json`, `db_items.json`, `merged_items.json`, config path/date-window audit fields. |
| `med-daily-triage` | Stage 1 in [`run_research_os_pipeline.mjs`](<YOUR_PROJECT_ROOT>/tools/run_research_os_pipeline.mjs) classifies items into `A课题相关` / `B专题相关` / `C领域相关` / `D无关`, keeps D only in audit outputs, and emits non-D `writeback_ready_items.json`. Triage labels, keyword groups, weights, thresholds, journal whitelist, and grade reasons are user-editable in [`config/workflow_rules.json`](<YOUR_PROJECT_ROOT>/config/workflow_rules.json). | `triaged_items.json`, `triaged_export_items.json`, `writeback_ready_items.json`, `steps.med_daily_triage`, `run_report.json`. |
| `med-stage-orchestrator` | Contract skill at [`<YOUR_CODEX_HOME>/skills/med-stage-orchestrator/SKILL.md`](<YOUR_CODEX_HOME>/skills/med-stage-orchestrator/SKILL.md) is enforced by [`run_zotero_literature_filter.mjs`](<YOUR_PROJECT_ROOT>/tools/run_zotero_literature_filter.mjs), which runs Stage1→MCP ready→Stage2→Stage3→Stage4 in one Node process and gates Stage4 on Stage2/3 success + fresh artifacts. | Stage ordering and gate results in `orchestrator_report.json` and `run_report.json`; downgrade/skip reasons recorded when gates fail. |
| `med-weekly-synthesis` | Stage 4 in [`finalize_research_os_exports.mjs`](<YOUR_PROJECT_ROOT>/tools/finalize_research_os_exports.mjs) uses a unified spreadsheet adapter with `spreadsheets_skill` as first choice for `.xlsx` export; fallback order is `node_fallback -> python_spawn_legacy -> manual_required`. User-visible outputs are now `隔日报.xlsx` (two-day cadence) and `双周报.xlsx` (14-day cadence), rooted at `<YOUR_PROJECT_ROOT>/research_os/文献评价`. | `steps.med_weekly_synthesis`, `steps.stage4_export_audit` in `run_report.json` including `export_root`, `requested_output_path`, `actual_output_path`, `desktop_export_disabled`, `export_method`, `export_skill`, and fallback/degrade details. |
| `med-zotero-bridge` | Stage 2 in [`mcp_bulk_writeback.mjs`](<YOUR_PROJECT_ROOT>/tools/mcp_bulk_writeback.mjs) performs MCP-only collection/item mutation, skips `D无关`, requires a unique exact-name pool collection `文献池`, and enforces pool admission dedupe first (duplicate in pool => fully skip create/pool add/current-date add/backfill/export). Dedup uses exact normalized DOI/PMID/PMCID/arXiv/title only; no semantic/LLM/fuzzy dedupe. Feedback-driven historical correction is handled only by the explicit command [`zotero_feedback_collection_corrections.mjs`](<YOUR_PROJECT_ROOT>/tools/zotero_feedback_collection_corrections.mjs): stable IDs first, translated title, English title, then Zotero MCP exact English-title fallback; duplicate local title matches may be resolved only when Zotero MCP returns exactly one item. `drop` moves items to `文献池/待删除` for manual deletion, while `upgrade/downgrade` moves between day grade collections. Stage 3 translates/backfills only `writeback_items` emitted by Stage 2. | `mcp_writeback_summary.json` contains pool dedupe counters/index counts/duplicate records and writeback-only items for stage3; `abc_translation_backfill.json` records shortTitle backfill for admitted non-duplicate items only. Feedback correction evidence is in `research_os/run_manifests/zotero_feedback_collection_corrections_*.json/csv`. |

## Runtime rule

- `<YOUR_PROJECT_ROOT>/AGENTS.md` is the workflow contract.
- Capability delegation rule applies globally: prefer plugin/skill/MCP/existing adapter/script/library capability over duplicated lower-level implementation.
- The automation prompt must explicitly read `<YOUR_PROJECT_ROOT>/AGENTS.md` before execution.
- The automation prompt must explicitly name the four runtime stages in order.
- Before the single entrypoint, Agent layer must launch Zotero via Desktop Commander MCP tool `mcp__desktop_commander__.start_process` with fixed command `schtasks /Run /TN StartZoteroForCodexOnly`, wait 3000ms, set `ZOTERO_EXTERNAL_LAUNCHER=desktop_commander`, then run only `node tools/run_zotero_literature_filter.mjs`.
- Standalone cron/local automation may use a local-shell fallback only when Desktop Commander is not exposed, and only for the exact same fixed `schtasks /Run /TN StartZoteroForCodexOnly` command. It must still set `ZOTERO_EXTERNAL_LAUNCHER=desktop_commander` so Stage2/Stage3 remain readiness-only.
- In `desktop_commander` external-launcher mode, Stage2/Stage3 helper performs MCP readiness check only and must not execute local fallback launch paths.
- PDF acquisition is outside automation scope and must not appear as a stage or queue in workflow outputs.
- The scripts remain the stable execution layer for data fetch, ABC writeback, ABC `shortTitle` backfill, and final workbook export.
- Daily review export constraints remain enforced: keep `英文标题` and `标题翻译`; do not restore removed columns `日期/推荐理由/命中信号/Zotero条目Key/写回状态`; exclude `D无关`.
- Daily review workbook now includes only the user-facing `每日反馈` sheet.
- `screening_standards.md` at `<YOUR_PROJECT_ROOT>/research_os/文献评价/screening_standards.md` is the user entry point and primary rationale source for screening standards.
- Each run normalizes prior display markup before learning: red additions become plain text, and blue strikethrough deletions are removed.
- New standard additions are written in bright red; removed standards are written in blue with strikethrough until the next normalization pass.
- Legacy `当前筛选标准摘要`, `我的评价`, and English summary columns are read only as backward-compatible fallback and must not appear in newly exported `隔日报.xlsx`.
- `screening_preferences.xlsx` is the long-lived cluster store and must be maintained as cluster-level state, not rewritten as one-row-per-feedback output.
- Required workbook layers for `screening_preferences.xlsx`:
  - `Screening Preferences`: cluster-level rules used for triage
  - `Evidence Detail`: row-level evidence with source traceability
  - `Meta Preference Evidence`: summary-level feedback converted into structured correction signals
  - `Ambiguous Needs More Feedback`: clusters that should not strongly affect triage
- Each preference-learning run must merge new evidence into existing clusters when possible, create new clusters only when matching fails, and then re-evaluate `stable` / `tentative` / `ambiguous` / `needs_more_feedback`.
- Each preference-learning run must use `screening_standards.md` as the primary standard context, and may conservatively map legacy summary feedback when available:
  - `accurate` -> reinforce reflected active clusters
  - `too_broad` -> narrow scope / add caveat / lower confidence
  - `too_narrow` -> broaden only with supporting evidence, else needs-more-feedback
  - `wrong_focus` -> weaken or mark ambiguous
  - `missing_priority` -> candidate signal only, not direct active rule
  - `over_excluding` -> weaken negative clusters or add caveat
  - `under_excluding` -> reinforce negative boundary only when evidence support exists
  - `needs_more_clinical_focus` -> reinforce clinical-outcome clusters and weaken mechanism-heavy emphasis
- When summary feedback cannot be mapped to a specific cluster, it must be recorded as `global_meta_feedback` in audit/store and must not silently modify all clusters.
- When article-level evidence and summary-level feedback conflict, the result must remain auditable via weakened confidence, `ambiguous`, `needs_more_feedback`, or `retired` transitions rather than silent overwrite.
- `preference_learning_audit.json` must report evidence totals, historical evidence totals, cluster totals, cluster changes, and `evidence_to_cluster_map`.
- Standard changes must be auditable through `preference_learning_audit.json` and the marked-up `screening_standards.md`, not additional daily workbook sheets.
- Triage impact remains auditable only; if there is no baseline `score_before` / `score_after`, the export must keep `impact_unknown` / `score_delta_unavailable` instead of fabricating scores.
- Stage 4 repair/export must not rerun Stage 1-3 and must not trigger any Zotero write operation.
- Semantic preference refinement boundary:
  - Research OS calls Zotero MCP `semantic_search` and optional `semantic_status`.
  - confirmed tool names from upstream README: `semantic_search`, `find_similar`, `semantic_status` (current workflow uses first and third only).
  - `semantic_search` args: `query`, `topK`, optional `minScore`, optional `language` (`zh|en|all`).
  - `semantic_status` args: none.
  - `find_similar` is intentionally not used in this workflow unless future itemKey-based requirement is added.
  - Research OS does not call Ollama embedding endpoints directly.
- Semantic neighbors are weak context evidence for preference refinement only, not candidate expansion or pseudo-labeled feedback.
- Pwsh gate is minimum-version based (`>= 7.0.0`), not exact pinning; `7.6.2` and future major versions `>=7` pass. Unknown version is audited but not automatic hard fail.

## User-facing directory map

- Manual review files live under `research_os/文献评价`: `隔日报.xlsx`, `run_log.xlsx`, `双周报.xlsx`, `review_queue.xlsx`, `contradiction_log.xlsx`, `screening_standards.md`, and `screening_preferences.xlsx`.
- User-editable source/search/rule configuration lives under `config/`: `rss_sources.json`, `pubmed_pmc_search.json`, `workflow_rules.json`, and `title_translation.config.json`.
- Machine pipeline artifacts live under `research_os/<ISO-week>/<yy.M.d>/pipeline`.
- One-off historical feedback archive manifests live under `research_os/run_manifests`; archive materialization lives under `research_os/literature_archive`.
- The one-off archive command is `node tools/archive_history_by_feedback.mjs`; it defaults to dry-run and is not part of scheduled/manual default automation. Actual archive record writing requires `--apply`.

