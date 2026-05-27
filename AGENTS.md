# Medical Literature Workflow Agent Reference

## General Execution Environment And Permission Boundaries

- Default to completing tasks within the current repository/workspace.
- Recommended sandbox permission is Workspace write.
- Use Read only mode for auditing and planning work.
- Full access is a temporary exception only. Before requesting it, report exact paths, reason, scope of impact, risk, and rollback method, then wait for user approval.
- Keep project files, generated artifacts, temporary files, and test outputs inside the workspace.
- Prefer workspace runtime, project-local configuration, or standard user-level cache directories for Node, dependencies, and caches.
- Do not access, copy, index, or expose unrelated sensitive paths, including SSH private keys, browser data, Desktop, Downloads, personal Documents, or system configuration directories.
- Before network access, dependency installation, Zotero access, external API calls, global configuration changes, or reading/writing files outside workspace, report exact commands, necessity, impact scope, rollback availability, and whether a workspace-local alternative exists, then wait for approval.
- Before each major modification round, run `git status --short`; if the working tree is not clean, report existing changes first.
- Suggest creating a branch before large or high-risk modifications.
- Never reset, checkout, clean, delete, or overwrite existing user changes without explicit permission.
- If `node`/`npm`/`python` or other runtimes are not executable or lack permission, classify as an environment failure, not a business test failure.
- Prioritize diagnosing `PATH` and runtime paths, and prioritize workspace-provided or project-approved runtimes. Do not request Full access only because one path is not executable.

## Goal

Operate a two-day medical literature pipeline with parallel entry channels:

- RSS ingestion
- PubMed/PMC retrieval via `academic-search`

Then run unified dedup, triage, Zotero writeback, translation backfill, and workbook export in the existing Research OS structure.

Cadence defaults:
- Full pipeline interval: every 2 days (`RESEARCH_OS_RUN_INTERVAL_DAYS=2`)
- Force override: `FORCE_RESEARCH_OS_RUN=true` or `RESEARCH_OS_FORCE_RUN=true`
- Report label: `隔日报`
- Synthesis interval: 14 days (`RESEARCH_OS_SYNTHESIS_INTERVAL_DAYS=14`)
- Synthesis label: `双周报`
- If interval not reached and no force flag: skip full stages and emit skip report fields (`skipped_due_to_interval`, `next_eligible_run_at`)

## Capability Delegation and Existing Tool Boundary

- Prefer existing capabilities first. If a capability already exists in plugins, skills, MCP servers, existing adapters, CLI/scripts, library functions, or documented workflow contracts, reuse that capability instead of re-implementing it.
- Do not bypass abstraction layers. When an upper-layer interface already owns a capability, call that interface instead of jumping to lower-level internals.
- Do not duplicate internals of existing tools. If MCP already provides semantic search, do not independently build embedding generation, vector indexing, or vector similarity logic in pipeline business code.
- Before adding new code, determine capability ownership:
  - plugin
  - skill
  - MCP server
  - existing adapter
  - existing CLI/script
  - existing library function
  - documented workflow contract
- If ownership already exists, prefer:
  - thin adapter integration
  - explicit degrade path
  - auditable report fields
  - mock tests
- Only add new implementation when existing capability is unavailable or unverified. In that case:
  - explain why reuse is not possible
  - keep new code as a thin adapter
  - keep degradation + audit signals
  - avoid parallel competing implementations
- If interface name/shape is unknown:
  - do not fabricate APIs or success claims
  - do not bypass to lower-level services
  - degrade safely and report blocked/unverified state
- Rationale:
  - avoid duplicate implementations and config drift
  - avoid inconsistent results from double call chains
  - preserve plugin/MCP caching, indexing, permission and audit boundaries
  - keep module responsibilities clear
  - lower maintenance and debugging costs

## Hard Constraints

