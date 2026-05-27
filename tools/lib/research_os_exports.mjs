function pyString(value) {
  return JSON.stringify(String(value)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function pyJson(value) {
  return JSON.stringify(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export const DAILY_REVIEW_HEADERS = ["英文标题","标题翻译","推荐等级","期刊/来源","来源等级","feedback","comment","已处理时间","处理状态","备注"];

export function buildSkillAlignmentMatrix({
  feedbackLearning = {},
  dailyExport = {},
  weeklyAssets = {},
  zoteroWriteback = {},
} = {}) {
  const queryLearningImplemented = Boolean(feedbackLearning.ok);
  const entryParallelImplemented = Number(dailyExport.rssCount || 0) >= 0 && Number(dailyExport.databaseCount || 0) >= 0 && Number(dailyExport.mergedCount || 0) > 0;
  const triageImplemented = Boolean(dailyExport.excludesD && dailyExport.translationFailuresTracked);
  const weeklyImplemented = Boolean(weeklyAssets.updated);
  const zoteroImplemented = Boolean(zoteroWriteback.mcpOnly && zoteroWriteback.tagCleanupUsesWriteTag && zoteroWriteback.migrationTracked);

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
      skill: "med-weekly-synthesis",
      status: weeklyImplemented ? "implemented" : "missing",
      evidence: weeklyImplemented ? "weekly and root workbook update chain executed" : "weekly/root workbook update chain not executed",
    },
    {
      skill: "med-zotero-bridge",
      status: zoteroImplemented ? "implemented" : "partial",
      evidence: `mcp_only=${Boolean(zoteroWriteback.mcpOnly)}, write_tag_cleanup=${Boolean(zoteroWriteback.tagCleanupUsesWriteTag)}, migration_tracked=${Boolean(zoteroWriteback.migrationTracked)}`,
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

def create_daily_review(rows):
    wb = Workbook()
    ws = wb.active
    ws.title = "每日反馈"
    headers = ["英文标题","标题翻译","推荐等级","期刊/来源","来源等级","feedback","comment","已处理时间","处理状态","备注"]
    apply_header(ws, headers)
    for it in rows:
        translated_title = it.get("标题翻译","") or it.get("中文标题","") or it.get("shortTitle","") or it.get("title","")
        ws.append([
            it.get("title",""),
            translated_title,
            it.get("推荐等级",""),
            ((it.get("journal","") or it.get("source_platform","")).replace("ScienceDirect Publication:","").strip()),
            "abstract_only",
            "",
            "",
            "",
            "待反馈",
            ""
        ])
    max_row = max(ws.max_row, 2)
    dv_grade = DataValidation(type="list", formula1='"A课题相关,B专题相关,C领域相关,D无关"')
    dv_feedback = DataValidation(type="list", formula1='"keep,drop,upgrade,downgrade"')
    dv_status = DataValidation(type="list", formula1='"待反馈,已学习,跳过,需复核"')
    dv_source = DataValidation(type="list", formula1='"metadata_only,abstract_only,pdf_fulltext"')
    ws.add_data_validation(dv_grade)
    ws.add_data_validation(dv_feedback)
    ws.add_data_validation(dv_status)
    ws.add_data_validation(dv_source)
    dv_grade.add(f"C2:C{max_row}")
    dv_source.add(f"E2:E{max_row}")
    dv_feedback.add(f"F2:F{max_row}")
    dv_status.add(f"I2:I{max_row}")
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

every_other_day_report = save_workbook(daily_review_wb, os.path.join(desktop_day_dir, "隔日报.xlsx"))

weekly_headers = ["日期","区块","值","内容","说明","来源等级","备注"]
biweekly_report_path = os.path.join(desktop_week_dir, "双周报.xlsx")
weekly_wb, weekly_ws = load_or_create(biweekly_report_path, "自动双周汇总", weekly_headers)
top_rows = []
for idx, it in enumerate(triaged[:5], start=1):
    top_rows.append((date_str, "Top文献", idx, it.get("title",""), it.get("推荐等级",""), "abstract_only", it.get("中文标题","")))
append_unique_rows(weekly_ws, top_rows or [(date_str, "Top文献", 0, "无导出条目", "", "", "")], (0, 1, 2, 3))
biweekly_report = save_workbook(weekly_wb, biweekly_report_path)

skill_json_path = os.path.join(os.path.dirname(source_path), "skill_alignment.json")
with open(skill_json_path, "w", encoding="utf-8") as fh:
    json.dump(skill_alignment, fh, ensure_ascii=False, indent=2)

print(json.dumps({
    "every_other_day_report": every_other_day_report,
    "biweekly_report": biweekly_report,
    "skill_alignment_json": skill_json_path,
}, ensure_ascii=False))
`;
}
