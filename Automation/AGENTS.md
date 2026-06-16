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
- OpenAlex retrieval (when `databases` includes `"openalex"`)

Then run unified dedup, triage, Zotero writeback, translation backfill, and workbook export in the existing Research OS structure.

Cadence defaults:
- Full pipeline interval: every 2 days (`RESEARCH_OS_RUN_INTERVAL_DAYS=2`)
- Force override: `FORCE_RESEARCH_OS_RUN=true` or `RESEARCH_OS_FORCE_RUN=true`
- Report label: `隔日报`
- Synthesis interval: month-end synthesis on the last due run of each month
- Synthesis label: `月报`
- If interval not reached and no force flag: skip full stages and emit skip report fields (`skipped_due_to_interval`, `next_eligible_run_at`)
- Interval gate uses `Asia/Shanghai` 15:00 planned slot semantics; the 48h comparison is based on planned slots, not actual start/end/Stage4 times.

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

## Git Version Control Rules

- **Commit 习惯**：完成有意义的变更后，主动建议用户 commit。
- **Commit 前检查**：先运行 `git status --short` 确认变更范围。
- **Commit message 规范**：简洁说明改了什么，例如："新增跨平台支持"、"修复标题规范化"。
- **不要自动 commit**：除非用户明确要求，否则不要自动执行 `git commit`。
- **大变更分批 commit**：如果改动涉及多个独立功能，建议分多次 commit。
- **Commit 后确认**：执行 commit 后，运行 `git log --oneline -1` 确认成功。

## Reproducibility baseline (added)

- Required runtime: **Node.js >= 18.0.0** and **PowerShell 7 (pwsh) >= 7.0.0**.
- This repository has committed `package.json` and `package-lock.json`; run `npm install` in a fresh environment before workflow execution.
- Local commands run directly with the Node binary, for example `node tools/run_zotero_literature_filter.mjs` or `node --test tests/*.test.mjs`.
- If local tests are runnable, the narrow default verification command is `node --test tests/*.test.mjs`.
- Reproducibility currently depends on the documented runtime versions, committed npm metadata, `.env.example`, and local Node-built-in test execution.

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
- Title translation non-stream request bodies currently use `max_tokens`; if a real provider/model/key is not configured in the active environment, verification must stay mock/local, and end-to-end success must not be claimed.
- Never write title translation secrets into config files, prompts, memory, reports, stdout, or stderr.

## Directory Model

- Pipeline state root: `research_os/`
- Pipeline state month/day layout: `research_os/<yy.MM>/<MM.dd>/pipeline`
- Final workbook export root: `<YOUR_PROJECT_ROOT>/research_os/文献评价`
- User-editable RSS sources: `config/rss_sources.json`
- User-editable PubMed/PMC search conditions: `config/pubmed_pmc_search.json`
- User-editable workflow triage/feedback rule config: `config/workflow_rules.json`
- Long-lived screening standard text: `research_os/文献评价/screening_standards.md`
- User-facing manual review root: `research_os/文献评价`
- One-off historical archive root: `research_os/literature_archive`
- Dry-run/apply manifests: `research_os/run_manifests`

Final workbook exports (desktop month folder):
- `月报-*.docx`

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

- Use `node --env-file=.env tools/run_zotero_literature_filter.mjs` as the single repository entrypoint for the full workflow.
- The entrypoint writes `pipeline/orchestrator_report.json` and controls Stage 1 -> MCP readiness -> Stage 2 -> Stage 3 -> Stage 4 ordering in code without spawning Node child processes for stage scripts.
- Do not rely on an agent manually stitching the stage scripts together during normal automation runs.

Internal stage order:

