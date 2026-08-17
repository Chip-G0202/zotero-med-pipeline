import assert from "node:assert/strict";
import test from "node:test";

import { AdaptiveConcurrencyController, concurrencyPressureSignal, parseServerDelayMs } from "../tools/lib/adaptive_concurrency.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("stable responses increase concurrency gradually without crossing max", () => {
  const controller = new AdaptiveConcurrencyController({ service: "source_http", minConcurrency: 1, initialConcurrency: 1, maxConcurrency: 3, successWindow: 2 });
  controller.recordSuccess(10);
  assert.equal(controller.currentConcurrency, 1);
  controller.recordSuccess(10);
  assert.equal(controller.currentConcurrency, 2);
  controller.recordSuccess(10);
  assert.equal(controller.currentConcurrency, 2);
  controller.recordSuccess(10);
  assert.equal(controller.currentConcurrency, 3);
  for (let index = 0; index < 20; index += 1) controller.recordSuccess(10);
  assert.equal(controller.currentConcurrency, 3);
});

test("429 immediately reduces concurrency and recovery remains additive", () => {
  const controller = new AdaptiveConcurrencyController({ service: "llm", minConcurrency: 1, initialConcurrency: 4, maxConcurrency: 4, successWindow: 2 });
  const error = Object.assign(new Error("HTTP_429"), { status: 429 });
  controller.recordFailure(error);
  assert.equal(controller.currentConcurrency, 2);
  controller.recordSuccess(10);
  assert.equal(controller.currentConcurrency, 2);
  controller.recordSuccess(10);
  assert.equal(controller.currentConcurrency, 3);
});

test("Retry-After blocks queued work for at least the server interval", async () => {
  const controller = new AdaptiveConcurrencyController({ service: "source_http", minConcurrency: 1, initialConcurrency: 1, maxConcurrency: 1 });
  controller.recordServerDirective({ retryAfterMs: 25 });
  const started = Date.now();
  await controller.run(async () => "ok");
  assert.ok(Date.now() - started >= 18);
  assert.equal(controller.snapshot().retryAfterSignals, 1);
});

test("Backoff blocks queued work for at least the server interval", async () => {
  const controller = new AdaptiveConcurrencyController({ service: "zotero_web_api", minConcurrency: 1, initialConcurrency: 1, maxConcurrency: 1 });
  controller.recordServerDirective({ backoffMs: 25 });
  const started = Date.now();
  await controller.run(async () => "ok");
  assert.ok(Date.now() - started >= 18);
  assert.equal(controller.snapshot().backoffSignals, 1);
});

test("consecutive transient failures and sustained latency degradation reduce concurrency", () => {
  const failures = new AdaptiveConcurrencyController({ service: "source_http", initialConcurrency: 4, maxConcurrency: 4, failureWindow: 2 });
  failures.recordFailure(Object.assign(new Error("server unavailable"), { status: 503 }));
  assert.equal(failures.currentConcurrency, 4);
  failures.recordFailure(Object.assign(new Error("server unavailable"), { status: 503 }));
  assert.equal(failures.currentConcurrency, 2);

  const latency = new AdaptiveConcurrencyController({ service: "llm", initialConcurrency: 4, maxConcurrency: 4, latencyMultiplier: 2, latencyWindow: 3, successWindow: 100 });
  latency.recordSuccess(10);
  latency.recordSuccess(30);
  latency.recordSuccess(30);
  latency.recordSuccess(30);
  assert.equal(latency.currentConcurrency, 2);
});

test("service controllers are isolated", () => {
  const source = new AdaptiveConcurrencyController({ service: "source_http", initialConcurrency: 4, maxConcurrency: 4 });
  const llm = new AdaptiveConcurrencyController({ service: "llm", initialConcurrency: 4, maxConcurrency: 4 });
  source.recordFailure(Object.assign(new Error("rate limit"), { status: 429 }));
  assert.equal(source.currentConcurrency, 2);
  assert.equal(llm.currentConcurrency, 4);
});

test("concurrent callers share one limiter and never multiply the hard cap", async () => {
  const controller = new AdaptiveConcurrencyController({ service: "zotero_web_api", initialConcurrency: 4, maxConcurrency: 4, successWindow: 100 });
  let active = 0;
  let observedPeak = 0;
  const mapper = async (value) => {
    active += 1;
    observedPeak = Math.max(observedPeak, active);
    await delay(4);
    active -= 1;
    return value;
  };
  const [left, right] = await Promise.all([
    controller.map([1, 2, 3, 4], mapper),
    controller.map([5, 6, 7, 8], mapper),
  ]);
  assert.deepEqual(left, [1, 2, 3, 4]);
  assert.deepEqual(right, [5, 6, 7, 8]);
  assert.equal(observedPeak, 4);
  assert.equal(controller.snapshot().peak_concurrency, 4);
});

test("pressure classification recognizes explicit service signals but not business conflicts", () => {
  assert.equal(concurrencyPressureSignal(Object.assign(new Error("limited"), { status: 429 })).immediate, true);
  assert.equal(concurrencyPressureSignal(null, { retryAfterMs: 10 }).pressure, true);
  assert.equal(concurrencyPressureSignal(null, { backoffMs: 10 }).pressure, true);
  assert.equal(concurrencyPressureSignal(Object.assign(new Error("conflict"), { status: 412 })).pressure, false);
  assert.equal(parseServerDelayMs("2"), 2000);
  assert.equal(parseServerDelayMs("Thu, 01 Jan 2026 00:00:02 GMT", () => Date.parse("Thu, 01 Jan 2026 00:00:00 GMT")), 2000);
});
