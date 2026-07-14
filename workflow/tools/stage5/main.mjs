import fs from "node:fs/promises";
import path from "node:path";
import { formatStage5Report } from "./report_summary.mjs";
import { emailTransportConfig, sendStage5Email } from "./email_sender.mjs";
import { readReceipt, receiptPathFor, recipientHash, withReceiptLock, writeReceipt } from "./email_receipt.mjs";
import { generateLiteratureOverview } from "./literature_overview.mjs";

const MAX_ATTACHMENTS = 2;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Map([["weekly_xlsx", ".xlsx"], ["monthly_docx", ".docx"]]);

export function resolveStage5Request(argv = process.argv.slice(2), env = process.env) {
  const equals = argv.find((arg) => String(arg).startsWith("--email="));
  const index = argv.indexOf("--email");
  const cliRecipient = equals ? String(equals).slice("--email=".length) : index >= 0 ? argv[index + 1] : "";
  const recipient = String(cliRecipient || env.PAPERFLOW_REPORT_TO || env.NOTIFICATION_EMAIL || "").trim();
  return { recipient, forceResend: argv.includes("--force-resend"), source: cliRecipient ? "cli" : env.PAPERFLOW_REPORT_TO ? "PAPERFLOW_REPORT_TO" : env.NOTIFICATION_EMAIL ? "NOTIFICATION_EMAIL" : "none" };
}

export function isValidRecipient(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "")) && String(value).length <= 254; }
function isWithin(root, candidate) { const relative = path.relative(path.resolve(root), path.resolve(candidate)); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }

export async function prepareStage5Attachments(runSummary, { fsApi = fs } = {}) {
  const artifacts = Array.isArray(runSummary.artifacts) ? runSummary.artifacts : [];
  if (artifacts.length > MAX_ATTACHMENTS) throw Object.assign(new Error("ATTACHMENT_COUNT_LIMIT"), { category: "attachment_limit" });
  const attachments = [];
  let totalBytes = 0;
  for (const item of artifacts) {
    const extension = ALLOWED.get(item.kind);
    if (!extension) throw Object.assign(new Error(`ATTACHMENT_KIND_BLOCKED:${item.kind || "missing"}`), { category: "attachment_blocked" });
    const resolved = path.resolve(String(item.path || ""));
    if (!isWithin(runSummary.outputRoot, resolved)) throw Object.assign(new Error("ATTACHMENT_OUTSIDE_OUTPUT_ROOT"), { category: "attachment_path_blocked" });
    if (path.extname(resolved).toLowerCase() !== extension) throw Object.assign(new Error("ATTACHMENT_EXTENSION_BLOCKED"), { category: "attachment_blocked" });
    let stat;
    try { stat = await fsApi.stat(resolved); }
    catch (error) { throw Object.assign(new Error(`ATTACHMENT_UNREADABLE:${error?.code || "unknown"}`), { category: "attachment_unreadable" }); }
    if (!stat.isFile()) throw Object.assign(new Error("ATTACHMENT_NOT_FILE"), { category: "attachment_unreadable" });
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw Object.assign(new Error("ATTACHMENT_TOTAL_SIZE_LIMIT"), { category: "attachment_limit" });
    attachments.push({ filename: path.basename(String(item.displayName || resolved)), path: resolved, sizeBytes: stat.size });
  }
  return attachments;
}

export async function runStage5Notification({ runSummary, literatureItems = [], recipient, forceResend = false, transport, config = {} } = {}) {
  if (!String(recipient || "").trim()) return { status: "skipped", reason: "recipient_not_configured", attachments: [] };
  if (!isValidRecipient(recipient)) return { status: "failed", reason: "recipient_invalid", attachments: [] };
  const normalizedRecipient = String(recipient).trim().toLowerCase();
  const hash = recipientHash(normalizedRecipient);
  const stateRoot = path.resolve(config.runStateRoot || runSummary.outputRoot);
  const receiptPath = receiptPathFor(stateRoot);
  const legacyReceiptPath = receiptPathFor(runSummary.outputRoot);
  const fsApi = config.fsApi || fs;
  const locked = await withReceiptLock(receiptPath, async () => {
    const previous = await readReceipt(receiptPath, { fsApi })
      || (legacyReceiptPath !== receiptPath ? await readReceipt(legacyReceiptPath, { fsApi }) : null);
    if (!forceResend && previous?.status === "sent" && previous.runId === runSummary.runId && previous.recipientHash === hash) return { status: "skipped", reason: "already_sent", receiptPath, attachments: previous.attachmentNames || [] };
    let attachments = [];
    try {
      attachments = await prepareStage5Attachments(runSummary, { fsApi });
      if (!transport) {
        const mailConfig = emailTransportConfig(config.env || process.env);
        if (!mailConfig.configured) throw Object.assign(new Error(mailConfig.error), { category: mailConfig.missing.length ? "transport_not_configured" : "smtp_config_invalid" });
      }
      const overview = await generateLiteratureOverview({ runSummary, literatureItems, llmClient: config.llmClient || null, runtime: config.llmRuntime || null, fsApi, stateRoot, legacyStateRoot: runSummary.outputRoot });
      const report = formatStage5Report(runSummary, { overview: overview.overview });
      const result = await (transport || ((message) => sendStage5Email(message, { env: config.env || process.env })))( { ...report, to: normalizedRecipient, attachments });
      const receipt = { schemaVersion: 1, runId: runSummary.runId, status: "sent", sentAt: new Date().toISOString(), recipientHash: hash, messageId: String(result?.messageId || ""), attachmentNames: attachments.map((item) => item.filename), errorCategory: null };
      await writeReceipt(receiptPath, receipt, { fsApi });
      return { status: "sent", reason: "sent", messageId: receipt.messageId, receiptPath, attachments: receipt.attachmentNames };
    } catch (error) {
      const missingRetainedArtifact = forceResend && ["attachment_unreadable", "attachment_blocked"].includes(String(error?.category || ""));
      const errorCategory = missingRetainedArtifact ? "run_artifacts_expired_or_missing" : String(error?.category || "send_failed");
      const receipt = { schemaVersion: 1, runId: runSummary.runId, status: "failed", sentAt: null, recipientHash: hash, messageId: "", attachmentNames: attachments.map((item) => item.filename), errorCategory };
      try { await writeReceipt(receiptPath, receipt, { fsApi }); } catch {}
      return { status: "failed", reason: errorCategory, error: missingRetainedArtifact ? "运行结果已过保留期或附件不存在" : String(error?.message || "SMTP send failed").slice(0, 240), receiptPath, attachments: receipt.attachmentNames };
    }
  }, { fsApi });
  return locked.locked ? locked.value : { status: "skipped", reason: "send_in_progress", receiptPath, attachments: [] };
}
