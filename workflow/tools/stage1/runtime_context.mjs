export function resolveStage1ManualTrigger(triggerMode) {
  const value = String(triggerMode || "").trim().toLowerCase();
  if (!value) return "unknown";
  return value !== "scheduled" && value !== "background";
}

export function formatStage1Date(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