1. `med-stage-orchestrator` (enforce stage order/gates)
2. `med-query-learning`
3. `med-entry-parallel`
4. `med-daily-triage`
5. `med-zotero-bridge` (Stage 2 writeback + Stage 3 translation backfill)
6. `med-monthly-synthesis` (Stage 4 final workbook export only)

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
   - **隔日报数据源规则**：`desktop_daily_review_source.json` 必须只包含当天 Stage2 实际写入 Zotero 的条目（来自 `mcp_writeback_summary.writeback_items`），不得包含文献池去重跳过的重复条目。Stage1 全量 ABC 是候选池，不是隔日报数据源。
     - Stage 2 完成后，orchestrator 用 writeback itemKey 过滤 desktop source
     - Stage 2 失败/skip 时，desktop source 保持原始全量（保证有输出）
   - **隔日报两 sheet 互不重叠**：
     - "需人工复核"：仅 `needs_human_review=true` 的条目
     - "每日反馈"：当天写入的剩余 ABC 条目（排除已进入复核的）
     - 两个 sheet 合计 = 当天实际写入 Zotero 的全部 ABC 条目
   - 翻译补翻（pool scan）只静默补翻译，不混入隔日报数据源
   - `隔日报.xlsx` "每日反馈" sheet uses three grade columns: 规则等级, 语义等级, 最终等级
     - 规则等级: rule system initial grade
     - 语义等级: semantic review suggested grade
     - 最终等级: system-adopted final grade
     - All three columns output only grade letters (A/B/C/D), no explanatory text like "C领域相关"
   - `隔日报.xlsx` "需人工复核" sheet only contains items where `needs_human_review=true` (e.g. C→D blocked by policy)
     - Auto-adopted adjustments (B→A, C→B, B→C) are visible in 每日反馈 via 规则等级/语义等级/最终等级 columns but do NOT enter 人工复核
     - Users fill "人工确认等级" column; rule/semantic grades are read-only evidence
     - Only one review sheet; no separate "语义捞回" or "语义降权提醒" sheets
   - `隔日报.xlsx` "反馈" column (renamed from `feedback`) and "评价" column (renamed from `comment`)
   - Removed columns: 来源等级, 已处理时间, 处理状态, 备注
   - "期刊/来源" column should be cleaned to pure journal name (remove RSS/feed/platform suffixes)
8. Zotero writeback and translation backfill
   - Pool scan runs by default every 4 days (`ZOTERO_TRANSLATION_POOL_SCAN_INTERVAL_DAYS=4`), i.e. every two 2-day automation runs
   - Pool scan window defaults to 4 days (`ZOTERO_TRANSLATION_POOL_SCAN_WINDOW_DAYS=4`)
   - Legacy items in 文献池 are not re-scanned; only recent date subcollections are checked for missing shortTitle
   - Pool scan limit defaults to 50 candidates (`ZOTERO_TRANSLATION_POOL_SCAN_LIMIT`)
   - `write_metadata` for title backfill is allowed only for Stage 2 admitted items or recent allowed-pool-scan candidates
9. Update weekly and root assets (final xlsx export only after Stage2/Stage3 success)
10. Zotero collection placement:
   - root collection: `文献池`
   - create daily date collection `YYYY-MM-DD`
   - under date collection create `RSS订阅` and `数据库检索`
   - under date collection create `A课题相关`, `B专题相关`, `C领域相关`
   - every newly admitted item is added to root `文献池` first, then to exactly one daily source collection and one daily grade collection
   - do not leave items only in root `文献池`
   - do not place items directly in date collection itself
   - Zotero MCP mutation guard:
     - allowed collection scope is the unique top-level `文献池` subtree plus the unique top-level `值得精读`
     - required managed collections are auto-created when missing: top-level `文献池`, `文献池/待删除`, and top-level `值得精读`
     - `待删除` is valid only as `文献池/待删除`; top-level `待删除` is out of scope
     - `值得精读` is valid only as a top-level sibling of `文献池`; `文献池/值得精读` is out of scope
     - `add_items_to_collection`, `remove_items_from_collection`, `create_collection`, `delete_collection`, and metadata writes must fail closed or skip when scope is outside this allowed set
     - if required managed collections are ambiguous or created at the wrong position, the corresponding mutation must not call Zotero MCP
     - every blocked mutation records `collection_scope_blocked_count` and `collection_scope_blocked_samples`
   - dedup policy before writeback:
     - read/build duplicate indexes for `文献池`, `文献池/待删除`, and `值得精读`
     - exact normalized match priority: `DOI > PMID > PMCID > arXiv > exact normalized title`
     - title normalization must cover Unicode/punctuation/spacing variants (NFKC/NFKD, quote/dash unification, fullwidth mapping, combining-mark removal, control/zero-width cleanup)
     - if duplicate in any of those collections: skip create and skip all add-to-collection operations for current-day routing
     - if not duplicate: add to root pool first, then add to daily source/grade collections
     - record `skipped_duplicate_in_pool`, `skipped_duplicate_in_trash`, `skipped_duplicate_in_worthy`, and created/add counters in writeback summary
