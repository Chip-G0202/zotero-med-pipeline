import fs from "node:fs/promises";

import { getLiteratureIdentityKeys } from "../lib/literature_identity.mjs";
import { LocalRepository } from "../local/local_repository.mjs";
import { createFileReconciler, createWorkbookReconciler } from "./reconciliation.mjs";
import { hashFile } from "./operation_ledger.mjs";
import { writeNotificationReceipt } from "../stage5/email_receipt.mjs";

function artifactItems(artifact) {
  return Array.isArray(artifact) ? artifact : Array.isArray(artifact?.items) ? artifact.items : [];
}

function identities(items) {
  return new Set(items.flatMap((item) => getLiteratureIdentityKeys(item)));
}

function matchingPaper(expected, papers) {
  const keys = new Set(getLiteratureIdentityKeys(expected));
  return papers.find((paper) => getLiteratureIdentityKeys(paper).some((key) => keys.has(key))) || null;
}

function localFieldsMatch(expected, actual) {
  return ["title", "doi", "pmid", "pmcid", "final_grade", "grade", "shortTitle", "translatedTitle"]
    .filter((field) => expected[field] !== undefined && expected[field] !== null && String(expected[field]) !== "")
    .every((field) => String(actual?.[field] ?? "") === String(expected[field]));
}

export function buildLocalRecoveryReconcilers({ store, artifact, outputRoot, sharedIndexPath, exportExecutor, fsApi = fs } = {}) {
  const expectedItems = artifactItems(artifact);
  const expectedIdentities = identities(expectedItems);
  const state = {
    async observe(operation) {
      try {
        const outputHash = await hashFile(operation.target.path, { fsApi });
        if (operation.target.outputHash) return outputHash === operation.target.outputHash ? { state: "match", evidence: { outputHash } } : { state: "conflict", evidence: { expectedHash: operation.target.outputHash, actualHash: outputHash } };
        const snapshot = JSON.parse(await fsApi.readFile(operation.target.path, "utf8"));
        const papers = snapshot.papers || [];
        const present = identities(papers);
        const missingIdentityCount = [...expectedIdentities].filter((identity) => !present.has(identity)).length;
        if (missingIdentityCount) return { state: "absent", evidence: { missingIdentityCount } };
        const changed = expectedItems.filter((item) => !localFieldsMatch(item, matchingPaper(item, papers)));
        return changed.length ? { state: "conflict", evidence: { reason: "local_state_changed", changedIdentityCount: changed.length } } : { state: "match", target: { outputHash }, evidence: { outputHash, identityCount: expectedIdentities.size } };
      } catch (error) { return error?.code === "ENOENT" ? { state: "absent", evidence: { exists: false } } : { state: "conflict", evidence: { reason: String(error?.message || error) } }; }
    },
    async execute(operation) {
      const repository = await new LocalRepository(outputRoot, { sharedIndexPath }).load();
      repository.upsertPapers(expectedItems, { runId: store.ledger.runId });
      await repository.save();
      const outputHash = await hashFile(operation.target.path, { fsApi });
      return { target: { outputHash }, evidence: { outputHash } };
    },
    async verify(operation) { return this.observe(operation); },
  };
  const sharedIndex = {
    async observe(operation) {
      try {
        const outputHash = await hashFile(operation.target.path, { fsApi });
        if (operation.target.outputHash) return outputHash === operation.target.outputHash ? { state: "match", evidence: { outputHash } } : { state: "conflict", evidence: { expectedHash: operation.target.outputHash, actualHash: outputHash } };
        const index = JSON.parse(await fsApi.readFile(operation.target.path, "utf8"));
        const present = new Set(Object.keys(index.records || index.fingerprints?.title || {}));
        const hasRunRecords = Object.values(index.records || {}).some((record) => record?.last_run_id === store.ledger.runId || record?.local?.last_run_id === store.ledger.runId);
        return hasRunRecords || expectedIdentities.size === 0 ? { state: "match", target: { outputHash }, evidence: { outputHash, targeted: true } } : { state: "absent", evidence: { targeted: true, recordCount: present.size } };
      } catch (error) { return error?.code === "ENOENT" ? { state: "absent", evidence: { exists: false } } : { state: "conflict", evidence: { reason: String(error?.message || error) } }; }
    },
    async execute(operation) {
      await state.execute(operation);
      const outputHash = await hashFile(operation.target.path, { fsApi });
      return { target: { outputHash }, evidence: { outputHash } };
    },
    async verify(operation) { return this.observe(operation); },
  };
  const exportReconciler = createWorkbookReconciler({
    fsApi,
    execute: async (operation) => {
      if (typeof exportExecutor !== "function") throw new Error("RECOVERY_EXPORT_EXECUTOR_UNAVAILABLE");
      const result = await exportExecutor(operation, expectedItems);
      const outputPath = result?.outputPath || result?.exportAudit?.actual_output_path || "";
      if (!outputPath) throw new Error("RECOVERY_EXPORT_PATH_MISSING");
      const outputHash = await hashFile(outputPath, { fsApi });
      return { target: { path: outputPath, outputHash }, evidence: { outputHash } };
    },
  });
  return {
    local_state: state,
    shared_index: sharedIndex,
    metadata_state: createFileReconciler({ fsApi }),
    export: exportReconciler,
    notification: {
      async observe(operation) {
        try {
          const receipt = JSON.parse(await fsApi.readFile(operation.target.receiptPath || operation.target.path, "utf8"));
          if (receipt.schemaVersion === 2 && receipt.status === "pending" && receipt.attempts > 0) {
            const uncertain = { ...receipt, status: "unknown", updatedAt: new Date().toISOString(), lastSmtp: { outcome: "unknown", category: "interrupted_after_attempt_started", responseCode: null, acceptedCount: 0, rejectedCount: 0 } };
            await writeNotificationReceipt(operation.target.receiptPath || operation.target.path, uncertain, { fsApi });
            return { state: "ambiguous", evidence: { reason: "notification_possibly_accepted" } };
          }
          if (receipt.schemaVersion === 2 && receipt.status === "unknown") return { state: "ambiguous", evidence: { reason: "notification_possibly_accepted" } };
          const matches = ((receipt.schemaVersion === 1 && receipt.status === "sent") || (receipt.schemaVersion === 2 && receipt.status === "accepted")) && receipt.runId === store.ledger.runId
            && (!operation.verification?.messageId || receipt.messageId === operation.verification.messageId);
          return matches ? { state: "match", evidence: { receiptPath: operation.target.receiptPath, status: receipt.status } } : { state: "conflict", evidence: { reason: "notification_receipt_changed" } };
        } catch (error) { return error?.code === "ENOENT" ? { state: "absent", evidence: { reason: "notification_receipt_missing" } } : { state: "conflict", evidence: { reason: "notification_receipt_unreadable" } }; }
      },
      async execute() { throw new Error("NOTIFICATION_RECEIPT_SEMANTICS_REQUIRED"); },
    },
  };
}
