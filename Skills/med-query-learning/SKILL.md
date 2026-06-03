---
name: med-query-learning
description: v1.4 update
---

# med-query-learning

1. Read only previous-cycle report (`隔日报.xlsx` preferred, `daily_review.xlsx` compatibility allowed) using deterministic lookup order:
- first: `<PROJECT_ROOT>/research_os/文献评价/<yy WeekWW>/<yy.M.d>/隔日报.xlsx`
- compatibility first-root fallback: `.../daily_review.xlsx`
- legacy fallback: `<DESKTOP_REVIEW_ROOT>/文献评价/<yy WeekWW>/<yy.M.d>/隔日报.xlsx` then `daily_review.xlsx`
- legacy fallback: `<PROJECT_ROOT>/文献评价/<yy WeekWW>/<yy.M.d>/隔日报.xlsx` then `daily_review.xlsx`
- final compatibility fallback: `research_os/<ISO-week>/<yy.M.d>/隔日报.xlsx` then `daily_review.xlsx`
- persist all attempted paths and selected file path in run audit fields.
- must use unified Node/JS workbook reader (`tools/lib/review_workbook_reader.mjs`) for both formal Stage1 and dry-run/diagnostic checks.
- classify failures precisely:
  - workbook cannot be parsed/read => `workbook_unreadable`
  - workbook+headers read successfully but feedback/comment aliases missing => `required_feedback_columns_missing`
  - never misreport workbook unreadable as `feedback_column_missing`
- `python_failed` is not a valid blocker for feedback workbook read in formal path.
2. Preference learning must complete and be loaded before triage starts.
2.1 Preference learning is a persistent three-layer process on every run:
- `feedback/comment/title` -> evidence
- evidence -> preference clusters
- preference clusters -> screening preference rules
- no later med-query-learning logic may bypass clustering/stabilization and write rules directly from raw feedback rows
2.2 Preference learning must emit auditable outputs for every run:
- `pipeline/preference_learning_audit.json`
- `隔日报.xlsx` sheets:
  - `偏好学习摘要`
  - `偏好证据明细`
  - `筛选标准变更`
  - `本次筛选影响`
 - `<PROJECT_ROOT>/research_os/文献评价/screening_preferences.xlsx` as the persistent cluster-level store with:
   - `Screening Preferences`
   - `Evidence Detail`
   - `Meta Preference Evidence`
   - `Ambiguous Needs More Feedback`
2.3 Standard-summary feedback loop is mandatory on every run:
- generate `当前筛选标准摘要` from cluster-level active rules
- export `当前筛选标准摘要` with every `隔日报.xlsx`
- include caveats and uncertain boundaries in summary text
- newly exported `当前筛选标准摘要` must be concise and contain only two Chinese columns:
  - `当前筛选标准`
  - `我的评价`
- `当前筛选标准` is the system's concise cluster-derived summary; `我的评价` is blank for natural-language user feedback
- do not export audit fields or old English user-input columns in this sheet; keep detailed audit in JSON/run_report/other preference-learning sheets/screening_preferences.xlsx
- on next run, read `当前筛选标准` and `我的评价`, infer issue type conservatively, and convert the row to meta-preference evidence
- `我的评价` is free text and must not require enum values; infer examples include `too_broad`, `too_narrow`, `wrong_focus`, `missing_priority`, `over_excluding`, `under_excluding`, `needs_more_clinical_focus`, `accurate`, or `other`
- legacy workbooks with `user_feedback_on_summary`, `user_comment_on_summary`, and `user_correction_hint` may be read as fallback only
- meta-preference evidence must map to target clusters when possible; when mapping fails, record explicit `global_meta_feedback`
- meta-preference evidence can adjust cluster scope/status/confidence via reinforce, weaken, split-suggested, mark ambiguous, retire, add caveat, narrow scope, broaden scope, or needs-more-feedback
- meta-preference evidence must not directly overwrite all rules and must not be silently ignored
- missing `当前筛选标准摘要` must be audited as an export-contract issue rather than treated as ordinary zero feedback
3. Process rows where:
- `feedback` is non-empty
- `处理状态 != 已学习`
- support column aliases:
  - feedback: `feedback`, `Feedback`, `反馈`, `用户反馈`
  - comment: `comment`, `Comment`, `备注`, `评价备注`
  - English title: `英文标题`, `title`, `Title`, `English Title`
  - translated title: `标题翻译`, `中文标题`, `translated_title`, `title_translation`

4. Build evidence first:
- each supported feedback row becomes one evidence item with `source_file`, `source_row`, `feedback`, `comment`, `english_title`, `title_translation`, direction, confidence, and traceability fields
- empty feedback does not enter learning
- missing title translation falls back to English title and lowers confidence
- empty comment is allowed as evidence but lowers confidence

5. Cluster evidence on every run:
- load existing cluster/rule store from `screening_preferences.xlsx` when present
- merge new evidence into matching clusters when possible; create a new cluster only when no existing cluster matches
- recompute `evidence_count`, `positive_evidence_count`, `negative_evidence_count`, `confidence`, and `status` for every touched cluster
- allowed statuses: `stable`, `tentative`, `ambiguous`, `needs_more_feedback`
- a single evidence item may become `tentative` or `needs_more_feedback`, but never `stable`
- conflicting positive/negative evidence in the same topic family must produce `ambiguous`
- negative clusters must keep caveats/boundaries; do not generalize an exclusion across the whole topic

