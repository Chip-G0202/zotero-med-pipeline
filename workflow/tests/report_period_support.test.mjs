import assert from "node:assert/strict";
import test from "node:test";

import {
  dayLabel,
  isLastDueRunOfMonth,
  monthLabel,
  monthPeriod,
} from "../tools/lib/report_period_support.mjs";

test("formats month and day labels for review folders", () => {
  const date = new Date("2026-06-06T15:00:00+08:00");

  assert.equal(monthLabel(date), "26.06");
  assert.equal(dayLabel(date), "06.06");
});

test("detects the final due run in a 31-day month", () => {
  assert.equal(isLastDueRunOfMonth(new Date("2026-07-29T15:00:00+08:00"), 2), false);
  assert.equal(isLastDueRunOfMonth(new Date("2026-07-31T15:00:00+08:00"), 2), true);
});

test("detects the final due run in a 30-day month", () => {
  assert.equal(isLastDueRunOfMonth(new Date("2026-06-28T15:00:00+08:00"), 2), false);
  assert.equal(isLastDueRunOfMonth(new Date("2026-06-29T15:00:00+08:00"), 2), true);
});

test("handles February and leap years", () => {
  assert.equal(isLastDueRunOfMonth(new Date("2026-02-27T15:00:00+08:00"), 2), true);
  assert.equal(isLastDueRunOfMonth(new Date("2028-02-27T15:00:00+08:00"), 2), false);
  assert.equal(isLastDueRunOfMonth(new Date("2028-02-28T15:00:00+08:00"), 2), true);
});

test("uses the configured interval when detecting the final due run", () => {
  assert.equal(isLastDueRunOfMonth(new Date("2026-06-28T15:00:00+08:00"), 3), true);
  assert.equal(isLastDueRunOfMonth(new Date("2026-06-27T15:00:00+08:00"), 3), false);
});

test("builds current month period labels", () => {
  const period = monthPeriod(new Date("2026-06-15T15:00:00+08:00"));

  assert.equal(period.label, "26.06");
  assert.equal(period.startIso, "2026-06-01");
  assert.equal(period.endIso, "2026-06-30");
});
