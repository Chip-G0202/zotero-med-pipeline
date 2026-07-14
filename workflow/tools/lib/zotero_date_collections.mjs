/**
 * Zotero date collection utilities
 */

export function parseDateNameToDate(name) {
  const m = String(name || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function parseYearFromParents(parents = []) {
  for (const parent of parents || []) {
    const match = String(parent || "").match(/^(\d{2})\.(\d{2})$/);
    if (match) return 2000 + Number(match[1]);
  }
  return new Date().getFullYear();
}

export function parseMonthDayCollectionDate(name, parents = []) {
  const m = String(name || '').match(/^(\d{2})\.(\d{2})$/);
  if (!m) return null;
  const year = parseYearFromParents(parents);
  return new Date(year, Number(m[1]) - 1, Number(m[2]));
}

export function collectRecentDateCollectionNodes(nodes, options = {}) {
  const { now = new Date(), windowDays = 7 } = options instanceof Date
    ? { now: options, windowDays: arguments[2] ?? 7 }
    : options;
  const result = [];
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - windowDays);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  function visit(collections = [], parents = []) {
    for (const node of collections || []) {
      const dt = parseDateNameToDate(node.name) || parseMonthDayCollectionDate(node.name, parents);
      if (dt && dt >= start && dt <= end) {
        result.push(node);
      }
      visit(node.subcollections || [], [...parents, node.name]);
    }
  }

  visit(nodes, []);
  return result;
}
