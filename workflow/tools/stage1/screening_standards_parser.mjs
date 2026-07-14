import { readScreeningStandardsFileSync } from "../lib/screening_standards_paths.mjs";

// Stage 1 screening standards markdown parser.

export function parseScreeningStandards(markdown) {
  // Preserve original implementation for compatibility
  if (!markdown || typeof markdown !== "string") return { parsed: false, error: "empty_markdown", hard_excludes: [], positive_preferences: [], negative_preferences: [], grade_rules: {}, raw_rules: [], warnings: [], topic_definition: "" };
  const sections = { topic_definition: "", positive_preferences: [], negative_preferences: [], hard_excludes: [], uncertain: [], caveats: [], raw_rules: [] };
  const lines = markdown.split("\n");
  let currentSection = "preamble";
  let preambleLines = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("## ")) {
      const heading = line.replace(/^##\s*/, "").trim();
      if (heading.includes("优先关注")) currentSection = "positive";
      else if (heading.includes("降权")) currentSection = "negative";
      else if (heading.includes("严格排除") || heading.includes("排除")) currentSection = "hard_exclude";
      else if (heading.includes("不确定")) currentSection = "uncertain";
      else if (heading.includes("注意") || heading.includes("事项")) currentSection = "caveats";
      else currentSection = "other";
      continue;
    }
    if (line.startsWith("# ")) {
      if (currentSection === "preamble") currentSection = "title";
      continue;
    }
    if (line === "---") continue;
    const bullet = line.replace(/^\*\s*/, "").trim();
    if (bullet === line && currentSection === "preamble") { preambleLines.push(bullet); continue; }
    if (currentSection === "preamble") { preambleLines.push(bullet); continue; }
    if (currentSection === "hard_exclude") sections.hard_excludes.push(bullet);
    else if (currentSection === "positive") sections.positive_preferences.push(bullet);
    else if (currentSection === "negative") sections.negative_preferences.push(bullet);
    else if (currentSection === "uncertain") sections.uncertain.push(bullet);
    else if (currentSection === "caveats") sections.caveats.push(bullet);
  }

  sections.topic_definition = preambleLines.join(" ");

  const hardExcludes = [];
  for (const rule of sections.hard_excludes) {
    const lower = rule.toLowerCase();
    const keywords = [];
    if (lower.includes("降解") || lower.includes("去除") || lower.includes("转移") || lower.includes("累积") || lower.includes("监测") || lower.includes("检测") || lower.includes("环境分析") || lower.includes("污染特征")) keywords.push("degradation", "removal", "transfer", "accumulation", "monitoring", "detection", "environmental analysis", "example topic term 034 characterization");
    if (lower.includes("工程") || lower.includes("计算") || lower.includes("材料") || lower.includes("物理") || lower.includes("电子") || lower.includes("机械")) keywords.push("engineering", "computational", "material", "physics", "electronics", "mechanical");
    if (lower.includes("纯ai") || lower.includes("算法") || lower.includes("工具开发") || lower.includes("理论建模")) keywords.push("pure ai", "algorithm", "tool development", "theoretical modeling");
    if (lower.includes("植物")) keywords.push("plant", "arabidopsis", "rice", "wheat");
    if (lower.includes("昆虫") || lower.includes("线虫") || lower.includes("酵母")) keywords.push("insect", "nematode", "yeast", "drosophila", "c. elegans");
    if (lower.includes("癌症") || lower.includes("肿瘤") || lower.includes("病毒")) keywords.push("cancer", "tumor", "virus", "oncolog");
    if (keywords.length === 0) keywords.push(lower.slice(0, 50));
    hardExcludes.push({ rule, keywords, section: "严格排除" });
  }

  const negativePrefs = [];
  for (const rule of sections.negative_preferences) {
    const lower = rule.toLowerCase();
    const keywords = [];
    if (lower.includes("队列") || lower.includes("流行病") || lower.includes("观察性")) keywords.push("cohort", "epidemiolog", "observational");
    if (lower.includes("临床") || lower.includes("结局")) keywords.push("clinical", "outcome");
    if (lower.includes("组学") || lower.includes("omics")) keywords.push("omics", "example topic term 015", "example topic term 032", "example topic term 023");
    if (keywords.length === 0) keywords.push(lower.slice(0, 50));
    negativePrefs.push({ rule, keywords, section: "降权" });
  }

  const positivePrefs = [];
  for (const rule of sections.positive_preferences) {
    const lower = rule.toLowerCase();
    const keywords = [];
    if (lower.includes("动物实验") || lower.includes("mouse") || lower.includes("rat")) keywords.push("animal", "mouse", "mice", "rat", "动物实验");
    if (lower.includes("组学") || lower.includes("转录组") || lower.includes("蛋白组") || lower.includes("代谢组") || lower.includes("omics") || lower.includes("transcriptom") || lower.includes("proteom") || lower.includes("metabolom")) keywords.push("omics", "example topic term 015", "example topic term 032", "example topic term 023", "组学");
    if (keywords.length === 0) keywords.push(lower.slice(0, 50));
    positivePrefs.push({ rule, keywords, section: "优先关注" });
  }

  return {
    parsed: true,
    topic_definition: sections.topic_definition,
    hard_excludes: hardExcludes,
    positive_preferences: positivePrefs,
    negative_preferences: negativePrefs,
    grade_rules: {
      exclude_rules: sections.hard_excludes,
      downgrade_rules: sections.negative_preferences,
      priority_rules: sections.positive_preferences,
    },
    raw_rules: sections.raw_rules,
    warnings: sections.uncertain,
    caveats: sections.caveats,
  };
}

export function loadScreeningStandards(reviewRoot) {
  try {
    const result = readScreeningStandardsFileSync(reviewRoot, { normalize: true });
    if (!result.content || !result.loaded) return { parsed: false, error: "file_not_loaded" };
    const parsed = parseScreeningStandards(result.content);
    return { ...parsed, path: result.path, loaded: true };
  } catch (err) {
    return { parsed: false, error: String(err.message || err), path: "", loaded: false };
  }
}
