// preference_utils.mjs
// Pure utility functions extracted from preference_refinement.mjs for reuse and testing.

import { createHash } from "node:crypto";

// ─── Utility Functions ───────────────────────────────────────────────

export function nowIso(input) {
  if (input && typeof input === "string") return input;
  return new Date().toISOString();
}

export function normalizeFeedback(value) {
  return String(value || "").trim().toLowerCase();
}

export function directionFromFeedback(feedback) {
  if (!feedback) return "ignored";
  if (feedback === "keep") return "positive";
  if (feedback === "upgrade") return "positive";
  if (feedback === "downgrade") return "negative";
  if (feedback === "drop") return "negative";
  return "ignored";
}

export function feedbackProfile(feedback) {
  const strength = feedback === "upgrade" || feedback === "drop" ? "strong" : feedback === "keep" || feedback === "downgrade" ? "moderate" : "none";
  const weight = strength === "strong" ? 1.5 : strength === "moderate" ? 1 : 0;
  return { strength, weight };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

export function splitList(value) {
  if (Array.isArray(value)) return uniq(value.map((entry) => String(entry).trim()).filter(Boolean));
  return uniq(String(value || "").split(/[|,]/).map((entry) => entry.trim()).filter(Boolean));
}

export function normalizeList(value) {
  return uniq((Array.isArray(value) ? value : [value]).flatMap((entry) => splitList(entry)));
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stableHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

export function sortByOrder(values, order) {
  return [...values].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}
