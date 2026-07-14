# Stage 1 Helper Boundaries

> Navigation index — read the pipeline flow in `workflow/tools/stage1/main.mjs` alongside this file.

## Pipeline Phase Order

```
source collection → dedup → triage → LLM review → preference learning → writeback ready artifact → run report → artifact manifest
```

## Helpers by Phase

### 1. Source Collection Summary

- **File**: `workflow/tools/stage1/source_summary.mjs`
- **Function**: `buildStage1SourceSummary({ sources, preDedupItemsCount })`
- **Responsible for**: per-source enabled/triggered/item-count/failure diagnostics; pre-dedup total.
- **Does NOT**: fetch data, modify sources, set enable/disable rules.
- **Pure function**: yes.
- **Report field**: `report.steps.med_entry_parallel.source_collection_summary`

### 2. Dedup Summary

- **File**: `workflow/tools/stage1/dedup_summary.mjs`
- **Function**: `buildStage1DedupSummary({ inputItems, dedupedItems, dedupDiagnostics, dedupKeyStrategy })`
- **Responsible for**: dedup input/output/removed counts; key-strategy annotation; downstream collection notes.
- **Does NOT**: run the dedup algorithm, change dedup keys, embed item lists.
- **Pure function**: yes.
- **Report field**: `report.steps.dedupe.dedup_summary`

### 3. Triage / Initial Grade Summary

- **File**: `workflow/tools/stage1/triage_summary.mjs`
- **Function**: `buildStage1TriageSummary({ items, llmReviewCandidateCount, writebackReadyItemsCount, gradeFieldPrecedence })`
- **Responsible for**: grade distribution (A/B/C/D/E/missing/unknown); ABC vs non-ABC split; LLM/writeback exclusion counts.
- **Does NOT**: run triage algorithm, change grade fields, select LLM candidates.
- **Pure function**: yes.
- **Report field**: `report.steps.triage.triage_summary`
- **Note**: `llmReviewCandidateCount` / `writebackReadyItemsCount` are patched after downstream steps produce real counts (see pipeline lines after `writebackReadyArtifact`).

### 4. LLM Review Candidate Selection

- **File**: `workflow/tools/stage1/llm_grade_reviewer.mjs`
- **Function**: `buildLlmReviewCandidates(items, { eligibleRuleGrades, duplicateRemovedCount })`
- **Rule**: selects **all dedup-passed ABC items** — no max/cap/truncate.
- **Responsible for**: filtering eligible candidates from triaged items; producing telemetry summary.
- **Does NOT**: call LLM, change grade fields, modify items.
- **Pure function**: yes.
- **Report field**: `report.steps.dedupe.llm_review_candidate_count`, `report.llm_review_candidate_summary`

### 5. LLM Review Execution Summary

- **File**: `workflow/tools/stage1/llm_review_execution_summary.mjs`
- **Function**: `buildLlmReviewExecutionSummary({ candidateCount, enabled, triggered, reviewedCount, ... })`
- **Responsible for**: whether LLM was triggered; how many reviewed; success/failure/skip outcomes; degradation.
- **Does NOT**: call LLM, embed config/responses, modify items.
- **Pure function**: yes.
- **Report field**: `report.llm_review_execution_summary`

### 6. LLM Review Application Summary

- **File**: `workflow/tools/stage1/llm_review_application_summary.mjs`
- **Function**: `buildLlmReviewApplicationSummary({ triagedItems, llmReport })`
- **Responsible for**: post-hoc diagnostic of how LLM results matched triaged items; applied/unmatched/missing counts; grade-change stats.
- **Does NOT**: apply results (that happens inside `reviewGradesWithLlm` → `applyReviewToItems`), call LLM, modify items.
- **Pure function**: yes.
- **Report field**: `report.llm_review_application_summary`

### 7. Preference Learning Input Selection

- **File**: `workflow/tools/stage1/llm_preference_learning.mjs`
- **Function**: `buildPreferenceLearningInputs(...)`
- **Responsible for**: selecting which feedback rows to feed into preference learning.
- **Does NOT**: run preference learning, call LLM.
- **Pure function**: reads config, does not write files.

