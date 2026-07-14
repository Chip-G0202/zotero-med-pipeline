export function normalizeDoi(value) {
  if (value === null || value === undefined) return "";
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/^doi:\s*/, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .trim();
  return /^10\.\d{4,9}\/\S+$/.test(normalized) ? normalized : "";
}
