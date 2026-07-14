import fs from "node:fs";
import path from "node:path";

export const SCREENING_STANDARDS_FILE_NAME = "screening_standards.md";
export const SCREENING_STANDARDS_DOCX_FILE_NAME = "screening_standards.docx";
export const SCREENING_STANDARDS_LAST_SYNCED_FILE_NAME = ".screening_standards.last_synced.md";
export const SCREENING_STANDARDS_BACKUP_FILE_NAME = "screening_standards.backup.docx";
export const SCREENING_STANDARDS_BEFORE_LLM_REFINE_BACKUP_FILE_NAME = "screening_standards.before_llm_refine.docx";

export const SCREENING_STANDARDS_SOURCE_NAME = "screening_standards_md";

export const INITIAL_SCREENING_STANDARDS_ZH = `# 文献筛选标准

请根据自己的研究问题替换以下公开示例。该模板不包含任何预设研究方向。

---

## 优先关注

* <YOUR_SCREENING_CRITERIA>
* Example priority rule for a fully fictional research topic.

---

## 相对降权

* Example downgrade rule for weak or indirect evidence.

---

## 严格排除

* Example exclusion rule for records outside <YOUR_RESEARCH_TOPIC>.

---

## 不确定边界

* Example ambiguous boundary requiring more feedback.

---

## 注意事项

* 单条反馈只作为证据，不应直接成为稳定规则。
* 排除和降权规则应保留适用范围与例外条件。
`;

export function screeningStandardsPath(reviewRoot) {
  return path.join(reviewRoot, SCREENING_STANDARDS_FILE_NAME);
}

export function screeningStandardsDocxPath(reviewRoot) {
  return path.join(reviewRoot, SCREENING_STANDARDS_DOCX_FILE_NAME);
}

export function ruleSuggestionsLogPath(reviewRoot) {
  return path.join(reviewRoot, "standards_rule_suggestions_log.json");
}

export function screeningStandardsLastSyncedPath(reviewRoot) {
  return path.join(reviewRoot, SCREENING_STANDARDS_LAST_SYNCED_FILE_NAME);
}


function stripRedAdditionMarkup(text) {
  return String(text || "").replace(/<span\s+style=["'][^"']*color\s*:\s*#?ff0000[^"']*["']\s*>([\s\S]*?)<\/span>/gi, "$1");
}

function removeBlueDeletionMarkup(text) {
  return String(text || "")
    .replace(/^\s*<span\s+style=["'][^"']*color\s*:\s*#?0000ff[^"']*["']\s*>\s*(?:<s>|<del>)[\s\S]*?(?:<\/s>|<\/del>)\s*<\/span>\s*$/gim, "")
    .replace(/^\s*(?:<s>|<del>)\s*<span\s+style=["'][^"']*color\s*:\s*#?0000ff[^"']*["']\s*>[\s\S]*?<\/span>\s*(?:<\/s>|<\/del>)\s*$/gim, "");
}

export function collapseBlankLines(text) {
  return String(text || "").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function cleanScreeningStandardsMarkdown(markdown) {
  return collapseBlankLines(
    stripRedAdditionMarkup(removeBlueDeletionMarkup(markdown))
      .replace(/\n?## 本轮学习标注（[^）]+）[\s\S]*?(?=\n## |\n# |\s*$)/g, "\n")
      .replace(/当前稳定筛选标准有限，以下为暂定理解。\s*/g, ""),
  );
}

export async function ensureScreeningStandardsFile(reviewRoot) {
  const filePath = screeningStandardsPath(reviewRoot);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    await fs.promises.writeFile(filePath, INITIAL_SCREENING_STANDARDS_ZH, "utf8");
    return { path: filePath, created: true };
  }
  return { path: filePath, created: false };
}

export async function readScreeningStandardsFile(reviewRoot, { normalize = true } = {}) {
  const ensured = await ensureScreeningStandardsFile(reviewRoot);
  const before = await fs.promises.readFile(ensured.path, "utf8");
  const cleaned = cleanScreeningStandardsMarkdown(before);
  const cleanedChanged = normalize && cleaned !== before;
  if (cleanedChanged) await fs.promises.writeFile(ensured.path, cleaned, "utf8");
  return {
    path: ensured.path,
    created: ensured.created,
    loaded: true,
    cleaned: cleanedChanged,
    content: cleanedChanged ? cleaned : before,
    source_name: SCREENING_STANDARDS_SOURCE_NAME,
  };
}

export function readScreeningStandardsFileSync(reviewRoot, { normalize = true } = {}) {
  const filePath = screeningStandardsPath(reviewRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let created = false;
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, INITIAL_SCREENING_STANDARDS_ZH, "utf8");
    created = true;
  }
  const before = fs.readFileSync(filePath, "utf8");
  const cleaned = cleanScreeningStandardsMarkdown(before);
  const cleanedChanged = normalize && cleaned !== before;
  if (cleanedChanged) fs.writeFileSync(filePath, cleaned, "utf8");
  return {
    path: filePath,
    created,
    loaded: true,
    cleaned: cleanedChanged,
    content: cleanedChanged ? cleaned : before,
    source_name: SCREENING_STANDARDS_SOURCE_NAME,
  };
}
