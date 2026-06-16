import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import {
  buildMonthlyReportPayload,
  generateMonthlyDocxReport,
} from "../tools/lib/monthly_docx_report.mjs";

test("builds a monthly payload for the current calendar month", () => {
  const payload = buildMonthlyReportPayload({
    now: new Date("2026-06-29T15:00:00+08:00"),
    recentRuns: [
      { date: "2026-06-06", status: "completed" },
      { date: "2026-06-29", status: "failed", failures: [{ stage: "stage4", reason: "example" }] },
      { date: "2026-05-30", status: "completed" },
    ],
  });

  assert.equal(payload.period.label, "26.06");
  assert.equal(payload.period.startIso, "2026-06-01");
  assert.equal(payload.period.endIso, "2026-06-30");
  assert.equal(payload.runStats.total, 2);
  assert.equal(payload.runStats.completed, 1);
  assert.equal(payload.runStats.failed, 1);
});

test("generates one overwritten monthly docx filename", async () => {
  const writes = [];
  const result = await generateMonthlyDocxReport({
    outputDirectory: "C:/tmp/review/26.06",
    payload: buildMonthlyReportPayload({ now: new Date("2026-06-29T15:00:00+08:00") }),
    write: async (outputPath, bodyXml) => {
      writes.push({ outputPath, bodyXml });
      return outputPath;
    },
  });

  assert.equal(result.fileName, "月报-26.06.docx");
  assert.equal(path.basename(result.outputPath), "月报-26.06.docx");
  assert.equal(writes.length, 1);
  assert.match(writes[0].bodyXml, /月度自动化运行汇总报告/);
});
