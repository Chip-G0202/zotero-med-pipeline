import assert from "node:assert/strict";
import test from "node:test";

import { applyJournalQualityGate, buildJournalQualityConfig } from "../tools/lib/easyscholar_journal_quality_gate.mjs";

test("defaults the IF threshold to 3", () => {
  const config = buildJournalQualityConfig();

  assert.equal(config.minImpactFactor, 3);
});

test("filters PubMed ABC items when IF is below threshold", async () => {
  const items = [
    { title: "low if paper", source_platform: "pubmed", journal: "Low IF Journal", grade: "B" },
  ];

  const result = await applyJournalQualityGate(items, {
    config: { enabled: true, minImpactFactor: 3, excludeCasSmallPartitions: ["4区"] },
    lookup: async () => ({ found: true, impactFactor: 2.9, casSmallPartition: "2区", raw: {} }),
    wait: async () => {},
  });

  assert.equal(result.items.length, 0);
  assert.equal(result.report.excluded_count, 1);
  assert.equal(result.report.excluded_items[0].reason, "impact_factor_below_threshold");
});

test("filters PubMed ABC items from CAS small partition 4", async () => {
  const items = [
    { title: "q4 paper", source_platform: "pmc", journal: "Fourth Partition Journal", grade: "C" },
  ];

  const result = await applyJournalQualityGate(items, {
    config: { enabled: true, minImpactFactor: 3, excludeCasSmallPartitions: ["4区"] },
    lookup: async () => ({ found: true, impactFactor: 9.1, casSmallPartition: "4区", raw: {} }),
    wait: async () => {},
  });

  assert.equal(result.items.length, 0);
  assert.equal(result.report.excluded_count, 1);
  assert.equal(result.report.excluded_items[0].reason, "cas_small_partition_excluded");
});