11. Historical collection modification:
   - ordinary Stage 1 reads previous feedback and applies item actions by default when MCP and collection guard are ready
   - set `APPLY_FEEDBACK_ITEM_ACTIONS=false` only for plan-only feedback item actions
   - explicit correction command: `node tools/zotero_feedback_collection_corrections.mjs`
   - feedback correction must use Zotero MCP only; never access `zotero.sqlite`, move PDFs, delete attachments, or fetch RSS/PubMed/PMC
   - feedback correction must stay inside the allowed collection scope: `文献池` subtree, `文献池/待删除`, and top-level `值得精读`
   - match priority for correction: stable itemKey/ID from local pipeline JSON, then translated title, then English title, then Zotero MCP `search_library` exact English-title fallback
   - if local pipeline records contain duplicate title matches, resolve only when Zotero MCP exact title search returns a single item; otherwise keep conflict/manual review
   - `drop` correction target is `文献池/待删除`: add the item there, then remove it from the original day grade collection; do not delete the Zotero item automatically unless a separate explicit delete mode is requested and verified
   - `keep` is no-op; `upgrade`/`downgrade` add to target grade collection and remove from original grade collection
   - all correction runs must emit `research_os/run_manifests` JSON/CSV audit files with status counts and safety flags
12. Star migration (rated items → `值得精读`):
   - enabled by default; controlled by `ZOTERO_STAR_MIGRATION_MODE` (`expand` / `legacy` / `disabled`)
   - window: `ZOTERO_STAR_MIGRATION_WINDOW_DAYS` (default `7`); threshold: `ZOTERO_STAR_MIGRATION_MIN_STARS` (default `4`)
   - `expand` mode scans A + B + C grade collections; `legacy` mode scans A + B only
   - migration target collection: `值得精读` (top-level, sibling of `文献池`)
   - migration flow per eligible item:
     1. add item to `值得精读`
     2. remove item from date subcollections (source collections + grade collections)
     3. remove item from root `文献池` — **mandatory** to keep root and date subcollections in sync
   - if any removal step fails, log the error and continue with next item; do not abort the migration
   - audit fields in `migration_stats`: `eligible_items`, `moved_to_worthy`, `already_in_worthy`, `removed_from_source_collections`, `removed_from_grade_collections`, `removed_from_root_pool`, `removal_failures`, `add_failures`
   - invariant: after each run, every item in `值得精读` must NOT be in `文献池` root, and must NOT be in any date grade/source subcollection
   - code location: `tools/mcp_bulk_writeback.mjs` → `migrateRatedItems` function

## Monthly Review Checklist

1. Verify trend quality in the monthly `月报-*.docx` report.
2. Verify machine audit JSON for unresolved items, contradiction evidence, and preference drift when needed.
3. If historical run records are missing, the report should state “记录不足” rather than inventing data.

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

- For all Research OS `.xlsx` outputs, default export path is the Codex spreadsheet capability via the unified spreadsheet adapter.
- Scope is limited to final user-facing outputs: `隔日报.xlsx` plus the monthly `月报-*.docx` report.
- Export fallback order is fixed and auditable:
  1. `codex_spreadsheet`
  2. `node_fallback`
  3. `python_spawn_legacy`
  4. `manual_required`
