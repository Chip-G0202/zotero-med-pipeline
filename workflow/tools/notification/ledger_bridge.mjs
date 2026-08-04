export async function completeLedgerNotification(store, operation, delivery) {
  let current = store.ledger.operations.find((item) => item.idempotencyKey === operation.idempotencyKey);
  if (delivery.status === "accepted") {
    if (current.status === "pending" || current.status === "failed") await store.transition(current.idempotencyKey, "started");
    current = store.ledger.operations.find((item) => item.idempotencyKey === operation.idempotencyKey);
    if (current.status === "started") await store.transition(current.idempotencyKey, "remote_observed", { verification: { receiptStatus: "accepted", receiptId: delivery.receipt?.receiptId || "" }, target: { receiptPath: delivery.receiptPath } });
    current = store.ledger.operations.find((item) => item.idempotencyKey === operation.idempotencyKey);
    if (current.status === "remote_observed") await store.transition(current.idempotencyKey, "verified", { verification: { receiptStatus: "accepted", receiptId: delivery.receipt?.receiptId || "" } });
    return;
  }
  if (current.status === "pending") await store.transition(current.idempotencyKey, "started");
  current = store.ledger.operations.find((item) => item.idempotencyKey === operation.idempotencyKey);
  if (current.status === "started") await store.transition(current.idempotencyKey, "failed", {
    error: delivery.status === "unknown" ? "NOTIFICATION_STATUS_UNKNOWN_POSSIBLY_ACCEPTED" : `NOTIFICATION_${String(delivery.status || "FAILED").toUpperCase()}`,
    verification: { receiptStatus: delivery.status, receiptId: delivery.receipt?.receiptId || "" },
    target: { receiptPath: delivery.receiptPath },
  });
}
