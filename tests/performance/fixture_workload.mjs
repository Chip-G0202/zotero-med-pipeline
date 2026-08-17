import { createHash } from "node:crypto";

export const FIXED_NOW = "2096-12-27T08:00:00.000Z";
export const COLLECTIONS = {
  rss: "COL-RSS",
  database: "COL-DATABASE",
  A: "COL-A",
  B: "COL-B",
  C: "COL-C",
};

function digest(value, size = 12) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, size).toUpperCase();
}

export function itemKey(item) {
  return `K${digest(item.doi || item.pmid || item.title, 7)}`;
}

export function makeFixtureCandidates(count = 1200) {
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const canonicalIndex = index > 0 && index % 5 === 0 ? index - 1 : index;
    const bucket = canonicalIndex % 3;
    const focus = bucket === 0
      ? "example exposure example biological context example mechanism example study design"
      : bucket === 1
        ? "example biological context example mechanism adjacent evidence"
        : "example biological context broad field evidence";
    items.push({
      id: `fixture-${index}`,
      title: `Synthetic ${focus} study ${canonicalIndex} — Unicode 标题`,
      abstract: `Fixed abstract for candidate ${canonicalIndex}.`,
      doi: `10.5555/paperecho.${canonicalIndex}`,
      pmid: String(90000000 + canonicalIndex),
      url: `https://example.test/papers/${canonicalIndex}`,
      journal: "Example Journal",
      source_platform: canonicalIndex % 2 ? "pubmed" : "rss",
      source_channel: canonicalIndex % 2 ? "database" : "rss",
      date: "2096-12-26",
    });
  }
  return items;
}

export function canonicalMetadata(item) {
  return {
    itemType: "journalArticle",
    title: item.title,
    DOI: item.doi,
    url: item.url,
    publicationTitle: item.journal,
    extra: `PMID: ${item.pmid}`,
    version: 1,
  };
}

export function buildMutationPlan(items) {
  const admitted = items.filter((item) => ["A", "B", "C"].includes(item.final_grade || item.grade));
  const create = admitted.map((item, inputIndex) => ({
    ...canonicalMetadata(item),
    inputIndex,
    key: itemKey(item),
  }));
  const collectionChanges = [];
  for (const [name, collectionKey] of Object.entries(COLLECTIONS)) {
    const keys = admitted.filter((item) => {
      if (["A", "B", "C"].includes(name)) return (item.final_grade || item.grade) === name;
      return name === "rss" ? item.source_channel === "rss" : item.source_channel !== "rss";
    }).map(itemKey);
    if (keys.length) collectionChanges.push({ collectionKey, itemKeys: keys.sort() });
  }
  return { admitted, create, collectionChanges };
}

export function makeWarmSeed(triaged) {
  const plan = buildMutationPlan(triaged);
  const items = Object.fromEntries(plan.admitted.map((item) => {
    const key = itemKey(item);
    return [key, { key, version: 2, data: { ...canonicalMetadata(item), key, shortTitle: `译文：${item.title}`, collections: plan.collectionChanges.filter((entry) => entry.itemKeys.includes(key)).map((entry) => entry.collectionKey) } }];
  }));
  return {
    identityKeys: new Set(plan.admitted.map((item) => item.doi.toLowerCase())),
    translationCache: new Map(plan.admitted.map((item) => [item.title, `译文：${item.title}`])),
    items,
    collections: Object.fromEntries(Object.values(COLLECTIONS).map((key) => [key, new Set(Object.values(items).filter((item) => item.data.collections.includes(key)).map((item) => item.key))])),
  };
}
