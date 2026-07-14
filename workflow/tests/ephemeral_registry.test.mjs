import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EphemeralRegistry } from "../tools/lib/ephemeral_registry.mjs";
import { recordImmediateCleanup } from "../tools/lib/runtime_housekeeping.mjs";
import { ZoteroCliBackend } from "../tools/lib/zotero_cli_backend.mjs";

async function tempRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperflow-ephemeral-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("only an explicitly registered, closed, consumed file is deleted", async (t) => {
  const root = await tempRoot(t);
  const registered = path.join(root, "local_export_source.json");
  const lookalike = path.join(root, "local_export_source-copy.json");
  await Promise.all([fs.writeFile(registered, "source"), fs.writeFile(lookalike, "keep")]);
  const registry = new EphemeralRegistry({ allowedRoots: [root] });
  const token = registry.register({ path: registered, ownerStage: "local_stage4", cleanupWhen: "after_use" });
  token.markClosed();
  assert.equal((await registry.cleanup({ success: true })).immediateDeletedFiles, 0);
  token.markConsumed();
  const summary = await registry.cleanup({ success: true });
  assert.equal(summary.immediateDeletedFiles, 1);
  await assert.rejects(fs.stat(registered), { code: "ENOENT" });
  assert.equal(await fs.readFile(lookalike, "utf8"), "keep");
});

test("preserveOnFailure and after_success retain diagnostic files", async (t) => {
  const root = await tempRoot(t);
  const preserved = path.join(root, "preserved.tmp");
  const successOnly = path.join(root, "success.tmp");
  await Promise.all([fs.writeFile(preserved, "x"), fs.writeFile(successOnly, "y")]);
  const registry = new EphemeralRegistry({ allowedRoots: [root] });
  const first = registry.register({ path: preserved, ownerStage: "test", cleanupWhen: "always_after_close", preserveOnFailure: true });
  const second = registry.register({ path: successOnly, ownerStage: "test", cleanupWhen: "after_success" });
  first.markClosed(); second.markClosed();
  await registry.cleanup({ success: false });
  assert.equal((await fs.stat(preserved)).isFile(), true);
  assert.equal((await fs.stat(successOnly)).isFile(), true);
  await registry.cleanup({ success: true });
  await assert.rejects(fs.stat(preserved), { code: "ENOENT" });
  await assert.rejects(fs.stat(successOnly), { code: "ENOENT" });
});

test("formal artifacts, paths outside roots, and symlinks fail closed", async (t) => {
  const root = await tempRoot(t);
  const formal = path.join(root, "周报.xlsx");
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.tmp`);
  await Promise.all([fs.writeFile(formal, "formal"), fs.writeFile(outside, "outside")]);
  t.after(() => fs.rm(outside, { force: true }));
  const registry = new EphemeralRegistry({ allowedRoots: [root], formalArtifacts: [formal] });
  assert.equal(registry.register({ path: formal, ownerStage: "test", cleanupWhen: "after_success" }).accepted, false);
  assert.equal(registry.register({ path: outside, ownerStage: "test", cleanupWhen: "after_success" }).accepted, false);
  const link = path.join(root, "link.tmp");
  try { await fs.symlink(outside, link, "file"); }
  catch (error) { if (["EPERM", "EACCES"].includes(error?.code)) return; throw error; }
  const token = registry.register({ path: link, ownerStage: "test", cleanupWhen: "always_after_close" });
  token.markClosed();
  const summary = await registry.cleanup({ success: true });
  assert.equal(summary.immediateFailedCount, 1);
  assert.equal(await fs.readFile(outside, "utf8"), "outside");
});

test("one unlink failure becomes a warning while another registered file is deleted", async (t) => {
  const root = await tempRoot(t);
  const blocked = path.join(root, "blocked.tmp");
  const safe = path.join(root, "safe.tmp");
  await Promise.all([fs.writeFile(blocked, "x"), fs.writeFile(safe, "y")]);
  const fsApi = new Proxy(fs, { get(target, key) {
    if (key === "unlink") return async (value) => { if (path.resolve(value) === blocked) throw Object.assign(new Error("permission denied"), { code: "EACCES" }); return target.unlink(value); };
    return target[key];
  } });
  const registry = new EphemeralRegistry({ allowedRoots: [root], fsApi });
  const a = registry.register({ path: blocked, ownerStage: "test", cleanupWhen: "always_after_close" });
  const b = registry.register({ path: safe, ownerStage: "test", cleanupWhen: "always_after_close" });
  a.markClosed(); b.markClosed();
  const summary = await registry.cleanup({ success: true });
  assert.equal(summary.immediateFailedCount, 1);
  assert.equal(summary.immediateDeletedFiles, 1);
  assert.equal((await fs.stat(blocked)).isFile(), true);
  await assert.rejects(fs.stat(safe), { code: "ENOENT" });
});

test("Zotero CLI import JSON is registered and removed after the CLI consumer closes", async () => {
  const registry = new EphemeralRegistry({ allowedRoots: [os.tmpdir()] });
  let importPath = "";
  let importTag = "";
  const backend = new ZoteroCliBackend({
    launchDesktop: false,
    ephemeralRegistry: registry,
    executeCli: async (_tool, args) => {
      if (args[0] === "import") { importPath = args[2]; importTag = args[args.indexOf("--tag") + 1]; return { exitCode: 0, stdout: "", stderr: "", data: {} }; }
      if (args[0] === "collection") return { exitCode: 0, stdout: "", stderr: "", data: [{ key: "ITEM1", title: "Ephemeral test", tags: [{ tag: importTag }] }] };
      return { exitCode: 0, stdout: "", stderr: "", data: {} };
    },
  });
  const created = await backend.createItemViaImport({ title: "Ephemeral test", collections: [{ key: "C1", name: "A课题相关" }] });
  assert.equal(created.itemKey, "ITEM1");
  assert.match(importPath, /zotero-cli-import-.*\.json$/);
  await assert.rejects(fs.stat(importPath), { code: "ENOENT" });
  assert.equal(registry.summary().immediateDeletedFiles, 1);
});

test("immediate cleanup stats atomically update only the latest housekeeping receipt", async (t) => {
  const root = await tempRoot(t);
  const result = await recordImmediateCleanup({
    runtimeRoot: root,
    summary: { immediateDeletedFiles: 2, immediateDeletedBytes: 12, immediateFailedCount: 1, warnings: ["mock_warning"], samples: ["run/source.tmp"] },
    now: new Date("2030-01-01T00:00:00.000Z"),
  });
  const receipt = JSON.parse(await fs.readFile(result.receiptPath, "utf8"));
  assert.equal(receipt.immediateDeletedFiles, 2);
  assert.equal(receipt.immediateDeletedBytes, 12);
  assert.equal(receipt.immediateFailedCount, 1);
  assert.deepEqual((await fs.readdir(path.dirname(result.receiptPath))).filter((name) => name.endsWith(".tmp")), []);
});
