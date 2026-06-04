import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  buildPubMedQueryFromKeywordGroups,
  loadPubMedKeywordGroupsFromConfig,
  normalizePubMedKeywordGroups,
  updatePubMedPmcKeywordGroups,
} from "./literature_config.mjs";
import {
  getPreferenceLearningConfig,
  understandPreferenceEvaluation,
} from "./preference_learning_support.mjs";

export const SCREENING_STANDARDS_FILE_NAME = "screening_standards.md";
export const SCREENING_STANDARDS_DOCX_FILE_NAME = "screening_standards.docx";
export const SCREENING_STANDARDS_LAST_SYNCED_FILE_NAME = ".screening_standards.last_synced.md";
const SCREENING_STANDARDS_BACKUP_FILE_NAME = "screening_standards.backup.docx";

export const SCREENING_STANDARDS_SOURCE_NAME = "screening_standards_md";

export const INITIAL_SCREENING_STANDARDS_ZH = `# 文献筛选标准

当前优先关注机制研究、动物或细胞实验相关证据，并对低相关性的人群队列或范围外研究降权。

---

## 优先关注

* 优先关注动物实验，尤其是哺乳动物疾病模型（如小鼠、大鼠等）、体外实验、机制研究和基础机制研究场景。
* 优先关注涉及神经生物学、神经炎症、小胶质细胞、神经元-胶质细胞相互作用、突触调控或相关神经系统通路的机制研究。
* 优先关注多组学机制研究（如转录组学、蛋白质组学、代谢组学、单细胞组学、空间组学、整合组学分析），尤其是与疾病机制相关并有实验验证支持的研究。
* 优先关注补体系统相关研究、补体激活通路、补体介导的神经炎症、免疫调控机制或神经免疫相互作用。
* 优先关注肠道菌群或微生物组相关研究，尤其是涉及疾病机制、宿主-微生物相互作用、神经免疫调控、代谢、肠-脑轴、多组学整合或实验验证的研究。
* 非哺乳动物模型中，斑马鱼研究优先级高于其他非哺乳动物模型。
* 即使不属于神经领域，只要机制深度强、生物学信息量高或具有广泛可转化意义，也优先关注探索性或基础机制研究。

---

## 相对降权

* 降权缺乏机制深度的人群队列研究、流行病学关联研究、大型观察性结局研究或纯临床结局导向研究。
* 降权肾脏结局研究和以肾脏为中心的临床结局场景，除非其直接关联更广泛关注的机制问题。
* 降权植物生物学、植物组学或植物机制研究，即使使用了多组学方法。
* 降权斑马鱼以外的非哺乳动物研究（如果蝇、线虫、酵母、昆虫单一模型等），除非其机制洞见特别突出。
* 降权缺乏机制洞见、细胞验证、动物建模或功能实验的纯描述性临床研究。
* 降权缺乏功能验证或机制解释的大规模组学关联研究。
* 降权没有可迁移机制相关性的非医学或无关疾病背景研究。

---

## 严格排除

* 排除缺乏直接生物医学机制相关性的纯工程、计算工程、材料科学、物理学、电子、机械工程或无关技术/工业研究。
* 排除没有实质性生物学或疾病机制洞见的纯方法学 AI、算法或工具开发论文。
* 排除没有实验或机制性生物学相关性的非生物医学系统工程或理论建模研究。

---

## 不确定边界

* 对缺乏机制验证的纯临床神经科学结局研究，目前反馈存在冲突；用于分级前需要继续细化边界。
* 对缺乏功能验证的大规模组学关联研究，目前反馈存在冲突；用于分级前需要继续细化边界。
* 对机制深度较强但不属于神经领域的研究，目前反馈存在冲突；用于分级前需要继续细化边界。
* 对仅使用斑马鱼模型的机制研究，目前反馈存在冲突；用于分级前需要继续细化边界。
* 对神经炎症语境之外的补体相关研究，目前反馈存在冲突；用于分级前需要继续细化边界。
* 对缺乏机制或实验验证的微生物组关联研究，目前反馈存在冲突；用于分级前需要继续细化边界。

---

## 注意事项

* 对人群队列或临床结局研究的降权仅适用于纯观察性或机制较弱的场景，不应泛化到整个主题。
* 只有当组学分析提供有意义的机制洞见，而不只是描述性谱系分析时，才优先关注多组学研究。
* 如果机制相关性强，神经或小胶质细胞研究可跨疾病领域广泛优先关注。
* 只有当微生物组研究涉及生物学机制、宿主相互作用、免疫调控、代谢或实验验证时，才优先关注。
* 对非哺乳动物模型的降权仅适用于机制相关性较弱的场景；机制洞见特别突出的研究仍可纳入。
* 植物研究原则上广泛降权，不因使用组学方法而提高优先级，除非其直接关联保守的生物医学机制。
* 工程导向研究只有在具有明确的生物医学机制可解释性或疾病相关性时才可避免严格排除。
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

async function backupDocx(docxPath) {
  if (!fs.existsSync(docxPath)) return null;
  const backupPath = path.join(path.dirname(docxPath), SCREENING_STANDARDS_BACKUP_FILE_NAME);
  await fs.promises.copyFile(docxPath, backupPath);
  return backupPath;
}

function defaultPubmedConfigPath(reviewRoot) {
  return path.join(path.dirname(path.dirname(reviewRoot)), "config", "pubmed_pmc_search.json");
}

function stripRedAdditionMarkup(text) {
  return String(text || "").replace(/<span\s+style=["'][^"']*color\s*:\s*#?ff0000[^"']*["']\s*>([\s\S]*?)<\/span>/gi, "$1");
}

function removeBlueDeletionMarkup(text) {
  return String(text || "")
    .replace(/^\s*<span\s+style=["'][^"']*color\s*:\s*#?0000ff[^"']*["']\s*>\s*(?:<s>|<del>)[\s\S]*?(?:<\/s>|<\/del>)\s*<\/span>\s*$/gim, "")
    .replace(/^\s*(?:<s>|<del>)\s*<span\s+style=["'][^"']*color\s*:\s*#?0000ff[^"']*["']\s*>[\s\S]*?<\/span>\s*(?:<\/s>|<\/del>)\s*$/gim, "");
}

function collapseBlankLines(text) {
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

// ─── Rule Suggestion Engine ──────────────────────────────────────────────

import { createHash } from "node:crypto";

function normalizeRuleForDedup(rule) {
  return String(rule || "").toLowerCase().replace(/[\s\u3000]+/g, " ").replace(/[.,;:·。、；：]+$/g, "").trim();
}

function ruleHash(rule) {
  return createHash("sha1").update(normalizeRuleForDedup(rule)).digest("hex").slice(0, 12);
}

function generateSuggestionId(generatedAt) {
  const d = new Date(generatedAt || Date.now());
  const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const r = String(Math.floor(Math.random() * 900) + 100);
  return `SUG-${ds}-${r}`;
}

export async function loadRuleSuggestionsLog(logPath) {
  try { return JSON.parse(await fs.promises.readFile(logPath, "utf8")); } catch { return { suggestions: [] }; }
}

export async function writeRuleSuggestionsLog(logPath, log) {
  await fs.promises.writeFile(logPath, JSON.stringify(log, null, 2) + "\n", "utf8");
}

function dedupSuggestions(suggestions, existingContent, log) {
  const existingNorms = new Set();
  for (const rule of (existingContent || "").split("\n").map((l) => l.replace(/^\*\s*/, "").trim()).filter(Boolean)) {
    const norm = normalizeRuleForDedup(rule);
    if (norm.length >= 4) existingNorms.add(norm);
  }
  const seenHashes = new Set((log.suggestions || []).map((s) => s.suggestion_hash));
  const out = [];
  for (const s of suggestions) {
    const hash = s.suggestion_hash || ruleHash(s.suggested_rule);
    s.suggestion_hash = hash;
    if (seenHashes.has(hash)) continue;
    if (existingNorms.has(normalizeRuleForDedup(s.suggested_rule))) continue;
    seenHashes.add(hash);
    out.push(s);
  }
  return out;
}

function getTopicPattern(tag) {
  return tag;
}

export function generateRuleSuggestionsFromFeedback({ feedbackSignals = [], feedbackSource = "", standardsContent = "", screeningStandards = null, existingSuggestionsLog = null, generatedAt } = {}) {
  const suggestions = [];
  if (!feedbackSignals.length) return { suggestions, reason: "no_feedback_signals" };

  const hardExcludes = screeningStandards?.hard_excludes || [];
  const positivePrefs = screeningStandards?.positive_preferences || [];
  const negativePrefs = screeningStandards?.negative_preferences || [];
  const existingRuleTexts = [...hardExcludes, ...positivePrefs, ...negativePrefs].map((r) => normalizeRuleForDedup(r.rule || r));

  const negativeSignals = feedbackSignals.filter((s) => s.feedback === "drop" || s.feedback === "downgrade");
  const positiveSignals = feedbackSignals.filter((s) => s.feedback === "keep" || s.feedback === "upgrade");

  // Lightweight topic matching since signals may not include topic_tags
  const topicPatterns = [
    { tag: "animal study", pattern: /\banimal\b|mouse|mice|rat\b|rats\b|zebrafish|小鼠|大鼠|斑马鱼/i },
    { tag: "in vitro", pattern: /\bin vitro\b|cell line|细胞/i },
    { tag: "mechanism", pattern: /\bmechanis|pathway|signaling|通路|机制/i },
    { tag: "clinical outcome", pattern: /\bpatient|clinical outcome|人群|临床结局/i },
    { tag: "omics", pattern: /\bomics\b|transcriptom|proteom|metabolom|单细胞|组学/i },
    { tag: "plant", pattern: /\bplant\b|植物/i },
    { tag: "non-mammal", pattern: /\binsect\b|nematode|线虫|昆虫|酵母|果蝇/i },
    { tag: "engineering", pattern: /\bengineering\b|材料科学|电子|机械/i },
    { tag: "AI/algorithm", pattern: /\bartificial intelligence\b|\bAI\b|algorithm|算法/i },
  ];

  function matchTopics(text) {
    const haystack = String(text || "");
    return topicPatterns.filter((p) => p.pattern.test(haystack)).map((p) => p.tag);
  }

  // Aggregate negative topic tags
  const negTagCounts = {};
  const negTagTitles = {};
  for (const s of negativeSignals) {
    const text = `${s.title_context || ""} ${s.english_title || ""} ${s.comment || ""}`;
    const tags = matchTopics(text);
    for (const tag of tags) {
      negTagCounts[tag] = (negTagCounts[tag] || 0) + 1;
      negTagTitles[tag] = negTagTitles[tag] || [];
      if (negTagTitles[tag].length < 3 && s.english_title) negTagTitles[tag].push(s.english_title);
    }
  }

  for (const [tag, count] of Object.entries(negTagCounts)) {
    if (count < 2) continue;
    const normalizedTag = normalizeRuleForDedup(tag);
    if (existingRuleTexts.some((r) => r.includes(normalizedTag))) continue;
    const confidence = count >= 4 ? "medium" : "low";
    const ruleText = `降权${tag}相关研究，除非具有突出机制深度或与当前课题直接相关`;
    suggestions.push({
      suggestion_id: generateSuggestionId(generatedAt),
      action: "add",
      type: "negative_preference",
      suggested_rule: ruleText,
      evidence_count: count,
      example_items: negTagTitles[tag] || [],
      confidence,
      status: "pending",
      revised_rule: "",
      requires_manual_review: false,
      reason: `基于${count}条 drop/downgrade 反馈的聚合`,
      suggestion_hash: ruleHash(ruleText),
      generated_at: generatedAt,
      feedback_source: feedbackSource,
    });
  }

  // Aggregate hard_exclude suggestions from strong negative signals
  const hardExcludeStrongTags = new Set(["engineering", "AI/algorithm", "plant", "non-mammal"]);
  const exclusionWords = /排除|exclude|irrelevant|无关|与课题无关|完全不相关|不应纳入|不应该/i;
  for (const [tag, count] of Object.entries(negTagCounts)) {
    if (count < 3) continue;
    const normalizedTag = normalizeRuleForDedup(tag);
    if (existingRuleTexts.some((r) => r.includes(normalizedTag))) continue;
    const isStrongExclusionTag = hardExcludeStrongTags.has(tag);
    const hasExclusionLanguage = (negTagTitles[tag] || []).some((t) => exclusionWords.test(t));
    if (!isStrongExclusionTag && !hasExclusionLanguage) continue;
    const ruleText = `排除${tag}相关研究，除非具有直接生物医学机制相关性或疾病相关性`;
    suggestions.push({
      suggestion_id: generateSuggestionId(generatedAt),
      action: "add",
      type: "hard_exclude",
      suggested_rule: ruleText,
      evidence_count: count,
      example_items: negTagTitles[tag] || [],
      confidence: count >= 5 ? "medium" : "low",
      status: "pending",
      revised_rule: "",
      requires_manual_review: true,
      reason: `基于${count}条 drop/downgrade 反馈聚合，建议严格排除；需人工确认`,
      suggestion_hash: ruleHash(ruleText),
      generated_at: generatedAt,
      feedback_source: feedbackSource,
    });
  }
  // Aggregate positive topic tags
  const posTagCounts = {};
  const posTagTitles = {};
  for (const s of positiveSignals) {
    const text = `${s.title_context || ""} ${s.english_title || ""} ${s.comment || ""}`;
    const tags = matchTopics(text);
    for (const tag of tags) {
      posTagCounts[tag] = (posTagCounts[tag] || 0) + 1;
      posTagTitles[tag] = posTagTitles[tag] || [];
      if (posTagTitles[tag].length < 3 && s.english_title) posTagTitles[tag].push(s.english_title);
    }
  }

  for (const [tag, count] of Object.entries(posTagCounts)) {
    if (count < 3) continue;
    const normalizedTag = normalizeRuleForDedup(tag);
    if (existingRuleTexts.some((r) => r.includes(normalizedTag))) continue;
    const ruleText = `优先关注${tag}相关研究`;
    suggestions.push({
      suggestion_id: generateSuggestionId(generatedAt),
      action: "add",
      type: "positive_preference",
      suggested_rule: ruleText,
      evidence_count: count,
      example_items: posTagTitles[tag] || [],
      confidence: count >= 5 ? "medium" : "low",
      status: "pending",
      revised_rule: "",
      requires_manual_review: false,
      reason: `基于${count}条 keep/upgrade 反馈的聚合`,
      suggestion_hash: ruleHash(ruleText),
      generated_at: generatedAt,
      feedback_source: feedbackSource,
    });
  }

  const deduped = dedupSuggestions(suggestions, standardsContent, existingSuggestionsLog || { suggestions: [] });
  return { suggestions: deduped, reason: deduped.length ? "suggestions_generated" : "no_actionable_suggestions" };
}

export async function processUserSuggestionDecisions(parsedDocx, { reviewRoot, logPath } = {}) {
  const resolvedLogPath = logPath || ruleSuggestionsLogPath(reviewRoot);
  const log = await loadRuleSuggestionsLog(resolvedLogPath);
  const decisions = [];

  // Use suggestions_table directly from parsed docx
  const rows = Array.isArray(parsedDocx?.suggestions_table) ? parsedDocx.suggestions_table : [];
  if (rows.length > 1) {
    const headers = rows[0].map((c) => String(c || "").trim());
    const statusCol = headers.findIndex((h) => h === "状态");
    if (statusCol >= 0) {
      const ruleCol = headers.findIndex((h) => h === "建议规则");
      const revisedCol = headers.findIndex((h) => h === "修订后规则");
      const idCol = headers.findIndex((h) => h === "建议ID");
      for (const row of rows.slice(1)) {
      const result = normalizeSuggestionStatus(row[statusCol]);
      const suggestionId = idCol >= 0 ? String(row[idCol] || "").trim() : "";
      if (result.unknown) {
        const existing = log.suggestions.find((s) => s.suggestion_id === suggestionId);
        if (existing) {
          existing.process_warnings = existing.process_warnings || [];
          existing.process_warnings.push(`unknown_status:${result.original}`);
        }
        continue;
      }
      if (!result.status || result.status === "pending") continue;
      const suggestedRule = ruleCol >= 0 ? String(row[ruleCol] || "").trim() : "";
      const revisedRule = revisedCol >= 0 ? String(row[revisedCol] || "").trim() : "";
      const existing = log.suggestions.find((s) => s.suggestion_id === suggestionId && s.status === "pending");
      if (!existing) continue;
      if (result.status === "accept") {
        existing.status = "accepted";
        existing.processed_at = new Date().toISOString();
        decisions.push({ type: "accept", rule: suggestedRule, source: suggestionId });
      } else if (result.status === "reject") {
        existing.status = "rejected";
        existing.processed_at = new Date().toISOString();
      } else if (result.status === "revise") {
        if (!revisedRule) { existing.process_warnings = existing.process_warnings || []; existing.process_warnings.push("revise_but_revised_rule_empty"); continue; }
        existing.status = "revised";
        existing.revised_rule = revisedRule;
        existing.processed_at = new Date().toISOString();
        decisions.push({ type: "revise", rule: revisedRule, source: suggestionId });
      }
    }
    }
  }
  await writeRuleSuggestionsLog(resolvedLogPath, log);
  return { decisions, log };
}

export function syncSuggestionsToScreeningStandardsMd(currentContent, decisions) {
  if (!decisions.length) return { content: currentContent, added: 0, skippedDuplicate: 0 };
  let content = currentContent;
  let added = 0;
  let skippedDuplicate = 0;
  const sections = content.split(/(?=\n## )/);
  const priorityIdx = sections.findIndex((s) => s.includes("## 优先关注"));
  const downrankIdx = sections.findIndex((s) => s.includes("## 相对降权"));
  const excludeIdx = sections.findIndex((s) => s.includes("## 严格排除"));
  const insertIdx = downrankIdx >= 0 ? downrankIdx : excludeIdx >= 0 ? excludeIdx : sections.length - 1;
  for (const decision of decisions) {
    const ruleText = String(decision.rule || "").trim();
    if (!ruleText) continue;
    if (normalizeRuleForDedup(content).includes(normalizeRuleForDedup(ruleText))) { skippedDuplicate++; continue; }
    const isExclude = /排除|exclude|禁止/i.test(ruleText);
    const isPriority = /优先关注|优先纳入|prefer/i.test(ruleText);
    if (isExclude && excludeIdx >= 0) {
      sections[excludeIdx] = sections[excludeIdx].trimEnd() + `\n* ${ruleText}\n`;
    } else if (isPriority && priorityIdx >= 0) {
      sections[priorityIdx] = sections[priorityIdx].trimEnd() + `\n* ${ruleText}\n`;
    } else if (downrankIdx >= 0) {
      sections[downrankIdx] = sections[downrankIdx].trimEnd() + `\n* ${ruleText}\n`;
    } else {
      sections[insertIdx] = sections[insertIdx].trimEnd() + `\n* ${ruleText}\n`;
    }
    added++;
  }
  return { content: collapseBlankLines(sections.join("")), added, skippedDuplicate };
}

function normalizeSuggestionStatus(raw) {
  const original = String(raw || "").trim();
  const s = original.toLowerCase();
  const aliases = { "接受": "accept", "拒绝": "reject", "修改": "revise", "待定": "pending" };
  if (["pending", "accept", "reject", "revise"].includes(s)) return { status: s, unknown: false, original };
  if (aliases[s]) return { status: aliases[s], unknown: false, original };
  if (!original) return { status: "", unknown: false, original };
  return { status: "", unknown: true, original };
}

function standardSummaryToLines(summary = {}) {
  return [
    summary.one_sentence_summary,
    summary.priority_summary ? `优先关注：${summary.priority_summary}` : "",
    summary.downrank_summary ? `相对降权：${summary.downrank_summary}` : "",
    summary.uncertain_boundaries ? `不确定边界：${summary.uncertain_boundaries}` : "",
    summary.caveats ? `注意事项：${summary.caveats}` : "",
  ].map((line) => String(line || "").trim()).filter(Boolean);
}

function redLine(line) {
  return `<span style="color:#FF0000">${line}</span>`;
}

function blueDeletedLine(line) {
  return `<span style="color:#0000FF"><s>${line}</s></span>`;
}

function escapeXml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function makeCrc32Table() {
  const table = [];
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = makeCrc32Table();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const b of buffer) c = CRC32_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(dosTime, 12);
    dir.writeUInt16LE(dosDate, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuf, end]);
}

function lineDiff(previousText, currentText) {
  const previous = String(previousText || "").replace(/\r\n/g, "\n").split("\n");
  const current = String(currentText || "").replace(/\r\n/g, "\n").split("\n");
  if (previous.at(-1) === "") previous.pop();
  if (current.at(-1) === "") current.pop();
  const dp = Array.from({ length: previous.length + 1 }, () => Array(current.length + 1).fill(0));
  for (let i = previous.length - 1; i >= 0; i -= 1) {
    for (let j = current.length - 1; j >= 0; j -= 1) {
      dp[i][j] = previous[i] === current[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < previous.length || j < current.length) {
    if (i < previous.length && j < current.length && previous[i] === current[j]) {
      out.push({ type: "same", text: current[j] });
      i += 1;
      j += 1;
    } else if (j < current.length && (i >= previous.length || dp[i][j + 1] >= dp[i + 1][j])) {
      out.push({ type: "add", text: current[j] });
      j += 1;
    } else {
      out.push({ type: "delete", text: previous[i] });
      i += 1;
    }
  }
  return out;
}

function paragraphXml(part) {
  const style = part.style === "Heading1" || String(part.text || "").startsWith("#") ? '<w:pStyle w:val="Heading1"/>' : "";
  const text = String(part.text || "").replace(/^#+\s*/, "");
  const color = part.type === "add" ? '<w:color w:val="FF0000"/>' : part.type === "delete" ? '<w:color w:val="0000FF"/><w:strike/>' : "";
  const runProps = color ? `<w:rPr>${color}</w:rPr>` : "";
  return `<w:p><w:pPr>${style}</w:pPr><w:r>${runProps}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function tableXml(rows = []) {
  const rowXml = rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2200"/><w:gridCol w:w="3800"/><w:gridCol w:w="3000"/></w:tblGrid>${rowXml}</w:tbl>`;
}

