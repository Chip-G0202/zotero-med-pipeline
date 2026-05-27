import path from "node:path";
import { runFeedbackLearningDiagnostic } from "./lib/feedback_learning_support.mjs";

const ROOT = process.env.ZOTERO_PROJECT_ROOT || path.resolve(".");
const RESEARCH_ROOT = path.join(ROOT, "research_os");
const REVIEW_ROOT = path.join(RESEARCH_ROOT, "文献评价");
const DESKTOP_REVIEW_ROOT = process.env.DESKTOP_REVIEW_ROOT || path.join(ROOT, "research_os", "文献评价");

const writeArg = process.argv.find((x) => x.startsWith("--write-report"));
const writePath = writeArg && writeArg.includes("=")
  ? writeArg.split("=")[1]
  : null;

const report = runFeedbackLearningDiagnostic(new Date(), {
  reviewRoot: REVIEW_ROOT,
  desktopRoot: DESKTOP_REVIEW_ROOT,
  projectRoot: ROOT,
  researchRoot: RESEARCH_ROOT,
  writeReportPath: writePath,
});

console.log(JSON.stringify(report, null, 2));