- PowerShell gate requires `pwsh >= 7.0.0` (exact pinning like `7.6.1` is not allowed unless explicitly required by a future task).
- Never use Windows PowerShell 5.1.
- Never directly edit `E:\zotero\zotero.sqlite`.
- PubMed/PMC only for database retrieval.
- Do not use Google Scholar/CNKI/IEEE/ACM in this workflow.
- Do not fabricate references, page numbers, doses, stats, or experimental outcomes.
- PDF acquisition is out of automation scope. Users handle PDFs manually in Zotero.
- Title translation secrets must come only from `TITLE_TRANSLATION_API_KEY` in the environment, a local `.env`, or injected automation secret storage.
- Non-secret title translation parameters live in `config/title_translation.config.json`.
- The default translation model lives in `config/title_translation.config.json`, and `TITLE_TRANSLATION_MODEL` can override it.
- The title translation prompt lives in `prompts/title_translation.md` and uses `${sourceText}` substitution.
- Default translation rate limits are RPM `100` and TPM `10,000,000`.
- Never write title translation secrets into config files, prompts, memory, reports, stdout, or stderr.

## Directory Model

- Pipeline state root: `research_os/`
- Pipeline state weekly/day layout: `research_os/<ISO-week>/<yy.M.d>/pipeline`
- Final workbook export root: `<YOUR_PROJECT_ROOT>/research_os/文献评价`
- User-editable RSS sources: `config/rss_sources.json`
- User-editable PubMed/PMC search conditions: `config/pubmed_pmc_search.json`
- User-editable workflow triage/feedback rule config: `config/workflow_rules.json`
- Long-lived screening standard text: `research_os/文献评价/screening_standards.md`
- User-facing manual review root: `research_os/文献评价`
- One-off historical archive root: `research_os/literature_archive`
- Dry-run/apply manifests: `research_os/run_manifests`

Final workbook exports (desktop week folder):
- `双周报.xlsx`

Final workbook exports (day folder):
- `隔日报.xlsx`

Pipeline artifacts kept in `research_os/.../pipeline`:
- `run_report.json`
- `triaged_items.json`
- `triaged_export_items.json`
- `writeback_ready_items.json`
- `mcp_writeback_summary.json`
- `abc_translation_backfill.json`
- other audit/state JSON files

## Skill Composition

Repository automation entrypoint:

- Use `node tools/run_zotero_literature_filter.mjs` as the single repository entrypoint for the full workflow.
- The entrypoint writes `pipeline/orchestrator_report.json` and controls Stage 1 -> MCP readiness -> Stage 2 -> Stage 3 -> Stage 4 ordering in code without spawning Node child processes for stage scripts.
- Do not rely on an agent manually stitching the stage scripts together during normal automation runs.

Internal stage order:

1. `med-stage-orchestrator` (enforce stage order/gates)
2. `med-query-learning`
3. `med-entry-parallel`
4. `med-daily-triage`
5. `med-zotero-bridge` (Stage 2 writeback + Stage 3 translation backfill)
6. `med-weekly-synthesis` (Stage 4 final workbook export only)

## Triage Labels

- `A课题相关`: directly relevant to the current core project question.
- `B专题相关`: clearly relevant to the current subtopic or adjacent topic, but not the core project question.
- `C领域相关`: relevant at the broader field level, with lower short-term priority.
- `D无关`: low relevance; audit only and never written back to Zotero.

## Two-Day Run Checklist

1. Runtime gate:
   - `pwsh` version >= `7.0.0`
   - console encoding == `utf-8`
