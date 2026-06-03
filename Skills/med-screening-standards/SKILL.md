---
name: med-screening-standards
description: v1.4 update
---

# med-screening-standards

1. File hierarchy (in `reviewRoot`, default `research_os/文献评价`):
- `screening_standards.md` — the ONLY long-lived preference source (plain text, no markup)
- `screening_standards.docx` — human revision display version (red additions / blue strikethrough)
- `screening_standards.backup.docx` — at most one backup, overwritten on each run
- `.screening_standards.last_synced.md` — snapshot at last sync for change detection
- `standards_rule_suggestions_log.json` — persistent log of all rule suggestions

2. screening_standards.md structure:
- Title / preamble: configured scope definition
- `## 优先关注` — positive preferences (upgrade signals)
- `## 降权` — negative preferences (downgrade signals)
- `## 严格排除` — hard exclude rules
- `## 不确定` — uncertain boundaries
- `## 注意事项` — caveats

3. Docx sync (syncScreeningStandardsDocx):
- Rebuilds docx from scratch on each run
- Current additions displayed in red text
- Current deletions displayed in blue strikethrough
- Before overwriting, create backup as `screening_standards.backup.docx` (overwrite previous backup)
- Preserve unknown user content in visible "用户保留内容 / Preserved User Content" section
- Pass `suggestionsLogPath` so latest suggestions appear in docx table immediately

4. Change detection:
- Compare current md with `.screening_standards.last_synced.md`
- Generate change markup: additions count, deletions count
- Write audit fields: `screening_standards_change_markup_applied`, `screening_standards_additions_count`, `screening_standards_deletions_count`

5. Rule suggestion workflow:
- **Trigger**: feedback evidence_count >= 2 OR explicit human evaluation text
- **Types**: `hard_exclude`, `positive_preference`, `negative_preference`
- **hard_exclude** suggestions default to `requires_manual_review=true`
- **Status handling** in "待确认规则建议" table:
  - `pending` / `待定`: no effect on md, no classifyItem impact
  - `accept` / `接受`: write suggested rule to md formal rules section
  - `reject` / `拒绝`: no md write; record rejected to prevent duplicate suggestions
  - `revise` / `修改`: write revised rule to md; if empty, warn and skip
  - Unknown non-empty status: warn, skip, do not treat as pending
- **Pending suggestions (including pending hard_exclude) must NOT affect classifyItem**
- Only accepted/revised suggestions synced to md affect classification
- Suggestions must be deduplicated against existing md rules and existing docx suggestions

6. Consumable workspaces:
- The "评价" (evaluation) area in docx is a consumable workspace: after processing, clear evaluation text
- The "待确认规则建议" (Pending Rule Suggestions) table is consumable: after processing, keep only unresolved pending suggestions
- Suggestions with status accepted/rejected/revise or with `processed_at` must not be written back into next docx round

7. Parse function (parseScreeningStandards):
- Reads md content and returns structured object:
  - `topic_definition`: preamble text
  - `hard_excludes`: array of {rule, keywords, section}
  - `positive_preferences`: array of {rule, keywords, section}
  - `negative_preferences`: array of {rule, keywords, section}
  - `grade_rules`: {exclude_rules, downgrade_rules, priority_rules}
  - `warnings`: from uncertain section
  - `caveats`: from caveats section
- Implementation: `workflow_classifier.mjs` → `parseScreeningStandards()` and `loadScreeningStandards()`

8. Normalization on load:
- Before using standards file, normalize previous display markup: red additions become plain text; blue strikethrough deletions are removed
- If file missing, initialize with Chinese baseline standard and continue

9. Guardrails:
- Never fabricate rules without evidence (evidence_count >= 2 or explicit human text)
- Never overwrite real screening_standards.docx in tests; use temp files
- Do not write unbounded timestamped backups; at most one fixed backup file
- screening_standards.md is the only source of truth; docx is a display artifact