6. Use semantic evidence only as weak enrichment:
- A. `feedback` = strong supervision (keep/upgrade positive, drop/downgrade negative)
- B. `comment + title` = explanatory context (why user made the decision on this title)
- C. Zotero MCP `semantic_search` = weak context evidence only

7. Scope boundary:
- semantic search is allowed only on previous-day feedback samples
- use Zotero MCP `semantic_search` (query/topK/minScore/language) and optional `semantic_status` (no args)
- semantic search is not allowed to expand today's candidate pool
- semantic neighbors are not pseudo-labeled feedback samples
- semantic evidence cannot override explicit user feedback
- call semantic capability through existing Zotero MCP interface only; do not directly call embedding providers/endpoints from pipeline code

8. Update retrieval preference candidates:
- positive terms
- negative/exclusion terms
- MeSH expansions
- study-type preference weights

9. Weight rules:
- `keep`/`upgrade`: raise matched terms.
- `drop`/`downgrade`: demote or exclude matched terms.
- if `feedback` and `comment` conflict, lower confidence and avoid hard policy updates.
- if title translation missing or likely noisy, fallback to English title and lower confidence.
- if only one sample supports a rule, keep it as `tentative` or `needs_more_feedback`.
- for negative feedback, prefer conditional exclusion hints; avoid broad topic-level rejection.

10. Stability rule:
- Single row cannot hard-rewrite policy.
- Require repeated evidence before solidifying preference.
- Every evidence item must keep traceability (`source_row`, feedback/comment/title context); cluster-level rules must keep `cluster_id`, `source_rows`, and `evidence_ids`.
- Screening preferences are cluster-level rules, not raw evidence rows.
- On failure/degrade, report concrete blockers (file missing / header missing / read failure / fallback failure / preference not loaded), not just a generic degrade label.
- Do not fabricate triage impact or score deltas; when unavailable, mark `impact_unknown` and `score_delta_unavailable`.

11. Output:
- explainable query pack for PubMed/PMC Boolean + MeSH retrieval.
- include uncertainty notes: missing translation count, ambiguous feedback/comment rows.
- audit must include:
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
  - `screening_preference_output_path`
  - `screening_preference_loaded_before_triage`
  - `signals.previous_feedback_missing`
  - `signals.feedback_columns_missing`
  - `signals.no_feedback_rows`
  - `signals.preference_not_updated`
  - `signals.preference_not_loaded_before_triage`
  - `signals.score_delta_unavailable`
  - `preference_learning_audit_path`
  - `preference_learning_summary_exported`
  - `preference_learning_sheets_exported`

12. screening_standards.docx sync and rule suggestions:
- syncScreeningStandardsDocx rebuilds docx from scratch but preserves keywords, evaluation text, and unknown user content.
- Before overwriting, a timestamped backup is always created.
- Unknown user content (not captured by known section handlers, or rule lines in docx not present in md) is preserved in a visible "用户保留内容 / Preserved User Content" section.
- suggestionsLogPath must be passed to docx sync so latest standards_rule_suggestions appear immediately in the docx table.
- Feedback can generate standards_rule_suggestions with types: hard_exclude, positive_preference, 
egative_preference.
- vidence_count >= 2 or explicit human evaluation text required to generate a suggestion; do not fabricate rules.
- hard_exclude suggestions default to equires_manual_review=true.
- Pending suggestions (including pending hard_exclude) must not affect classifyItem.
- Status handling in "待确认规则建议" table:
  - pending / 待定: no effect, no md write.
  - ccept / 接受: write 建议规则 to md formal rules section.
  - eject / 拒绝: no md write; record rejected to avoid duplicate suggestions.
  - evise / 修改: write 修订后规则 to md; if revised rule empty, warning and skip.
  - Unknown non-empty status: warning, skip, do not treat as pending.
- Suggestions must be deduplicated against existing md rules and existing docx suggestions.
- Only accepted/revised suggestions synced to screening_standards.md affect classifyItem.
- Tests for docx sync must use temp files; never overwrite real screening_standards.docx.

13. screening_standards file conventions:
- `screening_standards.md` = the only long-lived preference source (plain text, no markup)
- `screening_standards.docx` = human revision display version:
  - Current additions displayed in red text
  - Current deletions displayed in blue strikethrough
  - Regenerated from md on each run via syncScreeningStandardsDocx
- `screening_standards.backup.docx` = at most one backup file, overwritten on each run (no timestamped backups by default)
- `.screening_standards.last_synced.md` = snapshot of md at last sync for change detection
- The "评价" (evaluation) area and "待确认规则建议" (Pending Rule Suggestions) table in docx are consumable workspaces: after processing, clear evaluation text and keep only unresolved pending suggestions
- Suggestions with status accepted/rejected/revise or with processed_at must not be written back into the next docx round