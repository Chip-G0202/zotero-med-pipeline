import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyJournalQualityGate, buildEasyScholarSummary, buildJournalQualityConfig } from "../tools/stage1/easyscholar_journal_quality_gate.mjs";

test("defaults the IF threshold to 3", () => {
  const config = buildJournalQualityConfig();

  assert.equal(config.minImpactFactor, 3);
});

test("builds EasyScholar summary for disabled gate without triggering calls", () => {
  const summary = buildEasyScholarSummary({
    enabled: false,
    input_count: 2,
    queried_journal_count: 0,
    failed_count: 0,
    missing_count: 0,
  }, { apiKeyPresent: true });

  assert.equal(summary.enabled, false);
  assert.equal(summary.configured, false);
  assert.equal(summary.api_key_present, true);
  assert.equal(summary.triggered, false);
  assert.equal(summary.items_considered_count, 2);
  assert.equal(summary.items_attempted_count, 0);
  assert.equal(summary.skipped_reason, "disabled");
  assert.equal(summary.degraded, false);
});

test("builds EasyScholar summary for missing API key without marking external calls triggered", () => {
  const summary = buildEasyScholarSummary({
    enabled: true,
    input_count: 1,
    queried_journal_count: 1,
    failed_count: 1,
    failed_items: [{ reason: "missing_secret_key" }],
  }, { apiKeyPresent: false });

  assert.equal(summary.enabled, true);
  assert.equal(summary.configured, false);
  assert.equal(summary.api_key_present, false);
  assert.equal(summary.triggered, false);
  assert.equal(summary.items_considered_count, 1);
  assert.equal(summary.items_attempted_count, 0);
  assert.equal(summary.items_failed_count, 1);
  assert.equal(summary.skipped_reason, "missing_api_key");
  assert.deepEqual(summary.failure_reasons, ["missing_api_key"]);
  assert.equal(summary.degraded, true);
});

test("builds EasyScholar summary for successful API calls", () => {
  const summary = buildEasyScholarSummary({
    enabled: true,
    input_count: 3,
    queried_journal_count: 2,
    failed_count: 0,
    missing_count: 0,
  }, { apiKeyPresent: true });

  assert.equal(summary.enabled, true);
  assert.equal(summary.configured, true);
  assert.equal(summary.triggered, true);
  assert.equal(summary.items_considered_count, 3);
  assert.equal(summary.items_attempted_count, 2);
  assert.equal(summary.items_succeeded_count, 2);
  assert.equal(summary.items_failed_count, 0);
  assert.equal(summary.skipped_reason, "");
  assert.deepEqual(summary.failure_reasons, []);
  assert.equal(summary.degraded, false);
});

test("builds EasyScholar summary for API failure degraded continuation", () => {
  const summary = buildEasyScholarSummary({
    enabled: true,
    input_count: 2,
    queried_journal_count: 2,
    failed_count: 1,
    missing_count: 0,
    failed_items: [
      { reason: "http_429" },
      { reason: "temporary provider outage with long provider details that should not be preserved verbatim" },
    ],
  }, { apiKeyPresent: true });

  assert.equal(summary.triggered, true);
  assert.equal(summary.items_attempted_count, 2);
  assert.equal(summary.items_succeeded_count, 1);
  assert.equal(summary.items_failed_count, 1);
  assert.equal(summary.degraded, true);
  assert.deepEqual(summary.failure_reasons, ["http_429", "lookup_failed"]);
  assert.equal(summary.failure_reasons.some((reason) => reason.includes("provider details")), false);
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
    { title: "Erratum: Synthetic Unicode fixture alpha beta gamma for truncation and sorting", source_platform: "pubmed", journal: "Formal Journal", grade: "C" },
    { title: "Retraction: exampleCellType activation in disease", source_platform: "pubmed", journal: "Formal Journal", grade: "A" },
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
      journal: "The Synthetic Journal of Fixture Studies : the official journal of the Example Society",
      grade: "B",
    },
  ];
  const calls = [];

  const result = await applyJournalQualityGate(items, {
    config: { enabled: true, minImpactFactor: 3, excludeCasSmallPartitions: ["4区"] },
    lookup: async (journal) => {
      calls.push(journal);
      if (journal === "Synthetic Journal of Fixture Studies") {
        return { found: true, impactFactor: 5.3, casSmallPartition: "示例2区。", raw: {} };
      }
      return { found: false, impactFactor: null, casSmallPartition: "", raw: {} };
    },
    wait: async () => {},
  });

  assert.deepEqual(calls, [
    "The Synthetic Journal of Fixture Studies : the official journal of the Example Society",
    "Synthetic Journal of Fixture Studies",
  ]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].journal_metrics.found, true);
  assert.equal(result.report.missing_count, 0);
});

test("uses persistent journal cache before querying EasyScholar", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "journal-cache-"));
  const cachePath = path.join(tmpRoot, "journal_quality_cache.json");
  await fs.writeFile(cachePath, JSON.stringify({
    schema_version: 1,
    entries: {
      "journal:cached journal": {
        source: "easyscholar",
        normalized_key: "journal:cached journal",
        fetched_at: "2026-07-08T00:00:00.000Z",
        metrics: {
          found: true,
          impactFactor: 8.5,
          impactFactor5Year: null,
          casSmallPartition: "2区",
          raw: {},
          error: "",
        },
      },
    },
  }), "utf8");
  let calls = 0;

  const result = await applyJournalQualityGate([
    { title: "cached paper", source_platform: "pubmed", journal: "Cached Journal", grade: "B" },
  ], {
    cachePath,
    config: { enabled: true, minImpactFactor: 3, excludeCasSmallPartitions: ["4区"] },
    lookup: async () => {
      calls += 1;
      return { found: true, impactFactor: 1, casSmallPartition: "4区", raw: {} };
    },
    wait: async () => {},
  });

  assert.equal(calls, 0);
  assert.equal(result.items.length, 1);
  assert.equal(result.report.local_cache_hit_count, 1);
  assert.equal(result.report.queried_journal_count, 0);
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test("writes persistent journal cache after EasyScholar lookup", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "journal-cache-write-"));
  const cachePath = path.join(tmpRoot, "journal_quality_cache.json");

  const result = await applyJournalQualityGate([
    { title: "new paper", source_platform: "pubmed", journal: "New Journal", grade: "A", issn: "1234-567X" },
  ], {
    cachePath,
    config: { enabled: true, minImpactFactor: 3, excludeCasSmallPartitions: ["4区"] },
    lookup: async () => ({ found: true, impactFactor: 6.1, casSmallPartition: "1区", raw: {} }),
    wait: async () => {},
  });

  const cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
  assert.equal(result.report.local_cache_miss_count, 1);
  assert.equal(result.report.local_cache_write_count, 1);
  assert.ok(cache.entries["issn:1234567X"]);
  assert.ok(cache.entries["journal:new journal"]);
  assert.equal(cache.entries["journal:new journal"].metrics.impactFactor, 6.1);
  await fs.rm(tmpRoot, { recursive: true, force: true });
});
