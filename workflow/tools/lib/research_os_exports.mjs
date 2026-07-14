function pyString(value) {
  return JSON.stringify(String(value)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function pyJson(value) {
  return JSON.stringify(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export const DAILY_REVIEW_HEADERS = ["英文标题","标题翻译","规则等级","语义等级","最终等级","期刊/来源","反馈","评价"];

export function buildSkillAlignmentMatrix({
  feedbackLearning = {},
  dailyExport = {},
  weeklyAssets = {},
  zoteroWriteback = {},
} = {}) {
  const queryLearningImplemented = Boolean(feedbackLearning.ok);
  const entryParallelImplemented = Number(dailyExport.rssCount || 0) >= 0 && Number(dailyExport.databaseCount || 0) >= 0 && Number(dailyExport.mergedCount || 0) > 0;
  const triageImplemented = Boolean(dailyExport.excludesD && dailyExport.translationFailuresTracked);
  const monthlyImplemented = Boolean(weeklyAssets.updated);
  const backendOnly = Boolean(zoteroWriteback.backendOnly ?? zoteroWriteback.mcpOnly);
  const zoteroImplemented = Boolean(backendOnly && zoteroWriteback.tagCleanupUsesWriteTag && zoteroWriteback.migrationTracked);

  return [
    {
      skill: "med-query-learning",
      status: queryLearningImplemented ? "implemented" : "missing",
      evidence: queryLearningImplemented
        ? `previous-day feedback rows used: ${feedbackLearning.rows_used || 0}`
        : "previous-day feedback learning unavailable",
    },
    {
      skill: "med-entry-parallel",
      status: entryParallelImplemented ? "implemented" : "partial",
      evidence: `rss=${dailyExport.rssCount || 0}, db=${dailyExport.databaseCount || 0}, merged=${dailyExport.mergedCount || 0}`,
    },
    {
      skill: "med-daily-triage",
      status: triageImplemented ? "implemented" : "partial",
      evidence: `exported=${dailyExport.exportedCount || 0}, excludes_d=${Boolean(dailyExport.excludesD)}, translation_failures_tracked=${Boolean(dailyExport.translationFailuresTracked)}`,
    },
    {
      skill: "med-monthly-synthesis",
      status: monthlyImplemented ? "implemented" : "missing",
      evidence: monthlyImplemented ? "monthly report update chain executed" : "monthly report update chain not executed",
    },
    {
      skill: "med-zotero-bridge",
      status: zoteroImplemented ? "implemented" : "partial",
      evidence: `backend_only=${backendOnly}, write_tag_cleanup=${Boolean(zoteroWriteback.tagCleanupUsesWriteTag)}, migration_tracked=${Boolean(zoteroWriteback.migrationTracked)}`,
    },
  ];
}

export function buildResearchOsExportScript({
  sourcePath,
  desktopRootDir,
  desktopWeekDir,
  desktopDayDir,
  dateStr,
  weekLabel,
  dayLabel,
}) {
  return `
import json
import os
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

source_path = ${pyString(sourcePath)}
desktop_root_dir = ${pyString(desktopRootDir)}
desktop_week_dir = ${pyString(desktopWeekDir)}
desktop_day_dir = ${pyString(desktopDayDir)}
date_str = ${pyString(dateStr)}
week_label = ${pyString(weekLabel)}
day_label = ${pyString(dayLabel)}

os.makedirs(desktop_root_dir, exist_ok=True)
os.makedirs(desktop_week_dir, exist_ok=True)
os.makedirs(desktop_day_dir, exist_ok=True)

with open(source_path, "r", encoding="utf-8") as fh:
    payload = json.load(fh)

triaged = payload.get("triaged", [])
ctx = payload.get("reportContext", {})
feedback = ctx.get("feedbackLearning", {})
translation = ctx.get("translation", {})
connector = ctx.get("connector", {})
counts = ctx.get("counts", {})
failures = ctx.get("failures", [])
skill_alignment = ctx.get("skillAlignment", [])

header_fill = PatternFill("solid", fgColor="1F4E78")
header_font = Font(bold=True, color="FFFFFF")

def apply_header(ws, headers):
    ws.append(headers)
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
    ws.freeze_panes = "A2"

def extract_grade_letter(item, keys):
    import re
    for k in keys:
        raw = str(item.get(k, "")).strip()
        if not raw:
            continue
        m = re.match(r'^[ABCD]', raw, re.IGNORECASE)
        if m:
            return m.group(0).upper()
    return ""

def clean_journal_source(item):
    import re
    # Try each candidate independently: if a field is present but cleans to
    # noise (e.g. "Latest Results", "Example Topic Current Issue"), fall through to
    # the next candidate instead of stopping at the first truthy value.
    candidates = [
        item.get("journal", ""),
        item.get("publicationTitle", ""),
        item.get("container-title", ""),
        item.get("source", ""),
        item.get("source_title", ""),
        item.get("source_platform", ""),
    ]
    noise = {"latest results", "wiley", "wiley online library", "sciencedirect", "acs publications", "example topic current issue"}
    for raw_val in candidates:
        raw = str(raw_val or "").strip()
        if not raw:
            continue
        cleaned = re.sub(r':\s*Latest Articles\s*\(.*?\)\s*$', '', raw, flags=re.IGNORECASE)
        cleaned = re.sub(r':\s*Latest Articles\s*$', '', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r':\s*Table of Contents\s*$', '', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'\s*[-–—]\s*Wiley Online Library\s*$', '', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'\s*[-–—]\s*Wiley\s*$', '', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'^ScienceDirect Publication:\s*', '', cleaned, flags=re.IGNORECASE).strip()
        if cleaned and cleaned.lower() not in noise:
            return cleaned
    return ""

def create_daily_review(rows):
    wb = Workbook()
    ws = wb.active
    ws.title = "每日反馈"
    headers = ["英文标题","标题翻译","规则等级","语义等级","最终等级","期刊/来源","反馈","评价"]
    apply_header(ws, headers)
    for it in rows:
        translated_title = it.get("标题翻译","") or it.get("中文标题","") or it.get("shortTitle","") or it.get("title","")
        rule_grade = extract_grade_letter(it, ["rule_grade", "ruleGrade", "original_grade", "initial_grade", "grade"])
        semantic_grade = extract_grade_letter(it, ["semantic_grade", "semanticGrade"])
        final_grade = extract_grade_letter(it, ["final_grade", "finalGrade", "adjusted_grade", "grade"])
        source = clean_journal_source(it)
        ws.append([
            it.get("title",""),
            translated_title,
            rule_grade,
            semantic_grade,
            final_grade,
            source,
            "",
            "",
        ])
    max_row = max(ws.max_row, 2)
    dv_rule = DataValidation(type="list", formula1='"A,B,C,D"')
    dv_semantic = DataValidation(type="list", formula1='"A,B,C,D"')
    dv_final = DataValidation(type="list", formula1='"A,B,C,D"')
    dv_feedback = DataValidation(type="list", formula1='"keep,drop,upgrade,downgrade"')
    ws.add_data_validation(dv_rule)
    ws.add_data_validation(dv_semantic)
    ws.add_data_validation(dv_final)
    ws.add_data_validation(dv_feedback)
    dv_rule.add(f"C2:C{max_row}")
    dv_semantic.add(f"D2:D{max_row}")
    dv_final.add(f"E2:E{max_row}")
    dv_feedback.add(f"G2:G{max_row}")
    return wb

def save_workbook(wb, file_path):
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    final_path = file_path
    try:
        wb.save(file_path)
    except PermissionError:
        root, ext = os.path.splitext(file_path)
        final_path = f"{root}_new{ext}"
        wb.save(final_path)
    return final_path

def load_or_create(file_path, sheet_name, headers):
    if os.path.exists(file_path):
        wb = load_workbook(file_path)
        if sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
        else:
            ws = wb.create_sheet(sheet_name)
            apply_header(ws, headers)
        return wb, ws
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name
    apply_header(ws, headers)
    return wb, ws

def existing_keys(ws, key_cols):
    out = set()
    for row in ws.iter_rows(min_row=2, values_only=True):
        key = tuple("" if row[idx] is None else str(row[idx]) for idx in key_cols)
        if any(key):
            out.add(key)
    return out

def append_unique_rows(ws, rows, key_cols):
    known = existing_keys(ws, key_cols)
    added = 0
    for row in rows:
        key = tuple("" if row[idx] is None else str(row[idx]) for idx in key_cols)
        if key in known:
            continue
        ws.append(list(row))
        known.add(key)
        added += 1
    return added

daily_review_wb = create_daily_review(triaged)

every_other_day_report = save_workbook(daily_review_wb, os.path.join(desktop_day_dir, "周报.xlsx"))

skill_json_path = os.path.join(os.path.dirname(source_path), "skill_alignment.json")
with open(skill_json_path, "w", encoding="utf-8") as fh:
    json.dump(skill_alignment, fh, ensure_ascii=False, indent=2)

print(json.dumps({
    "every_other_day_report": every_other_day_report,
    "skill_alignment_json": skill_json_path,
}, ensure_ascii=False))
`;
}