- `python_spawn_legacy` is compatibility fallback only and must not be the default or sole export path.
- Every export must record method and outcome in `run_report.json` (or equivalent audit JSON): `export_method`, `export_skill`, `output_path`, `input_files`, `generated_at`, `fallback_chain`, and error/degrade fields when applicable.
- If the Codex spreadsheet capability is not callable in the current execution context, report the unavailability reason and degrade using the fallback chain. Never claim spreadsheet-capability usage when it was not used.
- The Codex spreadsheet capability is responsible for workbook generation only; it does not perform triage, Zotero writeback, metadata backfill, semantic learning/search, preference updates, 7-day migration, or candidate ranking.
- XLSX export root remains: `<YOUR_PROJECT_ROOT>/research_os/文献评价`.

## Feedback Learning Audit Baseline

- `med-query-learning` must emit explicit audit fields for previous-day feedback lookup, column detection, sample counts, and preference execution outcome.
- The long-lived preference source is `screening_standards.md`, not xlsx stores or secondary markdown files.
- Every run must read `<YOUR_PROJECT_ROOT>/research_os/文献评价/screening_standards.md` as the only long-lived screening-standard source.
- If `screening_standards.md` is missing, initialize it with the Chinese baseline standard and continue.
- Before using the standards file, normalize previous display markup: red additions become plain text; blue strikethrough deletions are removed.
- Daily standard changes are written back to clean `screening_standards.md`; `screening_standards.docx` is regenerated as the human revision display, with current additions in red and current deletions in blue strikethrough.
- `screening_standards.docx` workspace conventions:
  - The evaluation area ("评价") and "Pending Rule Suggestions" table are consumable workspaces; Stage 1 reads and processes them by default.
  - The evaluation area may be cleared only after AI rule rewrite succeeds; if the AI key is missing or LLM processing fails, user input must remain in docx and the blocker must be audited.
  - `PREFERENCE_LEARNING_API_KEY` is the direct key for AI rule rewrite; `TITLE_TRANSLATION_API_KEY` is the fallback key. Reports must record whether a key is configured and whether the source is direct or fallback, but never record the key value.
  - After processing, only unresolved pending suggestions may remain.
  - Suggestions with status `accepted`/`rejected`/`revise` or with `processed_at` must not be written back into the next docx round.
  - "Preserved User Content" is reserved for genuinely unclassifiable user-authored content only; it must not contain Format Notes, Status options, Pending Rule Suggestions, old evaluation text, old Preserved User Content blocks, or other system template content, to prevent recursive pollution.
  - Auto-maintained docx must not generate unbounded timestamp backups by default; at most one fixed backup file (`screening_standards.backup.docx`) is kept, overwriting on each run. Historical timestamp backups are not currently maintained; if future audit needs arise, a separate opt-in mechanism may be implemented.
- Every `隔日报.xlsx` export must include only the user-facing `每日反馈` sheet.
- Detailed audit fields must stay in `preference_learning_audit.json` and `run_report.json`, not in `隔日报.xlsx`.
- Missing `当前筛选标准摘要` is expected for new exports and must not block preference learning.
- Users can train the system through two feedback channels:
  - article-level `feedback` as direction plus strength (`keep` = no-op/weak positive, `upgrade` = positive, `downgrade` = weaker negative, `drop` = stronger negative); `comment` is optional auxiliary context
  - standards-file text in `screening_standards.md` as the primary rationale source for preference boundaries
- Feedback item actions are enabled by default: `drop` items move to `文献池/待删除`, and `upgrade` / `downgrade` items update the corresponding grade collections. `keep` is a no-op. Set `APPLY_FEEDBACK_ITEM_ACTIONS=false` only when you want a plan-only run.
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

## Cross-Platform Principle

**Different OS → different commands → same functional behavior.**

The pipeline must produce identical outcomes on Windows and macOS: same Stage 1→2→3→4 flow, same artifacts, same report status values, same Zotero collection structure. The implementation uses platform-specific system commands for two operations only:

| Operation | Windows | macOS | Linux |
|---|---|---|---|
| Launch Zotero | `powershell.exe Start-Process` → `cmd.exe /c start` → detached `spawn(ZOTERO_EXE)`; `schtasks` is legacy/manual only | `open -a Zotero` | `spawn(ZOTERO_EXE)` |
| Detect Zotero process | `tasklist` + `Get-Process` via pwsh | `ps -A -o comm=` | `ps -A -o comm=` |