2. Read previous-cycle feedback:
   - `feedback` non-empty
   - `处理状态 != 已学习`
   - use `标题翻译` as primary article context when interpreting row-level `feedback`; fallback to English title if translation missing
   - `每日反馈` only requires a `feedback` column; `comment` / `备注` is optional legacy context and must not block learning when absent
   - use `research_os/文献评价/screening_standards.md` as the only long-lived preference source
   - rows without explicit feedback are excluded from preference learning
  - previous feedback lookup order: `<YOUR_PROJECT_ROOT>/research_os/文献评价/<week>/<day>/隔日报.xlsx` first
  - legacy fallback order only when primary not found: desktop root then project legacy root
   - accepted feedback column aliases: `feedback`, `Feedback`, `反馈`, `用户反馈`
   - accepted optional comment column aliases: `comment`, `Comment`, `备注`, `评价备注`
   - accepted English title aliases: `英文标题`, `title`, `Title`, `English Title`
   - accepted translation aliases: `标题翻译`, `中文标题`, `translated_title`, `title_translation`
   - `隔日报.xlsx` exports only the user-facing `每日反馈` worksheet; machine audit stays in JSON artifacts
   - every med-query-learning run must execute the long-lived refinement chain:
     - row-level `feedback/title` -> article direction evidence, with optional `comment` as auxiliary context only
     - markdown rationale from `screening_standards.md` -> primary rationale and boundary context
     - evidence -> preference clusters
     - clusters -> screening preference rules
   - evidence, cluster, and rule are separate layers and must remain separately auditable
   - a single feedback row is evidence only; it must not be written directly as a stable screening preference
   - Stage1 must not load any xlsx preference store; long-lived preference context comes from `screening_standards.md` and previous feedback workbooks only
   - every run must preserve evidence traceability (`source_file`, `source_row`, feedback/title context, optional comment, and standards-file source path) and must not discard historical evidence
   - every run must recompute cluster counts/status/confidence:
     - `evidence_count`
     - `positive_evidence_count`
     - `negative_evidence_count`
     - `confidence`
     - `status`
   - allowed cluster/rule status values are:
     - `stable`
     - `tentative`
     - `ambiguous`
     - `needs_more_feedback`
   - a single evidence row may become `tentative` or `needs_more_feedback`, but never `stable`
   - conflicting positive/negative evidence on the same topic family must be represented as `ambiguous`, not silently generalized
   - negative preferences must remain bounded by caveats such as study type, evidence level, or disease context; do not broadly exclude an entire topic without repeated scoped evidence
   - output machine-readable audit file: `pipeline/preference_learning_audit.json`
   - previous-cycle workbook must be read via unified Node/JS reader (`tools/lib/review_workbook_reader.mjs`) shared by formal flow and dry-run/diagnostic flow
   - Python is not the primary path for feedback workbook reading; `python_failed` must not block preference learning
   - `feedback_column_missing` can be reported only after workbook read succeeded and headers were detected
   - when learning is skipped/degraded, record concrete blockers (file missing / workbook unreadable / columns missing / fallback failure / preference write failure), not only a generic degrade word
3. Semantic preference refinement (weak evidence only):
   - Zotero MCP uses Streamable HTTP transport in plugin runtime
   - use confirmed Zotero MCP tools: `semantic_search` and optional `semantic_status`
   - `semantic_search` arguments: `query`, `topK`, optional `minScore`, optional `language` (`zh|en|all`)
   - `semantic_status` has no arguments and is used for service/index readiness audit
   - default MCP Streamable HTTP endpoint example: `http://127.0.0.1:23120/mcp`
   - low-level MCP envelope may vary by runtime; if unverified, degrade+report and do not bypass to lower-level providers
   - embedding provider/model/dimensions are plugin-internal assumptions of Zotero MCP (Ollama, all-minilm, 384)
   - Research OS calls Zotero MCP semantic_search only; it must not call Ollama endpoints directly
   - semantic results are for preference evidence enrichment only
   - semantic results must not expand today's candidate pool
   - semantic neighbors are not pseudo-labeled feedback samples
4. Build PubMed/PMC query pack:
   - read `config/pubmed_pmc_search.json`
   - default `days_back` is `7` when missing or invalid
   - date range must be present in PubMed/PMC request parameters (`datetype`, `mindate`, `maxdate`), not only applied after import
   - positive terms / negative terms / MeSH terms / study type filters may be maintained in the config as the search strategy evolves
5. Parallel retrieval:
   - RSS channel reads `config/rss_sources.json`
   - PubMed/PMC channel reads `config/pubmed_pmc_search.json`
6. Merge + dedup:
   - DOI > PMID/PMCID > URL > normalized title
7. A/B/C/D triage:
   - `隔日报.xlsx` excludes `D无关`
   - `triaged_items.json` and `run_report.json` retain `D无关` for audit
8. Zotero writeback and translation backfill
9. Update weekly and root assets (final xlsx export only after Stage2/Stage3 success)
10. Zotero collection placement:
   - root collection: `文献池`
   - create daily date collection `YYYY-MM-DD`
   - under date collection create `RSS订阅` and `数据库检索`
   - under date collection create `A课题相关`, `B专题相关`, `C领域相关`
   - do not place items directly in root `文献池`
   - do not place items directly in date collection itself
   - dedup policy before writeback:
     - read/build root pool (`文献池`) duplicate index first
     - if duplicate in pool: skip create and skip all add-to-collection operations for current-day routing
     - if not duplicate: add to root pool first, then add to daily source/grade collections
     - record `skipped_duplicate_in_pool` and created/add counters in writeback summary
