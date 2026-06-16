---
name: med-semantic-grading
description: 基于研究标准的语义分级技能。Use when applying a second-pass semantic grade to triaged items using configurable research focus term lists from workflow_rules.json, after rule-based grading is complete.
---

# med-semantic-grading

1. Purpose:
- Apply a second-pass semantic grade to items already classified by rule-based grading (see `med-daily-triage`)
- Uses configurable term lists from `workflow_rules.json` → `research_focus` field
- Skill is domain-agnostic: all research-specific terms come from user config

2. Data source:
- `workflow_rules.json` → `triage.research_focus` field contains three configurable term groups:
  - `group1` (config key: `core_exposure_terms`) — first term group
  - `group2` (config key: `core_biology_terms`) — second term group
  - `group3` (config key: `mechanism_terms`) — third term group
- All three groups are user-defined; skill does not hardcode any domain-specific vocabulary

3. Implementation entry point:
- `workflow_classifier.mjs` → `deriveSemanticGradeFromStandards()`
- Called from `run_research_os_pipeline.mjs` after rule-based triage

4. Scoring logic:
- For each eligible item (B/C only), count term hits in `title + abstract`:
  - `group1Hits`: number of group1 terms found in text
  - `group2Hits`: number of group2 terms found in text
  - `group3Hits`: number of group3 terms found in text
- Supplement with weak evidence from `semantic_search` results:
  - `searchEvidence`: +2 if a search result title contains both group1 and group2 terms; +1 if only group2
- Upgrade rules (only upgrade, never downgrade for missing signals):
  - **strongUpgrade**: (group1 >= 1 AND group2 >= 2) OR (group2 >= 3 AND group3 >= 1) → upgrade one level
  - **mediumUpgrade**: group2 >= 2 OR (group1 >= 1 AND group2 >= 1) → upgrade one level
  - **no signal**: keep rule grade unchanged; report "词表命中不足" with low confidence
- `confidence = min(1, (group1Hits + group2Hits + group3Hits + searchEvidence) / 6)`

5. Semantic source tag:
- `standards` — grading based on term hits only
- `standards_with_semantic_search` — grading also used semantic_search evidence

6. Final grade synthesis (synthesizeFinalGrade):
- If rule grade = semantic grade → final = rule grade, no human review needed
- If gap >= 2 levels → final = rule grade, `needs_human_review=true`, reason: `semantic_major_divergence` or `semantic_extreme_divergence`
- If rule=C and semantic=D → final = rule grade, `needs_human_review=true`, reason: `semantic_downgrade_review`
- If gap = 1 level → final = semantic grade, no human review needed
- Upgrade (B→A, C→B) and downgrade (B→C) are auto-adopted without entering human review sheet

7. Output fields per item:
- `rule_grade`: letter from rule-based classifier
- `semantic_grade`: letter from this skill
- `semantic_reason`: Chinese explanation string
- `semantic_confidence`: 0.00–1.00
- `semantic_source`: `standards` or `standards_with_semantic_search`
- `final_grade`: letter from synthesizeFinalGrade
- `needs_human_review`: boolean
- `disagreement_type`: string (empty if no disagreement)

8. Integration with med-daily-triage:
- 三列输出 (规则等级, 语义等级, 最终等级) go into 隔日报.xlsx "每日反馈" sheet
- `needs_human_review=true` items go into "需人工复核" sheet

9. Guardrails:
- Never downgrade an item solely because term hits are zero — insufficient evidence keeps rule grade
- Semantic evidence is supplementary; it cannot override explicit user feedback (see `med-query-learning`)
- All three term groups come from config; skill must not hardcode domain vocabulary
