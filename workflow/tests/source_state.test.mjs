import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  RETRIEVAL_AUDIT_SCHEMA_VERSION,
  buildSourceState,
  canonicalQueryHash,
  commitRetrievalTransaction,
  loadSourceState,
  sourceHealthObservations,
  sourceStatePath,
  writeAtomicJson,
} from "../tools/stage1/source_state.mjs";

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "paperecho-state-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("canonical query hash is stable, semantic, and secret-free", () => {
  const left = canonicalQueryHash({ query: "  brain   AND toxin ", filters: { b: 2, a: 1 }, api_key: "first" });
  const right = canonicalQueryHash({ filters: { a: 1, b: 2 }, query: "brain AND toxin", api_key: "second" });
  assert.equal(left, right);
  assert.notEqual(left, canonicalQueryHash({ filters: { a: 1, b: 2 }, query: "brain OR toxin" }));
});

test("weekly and radar use separate state namespaces", () => {
  const args = { stateRoot: "state", source: "pubmed", queryHash: "a".repeat(64) };
  assert.notEqual(sourceStatePath({ ...args, profile: "weekly" }), sourceStatePath({ ...args, profile: "radar" }));
});

test("unknown source state schema is rejected", async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, "unknown.json");
  await fs.writeFile(filePath, JSON.stringify({ schemaVersion: 999 }), "utf8");
  await assert.rejects(loadSourceState(filePath), /SOURCE_STATE_SCHEMA_UNSUPPORTED_999/);
});

test("failed atomic rename leaves neither valid state nor temporary file", async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, "state.json");
  const failingFs = {
    mkdir: fs.mkdir.bind(fs),
    open: fs.open.bind(fs),
    unlink: fs.unlink.bind(fs),
    rename: async () => { throw new Error("injected_rename_failure"); },
  };
  await assert.rejects(writeAtomicJson(filePath, { schemaVersion: 1 }, { fsApi: failingFs }), /injected_rename_failure/);
  await assert.rejects(fs.access(filePath));
  assert.deepEqual((await fs.readdir(directory)).filter((name) => name.endsWith(".tmp")), []);
});

test("artifact failure prevents every source state write", async () => {
  const writes = [];
  const writer = async (filePath) => {
    writes.push(filePath);
    if (filePath === "audit.json") throw new Error("artifact_failed");
  };
  await assert.rejects(commitRetrievalTransaction({
    artifactPath: "audit.json",
    artifact: { schemaVersion: RETRIEVAL_AUDIT_SCHEMA_VERSION },
    stateUpdates: [{ path: "state.json", state: { schemaVersion: 1 } }],
    atomicWriter: writer,
  }), /artifact_failed/);
  assert.deepEqual(writes, ["audit.json"]);
});

test("successful transaction writes the artifact before source states", async () => {
  const writes = [];
  await commitRetrievalTransaction({
    artifactPath: "audit.json",
    artifact: { schemaVersion: RETRIEVAL_AUDIT_SCHEMA_VERSION },
    stateUpdates: [{ path: "rss.json", state: { schemaVersion: 1 } }, { path: "pubmed.json", state: { schemaVersion: 1 } }],
    atomicWriter: async (filePath) => { writes.push(filePath); },
  });
  assert.deepEqual(writes, ["audit.json", "rss.json", "pubmed.json"]);
});

test("failed retrieval preserves boundary and validators while separating availability from yield", () => {
  const previous = {
    committed: { committedThrough: "2026-08-01" },
    validators: { etag: "old" },
    health: { yield: { successfulSamples: [4, 5, 6] } },
  };
  const state = buildSourceState({
    previous,
    profile: "weekly",
    source: "pubmed",
    queryHash: "b".repeat(64),
    adapterVersion: "test",
    proposal: { complete: false, failureStage: "paging", error: "HTTP_503" },
    checkedAt: "2026-08-04T00:00:00.000Z",
  });
  assert.deepEqual(state.committed, previous.committed);
  assert.deepEqual(state.validators, previous.validators);
  assert.equal(state.health.availability.status, "unavailable");
  assert.deepEqual(state.health.yield.successfulSamples, [4, 5, 6]);
});

test("two zero-yield successes do not create a low-cardinality anomaly", () => {
  const state = buildSourceState({
    previous: { health: { yield: { successfulSamples: [0] } } },
    profile: "weekly",
    source: "rss-test",
    queryHash: "c".repeat(64),
    adapterVersion: "test",
    proposal: { complete: true, itemCount: 0, committed: { lastSuccessfulCheck: "now" } },
    checkedAt: "2026-08-04T00:00:00.000Z",
  });
  assert.deepEqual(state.health.yield.successfulSamples, [0, 0]);
  assert.equal(state.health.yield.anomaly, false);
});

test("availability and yield produce independent health keys without query contents", () => {
  const queryHash = "d".repeat(64);
  const state = buildSourceState({ profile: "weekly", source: "rss-test", queryHash, adapterVersion: "test", proposal: { complete: false, failureStage: "request" }, checkedAt: "2026-08-04T00:00:00.000Z" });
  const observations = sourceHealthObservations([{ state }]);
  assert.deepEqual(observations.map((item) => item.kind), ["source_availability", "source_yield"]);
  assert.notEqual(observations[0].healthKey, observations[1].healthKey);
  assert.equal(observations[0].degraded, true);
  assert.equal(JSON.stringify(observations).includes("request"), false);
});