11. Historical collection modification:
   - forbidden during ordinary Stage 1-4 writeback unless an explicit feedback-correction command is requested
   - explicit correction command: `node tools/zotero_feedback_collection_corrections.mjs`
   - feedback correction must use Zotero MCP only; never access `zotero.sqlite`, move PDFs, delete attachments, or fetch RSS/PubMed/PMC
   - match priority for correction: stable itemKey/ID from local pipeline JSON, then translated title, then English title, then Zotero MCP `search_library` exact English-title fallback
   - if local pipeline records contain duplicate title matches, resolve only when Zotero MCP exact title search returns a single item; otherwise keep conflict/manual review
   - `drop` correction target is `文献池/待删除`: add the item there, then remove it from the original day grade collection; do not delete the Zotero item automatically unless a separate explicit delete mode is requested and verified
   - `keep` is no-op; `upgrade`/`downgrade` add to target grade collection and remove from original grade collection
   - all correction runs must emit `research_os/run_manifests` JSON/CSV audit files with status counts and safety flags

## Biweekly Review Checklist

1. Verify trend quality in `双周报.xlsx`
2. Verify machine audit JSON for unresolved items, contradiction evidence, and preference drift when needed

## One-off Historical Feedback Archive

- Use `node tools/archive_history_by_feedback.mjs` for one-off historical feedback archive dry-runs.
- The command must not be part of the default scheduled/manual literature workflow.
- Default mode is dry-run and writes `research_os/run_manifests/historical_feedback_archive_dry_run.json`.
- Actual archive materialization requires explicit `--apply`.
- The archive command reads existing local pipeline JSON and review workbooks only; it must not fetch RSS/PubMed/PMC, write Zotero, start Zotero/Ollama, access `zotero.sqlite`, delete files, or overwrite existing targets.

## Fallback Policy

- If PubMed/PMC retrieval fails: continue with RSS and log the failure.
- If Zotero connector is unavailable: continue Excel outputs, skip writeback, and log reason.
- If translation fails for some ABC items: keep the English title for export, log failures, and continue.
- If previous-day title translation is missing for some feedback rows: fallback to English title and mark uncertainty in preference-learning summary (do not over-generalize).
- If Zotero MCP semantic search is unavailable/timeout/invalid: degrade to title+feedback+comment learning only; do not fail pipeline.
- Negative feedback must be learned as conditional exclusion hints first; do not broadly reject an entire topic without repeated evidence.

## Global XLSX Export Policy

- For all Research OS `.xlsx` outputs, default export path is `spreadsheets_skill` via the Codex `Spreadsheets` skill (or a unified spreadsheet adapter that calls the same runtime capability).
- Scope is limited to final user-facing workbooks: `隔日报.xlsx` and `双周报.xlsx`.
- Export fallback order is fixed and auditable:
  1. `spreadsheets_skill`
  2. `node_fallback`
  3. `python_spawn_legacy`
  4. `manual_required`
- `python_spawn_legacy` is compatibility fallback only and must not be the default or sole export path.
- Every export must record method and outcome in `run_report.json` (or equivalent audit JSON): `export_method`, `export_skill`, `output_path`, `input_files`, `generated_at`, `fallback_chain`, and error/degrade fields when applicable.
- If the `Spreadsheets` skill is not callable in the current execution context, report the unavailability reason and degrade using the fallback chain. Never claim `Spreadsheets` usage when it was not used.
- `Spreadsheets` is responsible for workbook generation only; it does not perform triage, Zotero writeback, metadata backfill, semantic learning/search, preference updates, 7-day migration, or candidate ranking.
- XLSX export root remains: `<YOUR_PROJECT_ROOT>/research_os/文献评价`.

## Feedback Learning Audit Baseline

