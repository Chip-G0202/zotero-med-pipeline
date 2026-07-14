/**
 * Date label support utilities
 */

export function yyMd(d) {
  return String(d.getFullYear()).slice(2) + '.' + (d.getMonth() + 1) + '.' + d.getDate();
}

export function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return date.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
}

export function fmtDateRfc(d) {
  return d.toISOString();
}
