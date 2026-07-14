const GRADES = ["A", "B", "C", "D"];

function countByGrade(classified = []) {
  const counts = {};
  for (const entry of classified) {
    const grade = GRADES.includes(entry.grade) ? entry.grade : "D";
    counts[grade] = (counts[grade] || 0) + 1;
  }
  return counts;
}

export function buildBalancedCandidatePool({ rssItems = [], dbItems = [], fixtureItems = [], limit = null } = {}) {
  const sources = [
    Array.isArray(rssItems) ? rssItems : [],
    Array.isArray(dbItems) ? dbItems : [],
    Array.isArray(fixtureItems) ? fixtureItems : [],
  ].filter((items) => items.length);
  const max = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : null;
  const items = [];
  let index = 0;
  while ((!max || items.length < max) && sources.some((source) => index < source.length)) {
    for (const source of sources) {
      if (max && items.length >= max) break;
      if (index < source.length) items.push(source[index]);
    }
    index += 1;
  }
  return {
    items,
    audit: {
      strategy: "balanced_sources",
      limit: max,
      input_counts: {
        rss: Array.isArray(rssItems) ? rssItems.length : 0,
        db: Array.isArray(dbItems) ? dbItems.length : 0,
        fixture: Array.isArray(fixtureItems) ? fixtureItems.length : 0,
      },
      output_count: items.length,
    },
  };
}

export function selectRepresentativeCandidateSample({ items = [], limit = null, classify } = {}) {
  const source = Array.isArray(items) ? items : [];
  const max = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : source.length;
  const classified = source.map((item, index) => {
    const scored = typeof classify === "function" ? classify(item) : {};
    const grade = GRADES.includes(scored?.grade) ? scored.grade : "D";
    return {
      item,
      index,
      grade,
      grade_reason: scored?.grade_reason || scored?.classification_reason || "",
      classification_reason: scored?.classification_reason || "",
    };
  });
  const groups = Object.fromEntries(GRADES.map((grade) => [grade, classified.filter((entry) => entry.grade === grade)]));
  const selected = [];
  while (selected.length < max && GRADES.some((grade) => groups[grade].length)) {
    for (const grade of GRADES) {
      if (selected.length >= max) break;
      const next = groups[grade].shift();
      if (next) selected.push(next);
    }
  }
  return {
    items: selected.map((entry) => entry.item),
    diagnostics: {
      strategy: "representative",
      limit: max,
      pre_sample_count: classified.length,
      selected_count: selected.length,
      pre_sample_grade_counts: countByGrade(classified),
      selected_grade_counts: countByGrade(selected),
      selected_candidates: selected.map((entry) => ({
        index: entry.index,
        grade: entry.grade,
        title: entry.item?.title || entry.item?.["英文标题"] || "",
        source_channel: entry.item?.source_channel || "",
        source_platform: entry.item?.source_platform || "",
        grade_reason: entry.grade_reason,
        classification_reason: entry.classification_reason,
      })),
    },
  };
}