### 8. Preference Learning Execution Summary

- **File**: `workflow/tools/stage1/preference_learning_execution_summary.mjs`
- **Function**: `buildPreferenceLearningExecutionSummary({ inputRowsCount, enabled, triggered, ... })`
- **Responsible for**: whether triggered; processed/succeeded/failed counts; skip reason; audit write diagnostics.
- **Does NOT**: call LLM, embed feedback rows/config/responses, modify items.
- **Pure function**: yes.
- **Report field**: `report.preference_learning_execution_summary`

### 9. Screening Standards Sync Summary

- **File**: `workflow/tools/stage1/screening_standards_docx.mjs`
- **Function**: `buildScreeningStandardsSyncPlan({ syncSteps, ... })`
- **Responsible for**: sync plan between `.md` and `.docx` screening standards.
- **Report field**: `report.screening_standards_sync_summary`

### 10. Writeback Ready Artifact Builder

- **File**: `workflow/tools/lib/pipeline_stage_support.mjs`
- **Functions**: `buildWritebackReadyItems`, `buildWritebackReadyArtifact`
- **Responsible for**: producing the `writeback_ready_items.json` payload for Stage 2.
- **Does NOT**: perform Zotero writeback, call MCP.
- **Pure function**: yes (given translationCache).
- **Artifact**: `writeback_ready_items.json`

### 11. Stage 1 Artifact Writer

- **File**: `workflow/tools/stage1/artifact_writer.mjs`
- **Function**: `writeStage1CompletedArtifacts`
- **Responsible for**: batch-writing completed-path Stage 1 artifacts (data JSONs, run_report, desktop review source, skill_alignment) in the original order, with original paths, filenames, JSON indentation, and content.
- **Does NOT**: handle skip-path writes (`run_skip_report.json` / `run_report.json` alias), timing diagnostics, early/final preference learning audits, journal quality gate report, standards rule suggestions, feedback item actions plan, or manifest semantics.
- **Side effects**: writes files — not a pure function.
- **Does NOT**: call external services, access network, call LLM, read/modify `process.env`, mutate input objects.
- **Artifacts**: `rss_items.json`, `db_items.json`, `merged_items.json`, `triaged_items.json`, `triaged_export_items.json`, `writeback_ready_items.json`, `daily_failed_feeds.json`, `pending_zotero_writeback.json`, `run_report.json`, `desktop_daily_review_source.json`, `skill_alignment.json`.

### 12. Stage 1 Run Report Builder

- **File**: `workflow/tools/stage1/run_report_builder.mjs`
- **Functions**: `buildStage1RunReport`, `buildCompletedStage1RunReport`, `buildStage1SkipRunReport`
- **Responsible for**: assembling the final `run_report.json` with all step summaries and counts.
- **Does NOT**: execute pipeline steps.
- **Artifact**: `run_report.json`

### 13. Stage 1 Artifact Manifest

- **File**: `workflow/tools/stage1/artifact_manifest.mjs`
- **Function**: `buildStage1ArtifactManifest({ pipelineDir, mode, written })`
- **Responsible for**: listing all expected pipeline artifacts with write status.
- **Artifact**: `stage1_artifact_manifest` (embedded in `run_report.json`)

---

## Hard Boundary Rules

All `buildStage1*` / `build*Summary` / `build*ExecutionSummary` helpers listed above:

- **Do NOT** call external services (LLM, MCP, Zotero, NCBI, EasyScholar, RSS).
- **Do NOT** read or write files.
- **Do NOT** depend on `process.env`.
- **Do NOT** introduce max/cap/limit/truncate.
- **Do NOT** embed full prompt text, full LLM responses, API keys, complete item lists, or human-authored evaluation prose in summaries.

LLM candidate selection rule: **all dedup-passed ABC items** — no additional truncation.

Writeback ready artifact schema should not be changed without coordinating with Stage 2 consumers.

## Cross-References

- Pipeline entry point: `workflow/tools/stage1/main.mjs`
- Desktop/Web production entry (invoked by the shared Runner): `workflow/tools/stage0/main.mjs`
- Reuse-first policy and general rules: `AGENTS.md`
