---
name: med-daily-triage
description: 每日分级与反馈表生成技能。Use when classifying merged papers into A/B/C/D and writing 隔日报.xlsx with clickable dropdown fields and Chinese-first review text.
---

# med-daily-triage

1. Classify merged candidates using rule-based grading:
- `A课题相关`: directly relevant to current core project question.
- `B专题相关`: clearly relevant to subtopic or adjacent topic.
- `C领域相关`: broader field relevance, lower short-term priority.
- `D无关`: low relevance; audit only, never written to Zotero.

2. After rule-based grading, apply semantic grading (see `med-semantic-grading`) for second-pass review.

3. For database-sourced items, apply the journal quality gate backed by `easyscholar` partition/rank information before final writeback. This extra gate is advisory but auditable, and it should only affect database retrieval items, not RSS items.

4. Generate `隔日报.xlsx` with two sheets that do NOT overlap:

**Sheet 1: "每日反馈"**
- Exclude all `D无关` items AND all items where `needs_human_review=true`
- Required columns: `英文标题, 标题翻译, 规则等级, 语义等级, 最终等级, 期刊/来源, 反馈, 评价`
- Three grade columns (规则等级, 语义等级, 最终等级) output only letters A/B/C/D, no explanatory text
- Auto-adopted adjustments (B→A, C→B, B→C) appear here via 规则等级/语义等级/最终等级 but do NOT enter 人工复核

**Sheet 2: "需人工复核"**
- Only items where `needs_human_review=true` (e.g. C→D blocked by policy)
- Additional column: `人工确认等级` for user to fill (A/B/C/D dropdown)
- 规则等级, 语义等级, 最终等级 are read-only evidence

**Invariant**: Sheet1 rows + Sheet2 rows = all ABC items actually written to Zotero that day.

5. Data source rule:
- `desktop_daily_review_source.json` must contain only items from Stage2 `mcp_writeback_summary.writeback_items`
- Stage1 full ABC is the candidate pool, not the 隔日报 data source
- If Stage2 fails/skips, desktop source keeps original full set

6. Clean journal/source display:
- Remove suffixes: `: Latest Articles (...)`, `: Latest Articles`, `: Table of Contents`, ` - Wiley Online Library`, ` - Wiley`, `ScienceDirect Publication:`
- Remove noise values: `Latest Results`, `Wiley`, `Wiley Online Library`, `ScienceDirect`, `ACS Publications`

7. Apply dropdown validation:
- Columns C/D/E (规则等级/语义等级/最终等级): `A,B,C,D`
- Column G (反馈): `keep,drop,upgrade,downgrade`
- Column K in "需人工复核" sheet (人工确认等级): `A,B,C,D`

8. Column mapping notes:
- `反馈` column = renamed from `feedback`
- `评价` column = renamed from `comment`
- Removed columns: 来源等级, 已处理时间, 处理状态, 备注

9. Guardrails:
- Never fabricate dose/time/results/stats.
- If confidence is low, mark review queue instead of asserting evidence.
- Keep stable traceability for A/B items for star migration scanning.
- Integrate feedback-driven tightening (see `med-query-learning`).
- Chinese title must be machine-translated; if translation fails, keep English and log failures in run report.
- Feedback strength is not uniform: `keep` is a no-op for placement, `upgrade` is a positive reinforcement signal, `downgrade` is a weaker negative signal, and `drop` is a stronger negative signal.