- `med-query-learning` must emit explicit audit fields for previous-day feedback lookup, column detection, sample counts, and preference execution outcome.
- The long-lived preference source is `screening_standards.md`, not xlsx stores or secondary markdown files.
- Every run must read `<YOUR_PROJECT_ROOT>/research_os/文献评价/screening_standards.md` as the only long-lived screening-standard source.
- If `screening_standards.md` is missing, initialize it with the Chinese baseline standard and continue.
- Before using the standards file, normalize previous display markup: red additions become plain text; blue strikethrough deletions are removed.
- Daily standard changes are written back to clean `screening_standards.md`; `screening_standards.docx` is regenerated as the human revision display, with current additions in red and current deletions in blue strikethrough.
- Every `隔日报.xlsx` export must include only the user-facing `每日反馈` sheet.
- Detailed audit fields must stay in `preference_learning_audit.json` and `run_report.json`, not in `隔日报.xlsx`.
- Missing `当前筛选标准摘要` is expected for new exports and must not block preference learning.
- Users can train the system through two feedback channels:
  - article-level `feedback` as direction only (`keep` / `upgrade` / `drop` / `downgrade`); `comment` is optional auxiliary context
  - standards-file text in `screening_standards.md` as the primary rationale source for preference boundaries
- Standards-file feedback must remain conservative: row feedback updates evidence/clusters, while standards-file changes document and constrain the evolving rules.
- Legacy `当前筛选标准摘要` / `我的评价` and English summary feedback columns may be read only as backward-compatible fallback when old workbooks contain them.
- Allowed cluster corrections from standards feedback include reinforce, weaken, split-suggested, mark ambiguous, retire, narrow scope, broaden scope, add caveat, and needs-more-feedback.
- Preference audit JSON must preserve cluster-level rules, evidence details, and ambiguous clusters that should not strongly affect triage.
- Every med-query-learning run must use `screening_standards.md` rationale plus current feedback evidence; it must not depend on xlsx preference stores.
- Every med-query-learning run must emit cluster-level audit signals in addition to row-level evidence signals.
- Minimum required fields include:
  - `previous_feedback_lookup_paths`
  - `selected_previous_feedback_file`
  - `previous_feedback_file_found`
  - `previous_feedback_headers`
  - `feedback_column_detected`
  - `comment_column_detected`
  - `title_columns_detected`
  - `rows_with_feedback`
  - `rows_with_comment`
  - `feedback_samples_used`
  - `feedback_samples_ignored`
  - `positive_feedback_samples`
  - `negative_feedback_samples`
  - `ambiguous_feedback_samples`
  - `evidence_total`
  - `evidence_positive`
  - `evidence_negative`
  - `evidence_ambiguous`
  - `evidence_ignored`
  - `new_evidence_count`
  - `historical_evidence_count`
  - `clusters_total`
  - `clusters_existing_matched`
  - `clusters_created`
  - `clusters_updated`
  - `clusters_stable`
  - `clusters_tentative`
  - `clusters_ambiguous`
  - `clusters_needing_more_feedback`
  - `clustering_executed`
  - `clustering_warning`
  - `evidence_to_cluster_map_available`
  - `preference_learning_executed`
  - `preferences_added`
  - `preferences_updated`
  - `preferences_reinforced`
  - `preferences_marked_ambiguous`
  - `preferences_needing_more_feedback`
  - `screening_standards_path`
  - `screening_standards_loaded`
  - `screening_standards_cleaned`
  - `screening_standards_primary_rationale_source`
  - `screening_standards_change_markup_applied`
  - `screening_standards_additions_count`
  - `screening_standards_deletions_count`
  - `signals.previous_feedback_missing`
  - `signals.feedback_columns_missing`
  - `signals.no_feedback_rows`
  - `signals.preference_not_updated`
  - `signals.score_delta_unavailable`
  - `preference_learning_audit_path`
  - `preference_learning_summary_exported`
  - `preference_learning_sheets_exported`

## Pwsh Gate Audit Rule

- Gate minimum is `7.0.0`.
- `7.0.0`, `7.4.x`, `7.6.2`, `7.7.x`, `8.x`, and future major versions `>=7` are acceptable.
- `5.1`, `6.x`, and all versions with major `<7` fail the minimum gate.
- Unknown version output must be audited (`pwsh_version_unknown=true`, raw output captured) and must not be treated as automatic hard failure by itself.

