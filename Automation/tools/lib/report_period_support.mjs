const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function monthLabel(date = new Date()) {
  const d = new Date(date);
  return `${String(d.getFullYear()).slice(2)}.${pad2(d.getMonth() + 1)}`;
}

export function dayLabel(date = new Date()) {
  const d = new Date(date);
  return `${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}

export function yyMd(date = new Date()) {
  const d = new Date(date);
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
}

export function isoDate(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

export function isLastDueRunOfMonth(date = new Date(), intervalDays = 2) {
  const current = new Date(date);
  const interval = Math.max(1, Number(intervalDays || 2));
  const next = addDays(current, interval);
  return current.getFullYear() !== next.getFullYear() || current.getMonth() !== next.getMonth();
}

export function monthPeriod(date = new Date()) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    label: monthLabel(d),
    start,
    end,
    startIso: isoDate(start),
    endIso: isoDate(end),
  };
}

export function eachMonthDayLabel(date = new Date()) {
  const period = monthPeriod(date);
  const labels = [];
  for (let t = period.start.getTime(); t <= period.end.getTime(); t += DAY_MS) {
    labels.push(yyMd(new Date(t)));
  }
  return labels;
}
