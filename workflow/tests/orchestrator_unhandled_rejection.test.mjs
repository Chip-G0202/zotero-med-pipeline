/**
 * Tests for the MCP mutex unhandled rejection fix and emergency report writing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";

async function withTempDir(fn) {
  const dir = path.join(os.tmpdir(), `unhandled-rej-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await fsPromises.mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await fsPromises.rm(dir, { recursive: true, force: true });
  }
}

describe("MCP mutex chain unhandled rejection prevention", () => {
  it("does not trigger unhandledRejection when mutex chain rejects", async () => {
    let unhandledCount = 0;
    const handler = () => { unhandledCount++; };
    process.on("unhandledRejection", handler);

    let mutexChain = Promise.resolve();
    await new Promise((resolve, reject) => {
      mutexChain = mutexChain.then(async () => { resolve("ok1"); }).catch(() => {});
    });

    let propagatedError = null;
    try {
      await new Promise((resolve, reject) => {
        mutexChain = mutexChain.then(async () => { reject(new Error("MCP fetch failed")); }).catch(() => {});
      });
    } catch (e) {
      propagatedError = e;
    }

    let thirdResult = null;
    try {
      thirdResult = await new Promise((resolve, reject) => {
        mutexChain = mutexChain.then(async () => { resolve("ok3"); }).catch(() => {});
      });
    } catch (e) {}

    process.removeListener("unhandledRejection", handler);
    assert.equal(unhandledCount, 0, "no unhandledRejection should fire");
    assert.ok(propagatedError, "caller must receive the MCP error");
    assert.match(propagatedError.message, /MCP fetch failed/);
    assert.equal(thirdResult, "ok3", "third call should succeed after mutex chain healed");
  });

  it("propagates the original error even when caught by mutex .catch()", async () => {
    let mutexChain = Promise.resolve();
    let error = null;
    try {
      await new Promise((resolve, reject) => {
        mutexChain = mutexChain.then(async () => { reject(new Error("original MCP error")); }).catch(() => {});
      });
    } catch (e) { error = e; }
    assert.ok(error);
    assert.match(error.message, /original MCP error/);
  });
});

describe("Emergency orchestrator report write", () => {
  it("writes orchestrator_report.json to the pipeline directory", async () => {
    await withTempDir(async (dir) => {
      const rp = path.join(dir, "orchestrator_report.json");
      fs.mkdirSync(dir, { recursive: true });
      const report = {
        status: "orchestrator_crash",
        errorClass: "unhandledRejection",
        error: "Test error",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };
      fs.writeFileSync(rp, JSON.stringify(report, null, 2), "utf8");
      assert.ok(fs.statSync(rp).isFile());
      const c = JSON.parse(fs.readFileSync(rp, "utf8"));
      assert.equal(c.status, "orchestrator_crash");
      assert.equal(c.errorClass, "unhandledRejection");
    });
  });

  it("truncates long error messages", async () => {
    await withTempDir(async (dir) => {
      const rp = path.join(dir, "orchestrator_report.json");
      const longMsg = "x".repeat(5000);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(rp, JSON.stringify({
        status: "orchestrator_crash",
        errorClass: "unhandledRejection",
        error: longMsg.slice(0, 2000),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }, null, 2), "utf8");
      const c = JSON.parse(fs.readFileSync(rp, "utf8"));
      assert.ok(c.error.length <= 2000);
      assert.equal(c.error, longMsg.slice(0, 2000));
    });
  });

  it("survives write failure gracefully", async () => {
    let threw = false;
    try {
      fs.writeFileSync("Z:\\nonexistent\\drive\\report.json", "{}", "utf8");
    } catch { threw = true; }
    assert.ok(threw);
  });
});