## MCP Preflight Contract

- Before any four-stage Zotero workflow run, the Agent layer must first trigger Zotero GUI startup through Desktop Commander MCP using the currently exposed tool `mcp__desktop_commander__.start_process` with fixed command `schtasks /Run /TN StartZoteroForCodexOnly` (or `cmd /c schtasks /Run /TN StartZoteroForCodexOnly` when needed by tool shell semantics), wait 3000ms, then probe Zotero MCP readiness.
- Cron/local automation fallback: if a standalone scheduled automation does not expose Desktop Commander, it may run only the same fixed command `schtasks /Run /TN StartZoteroForCodexOnly` via local shell, then must still set `ZOTERO_EXTERNAL_LAUNCHER=desktop_commander` so Stage2/Stage3 helpers remain readiness-only.
- Do not hardcode arbitrary `execute_command` launch paths for this workflow because tool exposure can differ by session.
- Do not pass arbitrary user-provided command strings to Desktop Commander for Zotero startup; only the fixed scheduled-task command is allowed.
- Desktop Commander MCP and Zotero MCP are different layers:
  - Desktop Commander MCP: external launcher channel used only for the fixed scheduled-task command above.
  - Zotero MCP: post-start metadata read/write channel.
- If Desktop Commander is unavailable or the post-launch Zotero MCP probe is not ready, Stage 2 and Stage 3 must not run and must not be reported as successful.
- Stage outputs must not treat stale `mcp_writeback_summary.json` or stale `abc_translation_backfill.json` as current-run artifacts.
- All MCP-facing scripts must call the shared helper `tools/lib/ensure_zotero_mcp_ready.mjs` before the first MCP request.
- MCP scripts must not bypass the helper with direct MCP calls.
- Preflight helper responsibility is MCP readiness verification and local fallback diagnostics. It must not claim direct control of the Agent-session Desktop Commander MCP tool unless a real MCP client bridge is implemented.
- Helper preflight keeps: process detection, bounded MCP readiness retries, and local fallback launch diagnostics when Zotero process appears absent.
- Default Zotero executable path is `D:/Zotero/zotero.exe`; `ZOTERO_EXE` may temporarily override it.
- If executable resolution fails, scripts must stop before MCP access and report `ZOTERO_EXE` guidance.
- If preflight fails, scripts must mark stage failure in `run_report.json` and must not claim writeback/backfill success.
- MCP readiness probe URL must be `process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp"` and use JSON-RPC `get_collections` probe before Stage 2/3.
- Agent/automation startup order is mandatory:
  1. Agent tool `mcp__desktop_commander__.start_process` runs `schtasks /Run /TN StartZoteroForCodexOnly` (or `cmd /c ...` only if tool shell semantics require it).
     - In standalone cron/local automation only, if Desktop Commander is not exposed, run the exact same `schtasks /Run /TN StartZoteroForCodexOnly` command via local shell.
  2. Wait 3000ms.
  3. Set `ZOTERO_EXTERNAL_LAUNCHER=desktop_commander`.
  4. Run `node tools/run_zotero_literature_filter.mjs`.
- `tools/run_zotero_literature_filter.mjs` performs Stage 1 first without requiring Zotero MCP readiness, then runs the MCP readiness check before Stage 2.
- Only when MCP readiness passes may Stage 2/Stage 3 run; if not ready, the orchestrator skips Stage 2/Stage 3 and marks upstream failure for Stage 4.
- Stage2/Stage3 preflight in `ZOTERO_EXTERNAL_LAUNCHER=desktop_commander` mode must be readiness-only; it must not attempt local `pwsh`, `tasklist`, `Get-Process`, `Start-Process`, or Node spawn fallback.
- For every run summary, report:
  - Desktop Commander tool name
  - startup command
  - exitCode
  - stdout/stderr summary
  - MCP ready check result
- If MCP is not ready after external launcher handoff:
  - Stage2/Stage3 must stop with `MCP_NOT_READY_AFTER_EXTERNAL_LAUNCHER`
  - no writeback/backfill success claim is allowed
  - stale `mcp_writeback_summary.json` and `abc_translation_backfill.json` must not be treated as current-run success artifacts.