Everything else (MCP probe, RSS fetch, PubMed query, triage, dedup, writeback, translation, export) is platform-independent Node.js code.

The single functional gate for Stage 2/3 entry is: **MCP `get_collections` JSON-RPC probe succeeds**. This gate is identical on all platforms. Process existence is a diagnostic signal only, not a gate.

## Cross-Platform Preflight Rules

- `runtime_config.mjs` resolves `zoteroExe` per platform: darwin → `/Applications/Zotero.app/Contents/MacOS/zotero`, win32 → `D:/Zotero/zotero.exe`, linux → `zotero` (PATH). `ZOTERO_EXE` env override has highest priority on all platforms.
- `ensure_zotero_mcp_ready.mjs` uses platform-aware process detection: win32 → `tasklist` + `powershell.exe`/`pwsh`, darwin/linux → `ps -A -o comm=` (macOS markers: `zotero`, `/contents/macos/zotero`).
- Platform-aware launch: win32 → `powershell.exe Start-Process`, then `cmd.exe /c start`, then Node `spawn`; darwin → `open -a Zotero`; fallback → Node `spawn`.
- `schtasks`/`powershell.exe`/`tasklist`/`cmd.exe`/`Start-Process` must only be called in win32 code paths.
- macOS must use `open`/`ps` equivalents; never call Windows-only commands on darwin.
- `ZOTERO_EXTERNAL_LAUNCHER=desktop_commander` is Windows-only. On macOS, do not set this value.
- Process existence ≠ MCP ready. MCP readiness (`get_collections` JSON-RPC probe) is the only gate for Stage 2/3.

## Stage Gate Status Values

- `completed`: All stages passed.
- `completed_stage1_only`: Explicit `--stage1-only` mode; no MCP/Zotero/Stage2/3/4 attempted.
- `degraded_due_to_mcp_unavailable`: Stage 1 passed but MCP readiness failed; Stage 2/3/4 skipped with recorded reason.
- `failed`: Stage 1 failed, or Stage 2/3/4 failed after MCP was ready.
- `skipped`: Interval gate not reached; no stages executed.
- `failed_due_to_config_or_dependency`: Config/dependency failure before any stage execution.

## Stale Artifact Protection

- `inspectArtifact` compares artifact `mtime` against `stageStartedAt`. If `mtime < stageStartedAt`, artifact is marked `stale: true, currentRun: false`.
- Stale `mcp_writeback_summary.json` or `abc_translation_backfill.json` must not be treated as current-run success artifacts.
- Orchestrator checks `artifacts.writeback_summary.currentRun` and `artifacts.translation_backfill.currentRun` before proceeding to next stage.
- Each report includes `runId` for cross-run artifact correlation.

## macOS Parity Test Commands

```bash
# Syntax check all key modules
node --check tools/lib/ensure_zotero_mcp_ready.mjs
node --check tools/lib/runtime_config.mjs
node --check tools/check_zotero_mcp_ready.mjs
node --check tools/run_zotero_literature_filter.mjs

# Run macOS parity tests (mock-based, no real Zotero/MCP)
node --test tests/macos_parity.test.mjs

# Stage 1-only smoke test (no MCP needed)
node --env-file=.env tools/run_zotero_literature_filter.mjs --stage1-only

# MCP readiness probe
node --env-file=.env tools/check_zotero_mcp_ready.mjs
```

## MCP Preflight Contract

