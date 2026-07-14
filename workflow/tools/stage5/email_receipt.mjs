import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { registerEphemeral } from "../lib/ephemeral_registry.mjs";

export function recipientHash(recipient) { return createHash("sha256").update(String(recipient).trim().toLowerCase()).digest("hex"); }
export function receiptPathFor(outputRoot) { return path.join(path.resolve(outputRoot), "stage5", "email_receipt.json"); }

export async function readReceipt(receiptPath, { fsApi = fs } = {}) {
  try { return JSON.parse(await fsApi.readFile(receiptPath, "utf8")); } catch { return null; }
}

export async function writeReceipt(receiptPath, receipt, { fsApi = fs } = {}) {
  await fsApi.mkdir(path.dirname(receiptPath), { recursive: true });
  const temporary = `${receiptPath}.${process.pid}.${randomUUID()}.tmp`;
  const temporaryRegistration = registerEphemeral({ path: temporary, ownerStage: "stage5_receipt", cleanupWhen: "always_after_close" });
  let handle;
  try {
    handle = await fsApi.open(temporary, "wx");
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    if (typeof handle.sync === "function") await handle.sync();
    await handle.close();
    handle = null;
    await fsApi.rename(temporary, receiptPath);
    temporaryRegistration.forget();
  } finally {
    if (handle) await handle.close().catch(() => {});
    temporaryRegistration.markClosed();
    await fsApi.unlink(temporary).then(() => temporaryRegistration.forget()).catch(() => {});
  }
}

export async function withReceiptLock(receiptPath, operation, { fsApi = fs } = {}) {
  const lockPath = `${receiptPath}.lock`;
  await fsApi.mkdir(path.dirname(receiptPath), { recursive: true });
  let handle;
  try { handle = await fsApi.open(lockPath, "wx"); }
  catch (error) { if (error?.code === "EEXIST") return { locked: false }; throw error; }
  const lockRegistration = registerEphemeral({ path: lockPath, ownerStage: "stage5_receipt", cleanupWhen: "always_after_close" });
  try { return { locked: true, value: await operation() }; }
  finally { await handle.close().catch(() => {}); lockRegistration.markClosed(); await fsApi.unlink(lockPath).then(() => lockRegistration.forget()).catch(() => {}); }
}