test("keeps PubMed ABC items when IF is at the threshold and partition is not 4", async () => {
  const items = [
    { title: "threshold paper", source_platform: "pubmed", journal: "Threshold Journal", grade: "A" },
    { title: "higher if paper", source_platform: "pubmed", journal: "Higher IF Journal", grade: "B" },
  ];

  const result = await applyJournalQualityGate(items, {
    config: { enabled: true, minImpactFactor: 3, excludeCasSmallPartitions: ["4区"] },
    lookup: async (journal) => ({
      found: true,
      impactFactor: journal === "Threshold Journal" ? 3.0 : 4.2,
      casSmallPartition: "2区",
      raw: {},
    }),
    wait: async () => {},
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.report.excluded_count, 0);
});

test("does not query RSS items or D-grade PubMed items", async () => {
  const items = [
    { title: "rss paper", source_platform: "rss", journal: "RSS Journal", grade: "A" },
    { title: "d paper", source_platform: "pubmed", journal: "D Journal", grade: "D" },
  ];
  let calls = 0;

  const result = await applyJournalQualityGate(items, {
    config: { enabled: true, minImpactFactor: 3, excludeCasSmallPartitions: ["4区"] },
    lookup: async () => {
      calls += 1;
      return { found: true, impactFactor: 1, casSmallPartition: "4区", raw: {} };
    },
    wait: async () => {},
  });

  assert.equal(calls, 0);
  assert.equal(result.items.length, 2);
  assert.equal(result.report.skipped_rss_count, 1);
  assert.equal(result.report.skipped_d_count, 1);
});

test("filters PubMed preprints without querying EasyScholar", async () => {
  const items = [
    { title: "preprint 1", source_platform: "pubmed", journal: "bioRxiv : the preprint server for biology", grade: "B" },
    { title: "preprint 2", source_platform: "pubmed", journal: "medRxiv : the preprint server for health sciences", grade: "C" },
  ];
  let calls = 0;

  const result = await applyJournalQualityGate(items, {
    config: { enabled: true, minImpactFactor: 3, excludeCasSmallPartitions: ["4区"] },
    lookup: async () => {
      calls += 1;
      return { found: true, impactFactor: 10, casSmallPartition: "1区", raw: {} };
    },
    wait: async () => {},
  });

  assert.equal(calls, 0);
  assert.equal(result.items.length, 0);
  assert.equal(result.report.excluded_count, 2);
  assert.deepEqual(result.report.excluded_items.map((x) => x.reason), ["preprint_excluded", "preprint_excluded"]);
}
);

test("filters correction erratum and retraction records without querying EasyScholar", async () => {
  const items = [
    { title: "Correction to: Cognitive impairment after exposure", source_platform: "pubmed", journal: "Formal Journal", grade: "B" },
    { title: "Erratum: Neuroinflammation signaling pathway", source_platform: "pubmed", journal: "Formal Journal", grade: "C" },
    { title: "Retraction: Microglial activation in disease", source_platform: "pubmed", journal: "Formal Journal", grade: "A" },
  ];
  let calls = 0;

  const result = await applyJournalQualityGate(items, {
    config: { enabled: true, minImpactFactor: 3, excludeCasSmallPartitions: ["4区"] },
    lookup: async () => {
      calls += 1;
      return { found: true, impactFactor: 10, casSmallPartition: "1区", raw: {} };
    },
    wait: async () => {},
  });

  assert.equal(calls, 0);
  assert.equal(result.items.length, 0);
  assert.equal(result.report.excluded_count, 3);
  assert.deepEqual(result.report.excluded_items.map((x) => x.reason), [
    "non_research_record_excluded",
    "non_research_record_excluded",
    "non_research_record_excluded",
  ]);
});

test("keeps items and audits when lookup fails or returns no metrics", async () => {
  const items = [
    { title: "missing paper", source_platform: "pubmed", journal: "Missing Journal", grade: "B" },
    { title: "failed paper", source_platform: "pubmed", journal: "Failed Journal", grade: "C" },
  ];

  const result = await applyJournalQualityGate(items, {
    config: { enabled: true, minImpactFactor: 3, excludeCasSmallPartitions: ["4区"] },
    lookup: async (journal) => {
      if (journal === "Failed Journal") throw new Error("temporary failure");
      return { found: false, impactFactor: null, casSmallPartition: "", raw: {} };
    },
    wait: async () => {},
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.report.excluded_count, 0);
  assert.equal(result.report.missing_items.length, 1);
  assert.equal(result.report.failed_items.length, 1);
});

test("queries each unique journal once and waits between different journal lookups", async () => {
  const items = [
    { title: "paper 1", source_platform: "pubmed", journal: "Same Journal", grade: "B" },
    { title: "paper 2", source_platform: "pubmed", journal: "Same Journal", grade: "C" },
    { title: "paper 3", source_platform: "pubmed", journal: "Other Journal", grade: "B" },
  ];
  const calls = [];
  let waits = 0;

  await applyJournalQualityGate(items, {
    config: { enabled: true, minImpactFactor: 3, excludeCasSmallPartitions: ["4区"], rateLimitPerSecond: 2 },
    lookup: async (journal) => {
      calls.push(journal);
      return { found: true, impactFactor: 8, casSmallPartition: "2区", raw: {} };
    },
    wait: async () => {
      waits += 1;
    },
  });

  assert.deepEqual(calls, ["Same Journal", "Other Journal"]);
  assert.equal(waits, 1);
});

test("retries PubMed long journal names with the subtitle removed", async () => {
  const items = [
    {
      title: "paper",
      source_platform: "pubmed",
      journal: "The Journal of neuroscience : the official journal of the Society for Neuroscience",
      grade: "B",
    },
  ];
  const calls = [];

  const result = await applyJournalQualityGate(items, {
    config: { enabled: true, minImpactFactor: 3, excludeCasSmallPartitions: ["4区"] },
    lookup: async (journal) => {
      calls.push(journal);
      if (journal === "Journal of neuroscience") {
        return { found: true, impactFactor: 5.3, casSmallPartition: "神经科学2区。", raw: {} };
      }
      return { found: false, impactFactor: null, casSmallPartition: "", raw: {} };
    },
    wait: async () => {},
  });

  assert.deepEqual(calls, [
    "The Journal of neuroscience : the official journal of the Society for Neuroscience",
    "Journal of neuroscience",
  ]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].journal_metrics.found, true);
  assert.equal(result.report.missing_count, 0);
});