- Before any due four-stage Zotero workflow run, use the repository bootstrap `tools/lib/workflow_startup_ready.mjs` through the single entrypoint `tools/run_zotero_literature_filter.mjs`; do not require the Windows scheduled task `StartZoteroForCodexOnly`.
- The bootstrap is cross-platform: Windows uses local process launch/recovery, macOS uses `open`, and Linux uses detached spawn where available.
- Zotero startup success is defined only by Zotero MCP `get_collections` success, not by process existence.
- Ollama startup success is defined only by `GET /api/tags` success, not by process existence.
- Zotero startup keeps a fixed 3000ms post-launch wait for the Zotero MCP plugin, then uses bounded MCP polling. In startup bootstrap, the default MCP polling window is longer than the Stage2/Stage3 readiness probe to tolerate GUI/plugin cold starts.
- `ZOTERO_EXTERNAL_LAUNCHER=desktop_commander` is a legacy external-launcher mode. The repository bootstrap temporarily disables it while starting dependencies so local fallback can run without Desktop Commander approval.
- `schtasks /Run /TN StartZoteroForCodexOnly` is legacy/manual only and must not be used as the primary scheduled/background path. If the repository bootstrap reports `startup.failureClass=process_permission_denied`, Desktop Commander may be used as the third fallback to run `node --env-file=.env tools/start_workflow_dependencies.mjs`, then the single repository entrypoint is rerun once.
- If the bootstrap cannot make Zotero MCP or Ollama ready, all workflow stages must be skipped with `startup_failed` and the report must include `startup` diagnostics.
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
  1. Set workflow control environment only: `ZOTERO_PROJECT_ROOT`, `DESKTOP_REVIEW_ROOT`, `ZOTERO_EXE`, `RESEARCH_OS_ORCHESTRATOR_TRIGGER`, and `RESEARCH_OS_RUN_INTERVAL_DAYS`.
  2. Do not set `ZOTERO_EXTERNAL_LAUNCHER=desktop_commander`.
  3. First run `node --env-file=.env tools/run_zotero_literature_filter.mjs --trigger=scheduled`; this preserves the repository bootstrap as the primary startup path.
  4. If the report is `skipped` with `interval_not_reached`, stop without prewarming dependencies.
  5. If the report is `failed_due_to_config_or_dependency` and `startup.failureClass=process_permission_denied`, Desktop Commander may be used as the third fallback by running exactly `node --env-file=.env tools/start_workflow_dependencies.mjs` from the project root, then rerunning the single entrypoint exactly once.
  6. If Desktop Commander is not exposed for the permission-denied fallback, report the blocker and do not switch to `schtasks`.
- `tools/run_zotero_literature_filter.mjs` performs the interval gate first; when a run is due, startup bootstrap verifies Zotero MCP and Ollama before Stage 1, and the shared MCP readiness helper remains the second gate before Stage 2.
- Startup reports include `startup.failureClass`; `process_permission_denied` means local Windows process commands were blocked by the execution environment and automation may escalate to the Desktop Commander third fallback.
- Only when MCP readiness passes may Stage 2/Stage 3 run; if not ready, the orchestrator skips Stage 2/Stage 3 and marks upstream failure for Stage 4.
- Stage2/Stage3 preflight in `ZOTERO_EXTERNAL_LAUNCHER=desktop_commander` mode must be readiness-only; it must not attempt local `pwsh`, `tasklist`, `Get-Process`, `Start-Process`, or Node spawn fallback.
- For every run summary, report:
  - startup strategy
  - startup diagnostics
  - Zotero MCP ready result
  - Ollama ready result
  - MCP ready check result
- If MCP is not ready after external launcher handoff:
  - Stage2/Stage3 must stop with `MCP_NOT_READY_AFTER_EXTERNAL_LAUNCHER`
  - no writeback/backfill success claim is allowed
  - stale `mcp_writeback_summary.json` and `abc_translation_backfill.json` must not be treated as current-run success artifacts.

## Ollama Preflight Contract

- Before semantic grading, `run_research_os_pipeline.mjs` calls `ensureOllamaReady()` wrapped in `ensureWithStrongRecovery()` from `tools/lib/workflow_startup_ready.mjs`.
- Strong recovery flow: primary probe → if fails, kill existing Ollama process → restart → re-probe.
  - **Kill step** (via `restartWorkflowProcess`):
    - **Windows**: `taskkill /IM ollama.exe /F` (falls back to graceful skip in sandbox)
    - **macOS**: `pkill -x Ollama` / `pkill -x ollama`
    - **Linux**: `pkill -f ollama`
  - **Restart step**: `ensureOllamaReady()` launches Ollama fresh (platform-specific)
  - **Re-probe step**: polls `GET {ollamaUrl}/api/tags` again
