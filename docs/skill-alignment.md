# `med-*` Skills to Automation Mapping

This workflow is script-first. The scripts implement the operational contract; skills are the alignment layer for Codex and maintenance.

## Matrix

| Skill | Current implementation path | Expected evidence |
| --- | --- | --- |
| `med-query-learning` | `workflow/tools/stage1/main.mjs` reads previous-cycle feedback with `workflow/tools/lib/review_workbook_reader.mjs`, then refines preferences via `workflow/tools/stage1/preference_refinement.mjs` using `screening_standards.md` as the long-lived rationale source and `screening_standards.docx` as the human display layer. The current runtime path writes `runs/preference_learning_audit.json` and `runs/semantic_preference_refinement.json`; `screening_preferences.xlsx` is not the primary runtime store in the current flow. | `runs/run_report.json`, `runs/preference_learning_audit.json`, `runs/semantic_preference_refinement.json`, `screening_standards.md`, `screening_standards.docx` sync markers. |
| `med-entry-parallel` | `workflow/tools/stage1/main.mjs` fetches RSS and PubMed/PMC in parallel and deduplicates by DOI/PMID/PMCID/URL/normalized-title priority. PubMed/PMC retrieval uses direct NCBI requests driven by `config/pubmed_pmc_search.json`; RSS comes from `config/rss_sources.json`. | `steps.med_entry_parallel`, `rss_items.json`, `db_items.json`, `merged_items.json`, config path/date-window audit fields. |
| `med-daily-triage` | Stage 1 in `workflow/tools/stage1/main.mjs` classifies items into `A课题相关` / `B专题相关` / `C领域相关` / `D无关`, keeps D only in audit outputs, and emits non-D `writeback_ready_items.json`. `workflow/tools/stage4/spreadsheet_adapter.mjs` writes the weekly workbook with `每日反馈` and `需人工复核`. | `triaged_items.json`, `triaged_export_items.json`, `writeback_ready_items.json`, `steps.med_daily_triage`, `run_report.json`. |
| `med-stage-orchestrator` | Path Skills call fixed launchers, which call the shared Runner for preflight and current-run validation. Desktop/Web then use `workflow/tools/stage0/main.mjs` for Stage1 → Zotero backend ready → Stage2 → Stage3 → Stage4 → Stage5; Local uses its own entry without Stage2/Stage3. | preflight result, `orchestrator_report.json`, run summary, `run_group.json`, Stage5 state, housekeeping and cleanup fields. |
| `med-monthly-synthesis` | `workflow/tools/stage4/main.mjs` uses the spreadsheet adapter first (`codex_spreadsheet`), then `node_fallback`, then `python_spawn_legacy`, then `manual_required`. It exports weekly `周报.xlsx` and monthly `月报-*.docx` rooted at `review_results/文献评价`. | `steps.med_monthly_synthesis`, `steps.stage4_export_audit` in `run_report.json` including `export_root`, `requested_output_path`, `actual_output_path`, `export_method`, `export_skill`, `export_provider`, `spreadsheets_plugin_available`, and fallback/degrade details. |
| `med-zotero-bridge` | `workflow/tools/stage2/main.mjs` performs Zotero-backend collection/item mutation, skips `D无关`, auto-creates managed collections when missing, enforces allowed collection scope, and deduplicates before writeback. `workflow/tools/stage3/main.mjs` only backfills admitted items or allowed recent scan candidates. | `zotero_writeback_summary.json`, `abc_translation_backfill.json`, `collection_scope_*` audit fields, `feedback_item_actions_plan.json`, `review_results/run_manifests/zotero_feedback_collection_corrections_*.json/csv`. |

## Runtime rule

- `AGENTS.md` is the workflow contract.
- Capability delegation still applies globally: prefer plugin/skill/MCP/existing adapter/script/library capability over duplicated lower-level implementation.
- The automation prompt must explicitly read `AGENTS.md` before execution.
- The automation prompt must select exactly one path Skill/launcher and name that path's current Stage1-Stage5 contract.
- Interactive execution must use the fixed launcher and shared Runner; it must not pre-launch Zotero or invoke Stage0 directly.
- Stage0 owns Desktop/Web orchestration after Runner preflight: interval gate, startup, Stage1, backend readiness, Stage2, Stage3, Stage4, and Stage5. Local owns its separate Stage1/translation/state/Stage4/Stage5 flow.
- Startup success is functional: Zotero backend `get_collections` succeeds. LLM-only review has no separate local semantic-service preflight.
- The scripts remain the stable execution layer for data fetch, ABC writeback, ABC `shortTitle` backfill, and final workbook export.
- Stage 1 default-enabled feedback item actions must report `feedback_item_actions_default_enabled=true`.
- Daily review export constraints remain enforced: keep `英文标题` and `标题翻译`; do not restore removed columns `日期/推荐理由/命中信号/Zotero条目Key/写回状态`; exclude `D无关`.
- `screening_standards.md` is the user entry point and primary rationale source for screening standards.
- Daily review workbook contains the mutually exclusive user-facing `每日反馈` and `需人工复核` sheets.
- Preference refinement and title review are LLM-only: `runLlmPreferenceLearning`, `reviewGradesWithLlm`, and `buildLlmRuleContextSummary` are the formal path. No formal `semantic_search` / `semantic_status` runtime path remains.

## User-facing directory map

- Manual review files live under `review_results/文献评价`: `周报.xlsx`, `月报-*.docx`, `screening_standards.md`, `screening_standards.docx`, and `standards_rule_suggestions_log.json`.
- User-editable source/search/rule configuration lives under `config/`: `rss_sources.json`, `pubmed_pmc_search.json`, `review-workflow-rules.json`, and `title_translation.config.json`.
- Machine pipeline artifacts live under `review_results/pipeline/<yy.M.d>`.
- One-off historical feedback archive manifests live under `review_results/run_manifests`; archive materialization lives under `review_results/literature_archive`.
- The one-off archive command is `node workflow/tools/maintenance/archive_history_by_feedback.mjs`; it defaults to dry-run and is not part of scheduled/manual default automation. Actual archive record writing requires `--apply`.
