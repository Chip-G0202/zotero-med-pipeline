import path from "node:path";
import { pathToFileURL } from "node:url";
import { runFeedbackLearningDiagnostic } from "../lib/feedback_learning_support.mjs";
import { buildRuntimeConfig } from "../lib/runtime_config.mjs";

const RUNTIME = buildRuntimeConfig();
const ROOT = RUNTIME.projectRoot || path.resolve(".");
const RESEARCH_ROOT = RUNTIME.researchRoot;
const REVIEW_ROOT = RUNTIME.reviewRoot;
const DESKTOP_REVIEW_ROOT = RUNTIME.legacyDesktopReviewRoot;

export function main(argv = process.argv) {
  const writeArg = argv.find((x) => x.startsWith("--write-report"));
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
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