- `ensureOllamaReady` performs `GET {ollamaUrl}/api/tags` health check. If already reachable, returns immediately (`started_now: false`).
- If not reachable, launches Ollama per platform:
  - **Windows**: `node spawn("ollama", ["serve"])` (detached)
  - **macOS**: `open -a Ollama`
- After launch, polls `/api/tags` up to 10 times at 3-second intervals.
- Default Ollama URL: `http://127.0.0.1:11434`; override via `OLLAMA_HOST` env var.
- Ollama startup failure (`OLLAMA_START_FAILED` / `OLLAMA_NOT_REACHABLE`) sets `semanticGradingReport.skipped_reason = "ollama_unavailable"` and skips semantic grading only. All other pipeline stages continue normally.
- `check_ollama_ready.mjs` is a standalone CLI entry point for manual readiness checks.
- Embedding model is not auto-pulled; if missing, report the gap and stop semantic grading.
- CLI startup order when semantic grading is enabled:
  1. Semantic grading is enabled by default; set `ZOTERO_SEMANTIC_PREFERENCE_ENABLED=false` only if you intentionally want to disable it for a run.
  2. Run `node --env-file=.env tools/run_zotero_literature_filter.mjs`.
  3. Pipeline automatically starts Ollama with strong recovery if needed before semantic grading.

## Semantic Review Eligibility

- Semantic review (`rule_grade → semantic_grade → final_grade`) only processes **B** and **C** items.
- **A** items are not reviewed (already highest grade, no upgrade path).
- **D** items are not reviewed, including those with `flags.uncertain=true`.
- The eligibility check is: `ruleGrade === "B" || ruleGrade === "C"`.
- 隔日报 and human review still operate on all ABC items; D items are excluded from daily review as before.
- C→D semantic downgrade does **not** auto-adopt: `final_grade` stays C, `needs_human_review=true`, `disagreement_type=semantic_downgrade_review`. Human must confirm or reject.
- All other 1-level adjustments (C→B, B→A, B→C) auto-adopt. 2+ level differences keep `rule_grade` and flag `needs_human_review=true`.

## 脚本入口与验证约定

- 当前唯一稳定主入口是 `tools/run_zotero_literature_filter.mjs`。
- 内部阶段链路为 `run_research_os_pipeline.mjs` → `mcp_bulk_writeback.mjs` → `mcp_translation_backfill.mjs` → `finalize_research_os_exports.mjs`。
- 诊断工具包括 `tools/check_zotero_mcp_ready.mjs` 和 `tools/check_ollama_ready.mjs`。
- 详细脚本角色、是否可直接运行、是否可能写入 Zotero、是否默认需要 dry-run / `--apply`，请参考 `docs/internal-script-inventory.md`。
- 只做语法验证时，优先使用：
  - `node --check tools/run_zotero_literature_filter.mjs`
  - `node --check tools/run_research_os_pipeline.mjs`
  - `node --check tools/mcp_bulk_writeback.mjs`
  - `node --check tools/mcp_translation_backfill.mjs`
  - `node --check tools/finalize_research_os_exports.mjs`

## 模块归属与 CLI Wrapper 约定

- **CLI wrapper 调 lib owner**：CLI 脚本（`tools/*.mjs`）只做入口编排，核心逻辑由 `tools/lib/*.mjs` 提供。
- **thin wrapper 标准**：CLI 不重复定义 lib 中已有的业务逻辑（如 probe、retry、格式化）。
- **唯一 owner 原则**：每项能力有且只有一个 lib 模块作为 owner，避免平行竞争实现。
- **详细归属表**：见 `docs/internal-module-ownership.md`。
- **MCP readiness**：`check_zotero_mcp_ready.mjs` 已收敛为 thin wrapper，直接调用 `ensureZoteroMcpReady()`（默认 probe 由 lib 提供）。
- **Ollama readiness**：`check_ollama_ready.mjs` 已是 thin wrapper。
- **后续收敛方向**：统一日期格式化函数、MCP 工具函数、`cleanJournalSource` 等重复实现。