function suggestionsTableXml(suggestions = []) {
  const headers = ["建议ID", "类型", "建议规则", "证据", "置信度", "状态", "修订后规则", "备注"];
  const colWidths = [1300, 1000, 3500, 1800, 700, 900, 3000, 1200];
  const gridCols = colWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join("");
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  const wrapCell = (text, width, bold = false) => {
    const rPr = bold ? "<w:rPr><w:b/></w:rPr>" : "";
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:textWrapping w:wrap="tight"/></w:tcPr><w:p><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
  };
  const headerRow = `<w:tr>${headers.map((h, i) => wrapCell(h, colWidths[i], true)).join("")}</w:tr>`;
  const dataRows = suggestions.map((s) => {
    const evidenceCount = s.evidence_count ? `(${s.evidence_count}条)` : "";
    const evidence = evidenceCount;
    const cells = [s.suggestion_id || "", s.type || "", s.suggested_rule || "", evidence, s.confidence || "", s.status || "pending", s.revised_rule || "", s.reason || ""];
    return `<w:tr>${cells.map((cell, i) => wrapCell(cell, colWidths[i])).join("")}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${totalWidth}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${gridCols}</w:tblGrid>${headerRow}${dataRows}</w:tbl>`;
}

function buildDocxBuffer(parts, { unknownBlocks = [] } = {}) {
  const managedContent = parts.map((part) => part.kind === "suggestions_table" ? suggestionsTableXml(part.rows) : part.kind === "table" ? tableXml(part.rows) : paragraphXml(part)).join("");
  let preservedContent = "";
  if (unknownBlocks.length) {
    const preservedHeading = paragraphXml({ text: "用户保留内容 / Preserved User Content", style: "Heading1" });
    const preservedNote = paragraphXml({ text: "以下内容来自上一次 docx 中系统未识别的区域，已保留；请人工确认是否需要迁移到人工评价区或待确认规则建议表格。" });
    const preservedBlocks = unknownBlocks.map((block) => {
      const textMatch = block.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
      if (textMatch) {
        const text = textMatch.map((m) => m.replace(/<[^>]+>/g, "")).join("");
        return paragraphXml({ text });
      }
      return "";
    }).filter(Boolean);
    preservedContent = preservedHeading + preservedNote + preservedBlocks.join("");
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${managedContent}${preservedContent}<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`;
  return zipStore([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/document.xml", content: documentXml },
    { name: "word/styles.xml", content: stylesXml },
  ]);
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function keywordRows(keywordGroups = {}) {
  const groups = keywordGroups || {};
  return [
    ["类别", "英文关键词/短语", "说明"],
    ["核心必须词", (groups.required || []).map((group) => (group || []).join("; ")).join(" | "), "组内 OR，组间 AND"],
    ["可选扩展词", (groups.optional || []).join("; "), "用于维护偏好，不进入硬性 PubMed 查询"],
    ["排除词", (groups.negative || []).join("; "), "生成 NOT (...)"],
  ];
}

function buildDocxParts({ previousText, currentText, keywordGroups, evaluationText, suggestions = [] }) {
  const diffParts = lineDiff(previousText, currentText).filter((part) => String(part.text || "").trim());
  const hasChanges = diffParts.some((p) => p.type === "add" || p.type === "delete") || suggestions.length > 0;
  const formatNotes = hasChanges ? [
    { text: "格式说明 / Format Notes", style: "Heading1" },
    { text: "• 黑色 / Black：已生效且本轮未变化的正式规则 / Active rule unchanged in this run" },
    { text: "• 红色 / Red：本轮新增或修改并已生效的正式规则 / Newly added or revised active rule in this run" },
    { text: "• 蓝色+删除线 / Blue+strikethrough：本轮删除或退休的规则 / Removed or retired rule in this run" },
    { text: "• 待确认建议是否生效只看\"状态\"列，不看颜色 / Rule suggestions are applied only according to the Status column, not by text color" },
    { text: "• Word 下拉不可用时，状态列可手动填写：pending/待定、accept/接受、reject/拒绝、revise/修改 / If Word dropdown is unavailable, manually enter one of the bilingual status values" },
  ] : [];
  const parts = [
    ...formatNotes,
    { text: "偏好规则", style: "Heading1" },
    ...diffParts,
    { text: "检索关键词", style: "Heading1" },
    { kind: "table", rows: keywordRows(keywordGroups) },
    { text: `PubMed query preview: ${buildPubMedQueryFromKeywordGroups(keywordGroups)}` },
    { text: "评价", style: "Heading1" },
    { text: "对偏好学习的意见可写在此处 / Comments on preference learning can be written here" },
    { text: "" },
    ...String(evaluationText || "").split(/\r?\n/).map((line) => ({ text: line })).filter((part) => String(part.text || "").trim()),
  ];
  parts.push({ text: "待确认规则建议 / Pending Rule Suggestions", style: "Heading1" });
  if (suggestions.length) {
    parts.push({ text: "状态选项 / Status options：pending/待定、accept/接受、reject/拒绝、revise/修改" });
    parts.push({ kind: "suggestions_table", rows: suggestions });
  } else {
    parts.push({ text: "本次暂无待确认规则建议 / No pending rule suggestions in this run" });
  }
  return parts;
}

export async function syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath = "", evaluationText = null, previousText = null, suggestions = [], suggestionsLogPath = null } = {}) {
  const current = await readScreeningStandardsFile(reviewRoot);
  const snapshotPath = screeningStandardsLastSyncedPath(reviewRoot);
  const docxPath = screeningStandardsDocxPath(reviewRoot);
  let previous = previousText ?? current.content;
  if (fs.existsSync(snapshotPath)) {
    previous = await fs.promises.readFile(snapshotPath, "utf8");
  }
  const resolvedPubmedConfigPath = pubmedConfigPath || defaultPubmedConfigPath(reviewRoot);
  const pubmedConfig = readJsonIfExists(resolvedPubmedConfigPath);
  let keywordGroups = loadPubMedKeywordGroupsFromConfig(pubmedConfig);

  // Fallback: if config keywords are empty, read from existing docx
  const hasRealKeywords = (keywordGroups.required || []).some((g) => g.length > 0) || (keywordGroups.optional || []).length > 0 || (keywordGroups.negative || []).length > 0;
  if (!hasRealKeywords && fs.existsSync(docxPath)) {
    try {
      const existingParsed = await parseScreeningStandardsDocx(docxPath);
      if (existingParsed.keyword_state && (existingParsed.keyword_state.required || []).length > 0) {
        keywordGroups = existingParsed.keyword_state;
      }
    } catch {}
  }

  // Fallback: only read evaluationText from existing docx when not explicitly provided (null).
  // Empty string ("") means "clear evaluation"; null means "not specified, preserve existing".
  if (evaluationText == null && fs.existsSync(docxPath)) {
    try {
      const existingParsed2 = await parseScreeningStandardsDocx(docxPath);
      if (existingParsed2.evaluation_text) evaluationText = existingParsed2.evaluation_text;
    } catch {}
  }

  // Load suggestions from log if not explicitly provided; only include unresolved pending items
  let allSuggestions = suggestions;
  if (!allSuggestions.length && suggestionsLogPath) {
    try {
      const log = JSON.parse(await fs.promises.readFile(suggestionsLogPath, "utf8"));
      allSuggestions = (log.suggestions || []).filter((s) => s.status === "pending" && !s.processed_at);
    } catch {}
  }
  // Fallback: preserve pending suggestions from existing docx when no other source
  if (!allSuggestions.length && !suggestionsLogPath && fs.existsSync(docxPath)) {
    try {
      const existingForSuggestions = await parseScreeningStandardsDocx(docxPath);
      const table = existingForSuggestions.suggestions_table || [];
      if (table.length > 1) {
        const hdrs = table[0].map((c) => String(c || "").trim());
        const statusIdx = hdrs.indexOf("状态");
        const pendingRows = table.slice(1).filter((row) => {
          const s = statusIdx >= 0 ? String(row[statusIdx] || "").trim().toLowerCase() : "";
          return s === "pending" || s === "待定";
        });
        if (pendingRows.length) {
          allSuggestions = pendingRows.map((row) => {
            const obj = {};
            hdrs.forEach((h, i) => { if (h) obj[h] = row[i] || ""; });
            obj.status = "pending";
            return obj;
          });
        }
      }
    } catch {}
  }

  // Extract unknown content blocks from existing docx before rebuilding
  let unknownBlocks = [];
  let backupPath = null;
  if (fs.existsSync(docxPath)) {
    try {
      const existingParsed3 = await parseScreeningStandardsDocx(docxPath);
      unknownBlocks = existingParsed3.unknown_blocks || [];
      // Also detect extra rule lines in docx that are NOT in the md
      const mdText = (current.content || "").toLowerCase();
      const rulesText = existingParsed3.rules_text || "";
      if (rulesText) {
        for (const line of rulesText.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed && !mdText.includes(trimmed.toLowerCase()) && !isManagedTemplateText(trimmed)) {
            unknownBlocks.push(`<w:p><w:r><w:t xml:space="preserve">${escapeXml(trimmed)}</w:t></w:r></w:p>`);
          }
        }
      }
    } catch {}

    backupPath = await backupDocx(docxPath);
  }

  const parts = buildDocxParts({ previousText: previous, currentText: current.content, keywordGroups, evaluationText, suggestions: allSuggestions });

  // Re-inject unknown blocks into the rebuilt docx to preserve user content
  await fs.promises.writeFile(docxPath, buildDocxBuffer(parts, { unknownBlocks }));
  await fs.promises.writeFile(snapshotPath, current.content, "utf8");
  return {
    docx_path: docxPath,
    docx_overwritten: true,
    docx_generated: false,
    unknown_blocks_preserved: unknownBlocks.length,
    backup_path: backupPath,
    snapshot_path: snapshotPath,
    markdown_path: current.path,
    additions_count: parts.filter((part) => part.type === "add").length,
    deletions_count: parts.filter((part) => part.type === "delete").length,
    suggestions_in_docx: allSuggestions.length,
  };
}

function unescapeXml(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function textFromXml(xml) {
  return Array.from(String(xml || "").matchAll(/<(?:[^:<>\s]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[^:<>\s]+:)?t>/g))
    .map((match) => unescapeXml(match[1]))
    .join("");
}

function tableRowsFromXml(xml) {
  return Array.from(String(xml || "").matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)).map((rowMatch) => {
    return Array.from(rowMatch[0].matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)).map((cellMatch) => textFromXml(cellMatch[0]).trim());
  });
}

function parseZipEntries(buffer) {
  const entries = new Map();
  let centralDir = -1;
  for (let pos = buffer.length - 22; pos >= 0 && pos >= buffer.length - 0xffff - 22; pos -= 1) {
    if (buffer.readUInt32LE(pos) === 0x06054b50) {
      centralDir = buffer.readUInt32LE(pos + 16);
      break;
    }
  }
  if (centralDir >= 0) {
    let pos = centralDir;
    while (pos + 46 <= buffer.length && buffer.readUInt32LE(pos) === 0x02014b50) {
      const method = buffer.readUInt16LE(pos + 10);
      const compSize = buffer.readUInt32LE(pos + 20);
      const nameLen = buffer.readUInt16LE(pos + 28);
      const extraLen = buffer.readUInt16LE(pos + 30);
      const commentLen = buffer.readUInt16LE(pos + 32);
      const localOffset = buffer.readUInt32LE(pos + 42);
      const name = buffer.slice(pos + 46, pos + 46 + nameLen).toString("utf8");
      if (localOffset + 30 <= buffer.length && buffer.readUInt32LE(localOffset) === 0x04034b50) {
        const localNameLen = buffer.readUInt16LE(localOffset + 26);
        const localExtraLen = buffer.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const comp = buffer.slice(dataStart, dataStart + compSize);
        if (method === 0) entries.set(name, comp.toString("utf8"));
        if (method === 8) entries.set(name, zlib.inflateRawSync(comp).toString("utf8"));
      }
      pos += 46 + nameLen + extraLen + commentLen;
    }
    if (entries.size) return entries;
  }

  let pos = 0;
  while (pos + 30 <= buffer.length) {
    if (buffer.readUInt32LE(pos) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(pos + 8);
    const compSize = buffer.readUInt32LE(pos + 18);
    const nameLen = buffer.readUInt16LE(pos + 26);
    const extraLen = buffer.readUInt16LE(pos + 28);
    const name = buffer.slice(pos + 30, pos + 30 + nameLen).toString("utf8");
    const dataStart = pos + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    const comp = buffer.slice(dataStart, dataEnd);
    if (method === 0) entries.set(name, comp.toString("utf8"));
    if (method === 8) entries.set(name, zlib.inflateRawSync(comp).toString("utf8"));
    pos = dataEnd;
  }
  return entries;
}

function parseKeywordTable(rows = []) {
  const out = { required: [], optional: [], negative: [] };
  for (const row of rows.slice(1)) {
    const category = String(row[0] || "").trim();
    const terms = String(row[1] || "").trim();
    if (category === "核心必须词") {
      out.required = terms.split("|").map((group) => group.split(";").map((term) => term.trim()).filter(Boolean)).filter((group) => group.length);
    } else if (category === "可选扩展词") {
      out.optional = terms.split(";").map((term) => term.trim()).filter(Boolean);
    } else if (category === "排除词") {
      out.negative = terms.split(";").map((term) => term.trim()).filter(Boolean);
    }
  }
  return out;
}

const KNOWN_SECTIONS = new Set(["偏好规则", "格式说明 / Format Notes", "格式说明", "检索关键词", "评价", "待确认规则建议", "待确认规则建议 / Pending Rule Suggestions", "用户保留内容", "用户保留内容 / Preserved User Content"]);
const GUIDE_TEXT_PREFIX = "对偏好学习的意见";

// Template/system text patterns that must not be preserved as user content
const MANAGED_CONTENT_MARKERS = [
  "用户保留内容 / Preserved User Content",
  "以下内容来自上一次 docx 中系统未识别的区域",
  "状态选项 / Status options",
  "格式说明 / Format Notes",
  "待确认规则建议 / Pending Rule Suggestions",
  "本次暂无待确认规则建议",
  "No pending rule suggestions",
  "对偏好学习的意见可写在此处",
  "黑体",
  "红色",
  "蓝色",
  "删除线",
  "待确认建议是否生效",
  "Word 下拉不可用时",
  "pending/待定",
  "accept/接受",
  "reject/拒绝",
  "revise/修改",
  "Active rule unchanged",
  "Newly added or revised",
  "Removed or retired",
  "Rule suggestions are applied",
  "If Word dropdown is unavailable",
];

function isManagedTemplateText(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  return MANAGED_CONTENT_MARKERS.some((marker) => t.includes(marker));
}

export async function parseScreeningStandardsDocx(docxPath) {
  const entries = parseZipEntries(await fs.promises.readFile(docxPath));
  const documentXml = entries.get("word/document.xml");
  if (!documentXml) throw new Error("docx_document_xml_missing");
  const sectionNames = [];
  const sectionLines = { "偏好规则": [], "评价": [] };
  let keywordTable = [];
  let queryPreview = "";
  let suggestionsTable = [];
  let currentSection = "";
  const unknownBlocks = [];
  for (const match of documentXml.matchAll(/<w:p[\s\S]*?<\/w:p>|<w:tbl[\s\S]*?<\/w:tbl>/g)) {
    const block = match[0];
    if (block.startsWith("<w:tbl")) {
      if (currentSection === "检索关键词") keywordTable = tableRowsFromXml(block);
      else if (currentSection === "待确认规则建议" || currentSection === "待确认规则建议 / Pending Rule Suggestions") suggestionsTable = tableRowsFromXml(block);
      else unknownBlocks.push(block);
      continue;
    }
    const text = textFromXml(block).trim();
    if (KNOWN_SECTIONS.has(text)) {
      currentSection = text;
      sectionNames.push(text);
      continue;
    }
    let captured = false;
    if (currentSection === "偏好规则" && text) { sectionLines["偏好规则"].push(text); captured = true; }
    if (currentSection === "检索关键词" && text.startsWith("PubMed query preview:")) { queryPreview = text.replace(/^PubMed query preview:\s*/, ""); captured = true; }
    if (currentSection === "评价" && text && !text.startsWith(GUIDE_TEXT_PREFIX)) { sectionLines["评价"].push(text); captured = true; }
    if (!captured && currentSection && !KNOWN_SECTIONS.has(currentSection)) unknownBlocks.push(block);
    if (!captured && !currentSection) unknownBlocks.push(block);
    if (!captured && KNOWN_SECTIONS.has(currentSection) && text) unknownBlocks.push(block);
  }
  // Filter out managed template/system blocks from unknown blocks to prevent recursive pollution
  const filteredUnknownBlocks = unknownBlocks.filter((block) => {
    const textMatch = block.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
    if (!textMatch) return true;
    const text = textMatch.map((m) => m.replace(/<[^>]+>/g, "")).join("");
    return !isManagedTemplateText(text);
  });

  return {
    section_names: sectionNames,
    rules_text: sectionLines["偏好规则"].join("\n"),
    keyword_state: parseKeywordTable(keywordTable),
    keyword_table_rows: keywordTable,
    query_preview: queryPreview,
    evaluation_text: sectionLines["评价"].join("\n").trim(),
    suggestions_table: suggestionsTable,
    unknown_blocks: filteredUnknownBlocks,
    unknown_block_count: filteredUnknownBlocks.length,
  };
}

function applyRuleModifications(content, output = {}) {
  let next = cleanScreeningStandardsMarkdown(content);
  for (const deletion of output.rules_deleted || []) {
    const line = String(deletion || "").trim();
    if (line) next = next.replace(line, "");
  }
  for (const change of output.rules_changed || []) {
    const from = String(change?.from || "").trim();
    const to = String(change?.to || "").trim();
    if (from && to && next.includes(from)) next = next.replace(from, to);
  }
  const additions = (output.rules_added || []).map((line) => String(line || "").trim()).filter((line) => line && !next.includes(line));
  if (additions.length) {
    const marker = "\n## 相对降权";
    if (next.includes(marker)) {
      next = next.replace(marker, `\n${additions.join("\n")}\n${marker}`);
    } else {
      next = `${next.trimEnd()}\n\n${additions.join("\n")}\n`;
    }
  }
  return collapseBlankLines(next);
}

function emptyAudit({ auditPath, llmConfig = null, pubmedQueryBefore = "", pubmedQueryAfter = "" } = {}) {
  return {
    generated_at: new Date().toISOString(),
    evaluation_text_original: "",
    evaluation_processed: false,
    evaluation_cleared: false,
    llm_model: llmConfig?.model || "",
    llm_config_path: llmConfig?.configPath || "",
    llm_api_key_configured: Boolean(llmConfig?.apiKeyConfigured),
    llm_api_key_source: llmConfig?.apiKeyEnvName || "",
    llm_api_key_source_kind: llmConfig?.apiKeyEnvName === "PREFERENCE_LEARNING_API_KEY"
      ? "direct"
      : llmConfig?.apiKeyEnvName === "TITLE_TRANSLATION_API_KEY"
        ? "fallback"
        : "",
    llm_unavailable: false,
    rules_added: [],
    rules_deleted: [],
    rules_changed: [],
    keywords_added: { required: [], optional: [], negative: [] },
    keywords_removed: [],
    negative_keywords_added: [],
    keyword_table_synced: false,
    keyword_table_changed: false,
    keyword_groups_before: null,
    keyword_groups_after: null,
    pubmed_query_before: pubmedQueryBefore,
    pubmed_query_after: pubmedQueryAfter,
    unmapped_feedback: [],
    blockers: [],
    audit_path: auditPath || "",
  };
}

function sameKeywordGroups(a, b) {
  return JSON.stringify(normalizePubMedKeywordGroups(a || {})) === JSON.stringify(normalizePubMedKeywordGroups(b || {}));
}

function syncPubMedConfigFromDocxKeywordTable(filePath, parsedKeywordState, currentConfig = {}) {
  const beforeGroups = loadPubMedKeywordGroupsFromConfig(currentConfig);
  const afterGroups = normalizePubMedKeywordGroups(parsedKeywordState || {});
  const queryBefore = String(currentConfig.query || buildPubMedQueryFromKeywordGroups(beforeGroups));
  const queryAfter = buildPubMedQueryFromKeywordGroups(afterGroups);
  const changed = !sameKeywordGroups(beforeGroups, afterGroups) || queryBefore !== queryAfter;
  if (changed) {
    fs.writeFileSync(filePath, `${JSON.stringify({
      ...currentConfig,
      keyword_groups: afterGroups,
      query: queryAfter,
    }, null, 2)}\n`, "utf8");
  }
  return {
    changed,
    keyword_groups_before: beforeGroups,
    keyword_groups_after: afterGroups,
    query_before: queryBefore,
    query_after: queryAfter,
  };
}

async function writeAudit(filePath, audit) {
  if (!filePath) return;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  let history = [];
  try {
    const previous = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    history = Array.isArray(previous.history) ? previous.history : [];
    const { history: _history, ...previousSnapshot } = previous;
    if (Object.keys(previousSnapshot).length) history.push(previousSnapshot);
  } catch {}
  await fs.promises.writeFile(filePath, `${JSON.stringify({ ...audit, history }, null, 2)}\n`, "utf8");
}

export async function processManualStandardEvaluation({
  reviewRoot,
  pubmedConfigPath,
  auditPath,
  llmClient = null,
} = {}) {
  const mdPath = screeningStandardsPath(reviewRoot);
  const docxPath = screeningStandardsDocxPath(reviewRoot);
  let pubmedConfig = readJsonIfExists(pubmedConfigPath);
  const pubmedQueryBefore = String(pubmedConfig.query || buildPubMedQueryFromKeywordGroups(loadPubMedKeywordGroupsFromConfig(pubmedConfig)));
  const llmConfig = getPreferenceLearningConfig();
  const audit = emptyAudit({ auditPath, llmConfig, pubmedQueryBefore, pubmedQueryAfter: pubmedQueryBefore });

  let parsed;
  try {
    if (!fs.existsSync(docxPath)) {
      await syncScreeningStandardsDocx(reviewRoot, { pubmedConfigPath });
    }
    parsed = await parseScreeningStandardsDocx(docxPath);
  } catch (error) {
    audit.blockers.push("docx_unreadable");
    audit.error = String(error?.message || error);
    await writeAudit(auditPath, audit);
    return audit;
  }

  const keywordTableSync = syncPubMedConfigFromDocxKeywordTable(pubmedConfigPath, parsed.keyword_state, pubmedConfig);
  pubmedConfig = {
    ...pubmedConfig,
    keyword_groups: keywordTableSync.keyword_groups_after,
    query: keywordTableSync.query_after,
  };
  Object.assign(audit, {
    keyword_table_synced: true,
    keyword_table_changed: keywordTableSync.changed,
    keyword_groups_before: keywordTableSync.keyword_groups_before,
    keyword_groups_after: keywordTableSync.keyword_groups_after,
    pubmed_query_after: keywordTableSync.query_after,
  });

  // Process user suggestion decisions from docx
  const resolvedSuggestionsLogPath = ruleSuggestionsLogPath(reviewRoot);
  let userDecisionResult = { decisions: [], log: null };
  try {
    userDecisionResult = await processUserSuggestionDecisions(parsed, { reviewRoot, logPath: resolvedSuggestionsLogPath });
    if (userDecisionResult.decisions.length) {
      const decisionSync = syncSuggestionsToScreeningStandardsMd(
        await fs.promises.readFile(mdPath, "utf8"),
        userDecisionResult.decisions,
      );
      if (decisionSync.added > 0) {
        await fs.promises.writeFile(mdPath, decisionSync.content, "utf8");
      }
      audit.suggestions_decisions_applied = userDecisionResult.decisions.length;
      audit.suggestions_added_to_md = decisionSync.added;
      audit.suggestions_skipped_duplicate = decisionSync.skippedDuplicate;
    }
  } catch (err) {
    audit.suggestions_decision_error = String(err?.message || err);
  }

  audit.evaluation_text_original = parsed.evaluation_text;
  if (!parsed.evaluation_text) {
    audit.blockers.push("no_evaluation_input");
    const current = await readScreeningStandardsFile(reviewRoot);
    const cleaned = cleanScreeningStandardsMarkdown(current.content);
    if (cleaned !== current.content) await fs.promises.writeFile(mdPath, cleaned, "utf8");
    await writeAudit(auditPath, audit);
    return audit;
  }

  const llm = await understandPreferenceEvaluation({
    evaluation_text: parsed.evaluation_text,
    current_rules: parsed.rules_text,
    current_keywords: keywordTableSync.keyword_groups_after,
    current_pubmed_query: keywordTableSync.query_after,
  }, { runtime: llmConfig, llmClient });

  if (!llm.ok) {
    audit.blockers.push(llm.blocker || "llm_unavailable");
    audit.llm_unavailable = llm.blocker === "llm_unavailable" || llm.blocker === "missing_preference_learning_api_key";
    audit.llm_validation_reason = llm.validation_reason || "";
    audit.llm_error = llm.error || "";
    audit.llm_output = llm.output;
    await writeAudit(auditPath, audit);
    return audit;
  }

  const output = llm.output;
  const beforeMd = await fs.promises.readFile(mdPath, "utf8");
  const afterMd = applyRuleModifications(beforeMd, output);
  await fs.promises.writeFile(mdPath, afterMd, "utf8");
  const queryUpdate = updatePubMedPmcKeywordGroups(pubmedConfigPath, output);
  await syncScreeningStandardsDocx(reviewRoot, {
    pubmedConfigPath,
    evaluationText: "",
    previousText: beforeMd,
    suggestionsLogPath: resolvedSuggestionsLogPath,
  });

  Object.assign(audit, {
    evaluation_processed: true,
    evaluation_cleared: true,
    rules_added: output.rules_added,
    rules_deleted: output.rules_deleted,
    rules_changed: output.rules_changed,
    keywords_added: output.keywords_added,
    keywords_removed: output.keywords_removed,
    negative_keywords_added: output.negative_keywords_added,
    pubmed_query_after: queryUpdate.query_after,
    unmapped_feedback: output.unmapped_feedback,
    llm_output: output,
    llm_raw_text: llm.raw_text || "",
  });
  await writeAudit(auditPath, audit);
  return audit;
}

export async function applyScreeningStandardsLearningUpdate(reviewRoot, audit = {}, { generatedAt = new Date().toISOString(), suggestionsLogPath = null } = {}) {
  const current = await readScreeningStandardsFile(reviewRoot);
  let content = cleanScreeningStandardsMarkdown(current.content);
  const deletions = [];
  for (const change of Array.isArray(audit.summary_change_log) ? audit.summary_change_log : []) {
    if (String(change?.change_type || "") === "retired") {
      const statement = String(change?.statement || change?.rationale || "").trim();
      if (statement && content.includes(statement)) deletions.push(statement);
    }
  }
  if (deletions.length) {
    for (const deletion of deletions) content = content.replace(deletion, "");
  }
  if (deletions.length || content !== current.content) {
    content = collapseBlankLines(content);
  }
  if (content !== current.content) {
    await fs.promises.writeFile(current.path, content, "utf8");
  }
  let evaluationText = null;
  const docxPath = screeningStandardsDocxPath(reviewRoot);
  try {
    if (fs.existsSync(docxPath)) {
      evaluationText = (await parseScreeningStandardsDocx(docxPath)).evaluation_text || null;
    }
  } catch {}
  const docxSync = await syncScreeningStandardsDocx(reviewRoot, { evaluationText, suggestionsLogPath });
  return {
    path: current.path,
    loaded: current.loaded,
    created: current.created,
    cleaned: current.cleaned,
    used_as_primary_rationale_source: true,
    change_markup_applied: deletions.length > 0,
    additions_count: 0,
    deletions_count: deletions.length,
    docx_path: docxSync.docx_path,
    docx_snapshot_path: docxSync.snapshot_path,
    docx_synced: true,
    source_name: current.source_name,
  };
}
