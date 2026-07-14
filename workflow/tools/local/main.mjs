import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

import { importLocalCandidates } from "./local_import.mjs";
import { atomicWriteJson, LocalRepository, readFeedbackJsonl } from "./local_repository.mjs";
import { LocalTiming, formatTimingSummary } from "./local_timing.mjs";
import { buildExportManifest, buildRunSummary } from "../lib/run_summary.mjs";
import { buildLocalRuntimeConfig } from "../lib/runtime_config.mjs";
import { generateLiteratureTitleTranslations } from "../lib/title_translation_generation.mjs";
import { resolveStage5Request, runStage5Notification } from "../stage5/main.mjs";
import {
  finishRunGroup,
  recordImmediateCleanup,
  runRetentionCleanup,
  runStateRoot,
  startRunGroup,
} from "../lib/runtime_housekeeping.mjs";
import { activateEphemeralRegistry, EphemeralRegistry, registerEphemeral } from "../lib/ephemeral_registry.mjs";

const LOCAL_REPO_ROOT = path.resolve(new URL("../../..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));

export function parseLocalArgs(argv = process.argv.slice(2)) {
  const runtime = buildLocalRuntimeConfig({ argv, defaultRoot: path.join(LOCAL_REPO_ROOT, "review_results", "local") });
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    outputRoot: runtime.outputRoot,
    input: runtime.inputPath,
    feedback: runtime.feedbackPath,
    fixtureRoot: runtime.fixtureRoot,
    llmMode: runtime.llmMode,
    ...resolveStage5Request(argv),
  };
}

function feedbackRows(events, repository) {
  const byId = new Map(repository.papers.map((paper) => [paper.local_id, paper]));
  return events.map((event) => {
    const paper = byId.get(event.local_paper_id);
    return {
      event_id: event.event_id,
      local_paper_id: event.local_paper_id,
      title: event.payload?.title || paper?.title || "",
      feedback: event.action,
      comment: event.payload?.comment || "",
      rule_grade: paper?.rule_grade || paper?.grade || "",
      semantic_grade: paper?.semantic_grade || "",
      final_grade: paper?.final_grade || paper?.grade || "",
    };
  });
}

export async function runLocalPipeline(options = {}, dependencies = {}) {
  const runId = `local-${new Date().toISOString().replace(/[-:.]/g, "")}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const timing = dependencies.timing || new LocalTiming(runId);
  const timingPath = path.join(path.resolve(options.outputRoot || "."), "runs", runId, "timings.json");
  const writeTiming = dependencies.writeTiming || atomicWriteJson;
  let repository;
  let learningState;
  let imported = { items: [], errors: [], files: [] };
  let normalizedFeedbackRows = [];
  let consumedEventIds = new Set();
  let seenPendingEventIds = new Set();
  let stage1Result = null;
  let runGroupManifestPath = "";
  let housekeeping = { skipped: true, reason: "not_started", warnings: [] };
  let ephemeralRegistry = null;
  let restoreEphemeralRegistry = () => {};
  let localSourceRegistration = null;
  let stage4Succeeded = false;

  const previousEnv = { ...process.env };
  let businessError = null;
  let businessSucceeded = false;
  try {
    await timing.run("configuration", async () => {
      if (!options.outputRoot) throw new Error("LOCAL_OUTPUT_ROOT_REQUIRED");
      process.env.review_results_OUTPUT_ROOT = options.outputRoot;
      process.env.review_results_FORCE_RUN = "true";
      process.env.FORCE_review_results_RUN = "true";
      process.env.PAPERFLOW_ALLOW_FIXTURE_INPUT = "true";
      process.env.LLM_MODE = options.llmMode || "disabled";
    });
    const outputRoot = path.resolve(options.outputRoot);
    const runRoot = path.join(outputRoot, "runs");
    ephemeralRegistry = new EphemeralRegistry({
      allowedRoots: [os.tmpdir(), outputRoot, dependencies.sharedIndexPath ? path.dirname(path.resolve(dependencies.sharedIndexPath)) : path.join(LOCAL_REPO_ROOT, "review_results")],
    });
    restoreEphemeralRegistry = activateEphemeralRegistry(ephemeralRegistry);
    try {
      const group = await startRunGroup({
        runRoot,
        runId,
        pipelineMode: "local",
        startedAt,
        artifacts: [
          { kind: "run_state", rootKey: "runs", path: runId, retention: "30d" },
          { kind: "weekly_export", rootKey: "exports", path: runId, retention: "30d" },
          { kind: "local_export_source", rootKey: "runs", path: path.join(runId, "local_export_source.json"), retention: "ephemeral" },
        ],
      });
      runGroupManifestPath = group.manifestPath;
      housekeeping = await runRetentionCleanup({
        runtimeRoot: outputRoot,
        runRoot,
        allowedRoots: { runs: runRoot, exports: path.join(outputRoot, "exports"), local: outputRoot },
        legacyRoots: [path.join(outputRoot, "review_results", "pipeline")],
        repoRoot: LOCAL_REPO_ROOT,
        currentRunId: runId,
        env: process.env,
      });
    } catch (error) {
      housekeeping = { skipped: true, reason: "housekeeping_start_failed", warnings: [String(error?.message || error)] };
    }
    await timing.run("state_load", async () => {
      repository = dependencies.repository || await new LocalRepository(options.outputRoot, { sharedIndexPath: dependencies.sharedIndexPath }).load();
      learningState = await repository.loadLearningState();
    }, () => ({ paper_count: repository.papers.length }));
    if (options.input || options.fixtureRoot) {
      imported = await timing.run("local_import", async () => importLocalCandidates(options.input || path.join(options.fixtureRoot, "candidates.json")), (result) => ({ input_count: result.items.length, invalid_count: result.errors.length }));
      timing.skip("retrieval", "local_input_selected");
    } else {
      timing.skip("local_import", "no_local_input");
    }
    await timing.run("feedback_load", async () => {
      if (options.feedback) {
        const incoming = await readFeedbackJsonl(options.feedback, { tolerateIncompleteTail: false });
        for (const event of incoming) await repository.appendFeedback(event, { source: options.feedback });
      }
      const persistedFeedback = await readFeedbackJsonl(repository.feedbackPath);
      consumedEventIds = new Set(Array.isArray(learningState.consumed_feedback_event_ids) ? learningState.consumed_feedback_event_ids.map(String) : []);
      const pendingFeedback = [];
      seenPendingEventIds = new Set();
      for (const event of persistedFeedback) {
        const eventId = String(event?.event_id || "").trim();
        if (!eventId || consumedEventIds.has(eventId) || seenPendingEventIds.has(eventId)) continue;
        seenPendingEventIds.add(eventId);
        pendingFeedback.push(event);
      }
      normalizedFeedbackRows = feedbackRows(pendingFeedback, repository);
    }, () => ({ feedback_consumed_count: normalizedFeedbackRows.length }));
    const stage1 = dependencies.runStage1 || (await import(`../stage1/main.mjs?local=${Date.now()}`)).runResearchOsPipeline;
    stage1Result = await timing.run("stage1_pipeline", async () => stage1({
      argv: ["node", "workflow/tools/local/main.mjs", "--no-zotero-write"],
      candidateSource: imported.items.length ? imported.items : null,
      existingItemLookup: async (item) => repository.findExisting(item),
      normalizedFeedbackRows,
      feedbackSource: repository.feedbackPath,
      feedbackActionSink: async (rows) => ({
        feedback_used_for_item_actions: rows.length > 0,
        feedback_item_actions_default_enabled: true,
        feedback_item_actions_mode: "local",
        planned_actions_count: rows.length,
        executed_actions_count: rows.length,
        skipped_actions_count: 0,
        failed_actions_count: 0,
        collection_scope_guard_enabled: false,
        collection_scope_blocked_count: 0,
        collection_scope_blocked_samples: [],
        status: rows.length ? "applied_local" : "no_feedback_rows",
      }),
      skipZotero: true,
      zoteroBoundaries: dependencies.zoteroBoundaries || {},
    }), (result) => ({ candidate_count: result.triagedAll?.length || 0, feedback_consumed_count: normalizedFeedbackRows.length }));
    if (!stage1Result?.ok) throw new Error("LOCAL_STAGE1_INCOMPLETE");
    const translationTargets = (stage1Result.triagedAll || []).filter((item) => ["A", "B", "C"].includes(String(item.final_grade || item.grade || "").slice(0, 1)));
    const translationGenerator = dependencies.generateTitleTranslations || generateLiteratureTitleTranslations;
    const generatedTranslations = await timing.run("title_translation", async () => translationGenerator(translationTargets, {
      cachePath: dependencies.translationCachePath,
      translateTitlesBatchImpl: dependencies.translateTitlesBatch,
    }), (result) => ({ translated_count: result.generated_count, failure_count: result.failures.length }));
    const translatedByTitle = new Map(generatedTranslations.items.map((item) => [String(item.title || ""), item.translatedTitle || ""]));
    stage1Result.triagedAll = (stage1Result.triagedAll || []).map((item) => {
      const translatedTitle = translatedByTitle.get(String(item.title || ""));
      return translatedTitle ? { ...item, translatedTitle } : item;
    });
    const createdLiteratureItems = stage1Result.triagedAll.filter((item) => !repository.findExisting(item).exists);
    const literatureItems = createdLiteratureItems
      .map((item) => ({ title: item.title || "", grade: item.final_grade || item.grade || "" }));
    let persistence;
    await timing.run("state_persist", async () => {
      persistence = repository.upsertPapers(stage1Result.triagedAll, { runId });
      await repository.save();
      await repository.saveLearningState({
        ...learningState,
        run_id: runId,
        preference_learning_audit: path.join(stage1Result.pipeDir, "preference_learning_audit.json"),
        feedback_events_used: normalizedFeedbackRows.length,
        consumed_feedback_event_ids: [...consumedEventIds, ...seenPendingEventIds],
      });
    }, () => ({ created_count: persistence.created, updated_count: persistence.updated, feedback_consumed_count: normalizedFeedbackRows.length }));

    const runDir = path.join(repository.runsDir, runId);
    const sourcePath = path.join(runDir, "local_export_source.json");
    const exportDayDir = path.join(repository.exportsDir, runId);
    const preferenceAudit = JSON.parse(await fs.readFile(path.join(stage1Result.pipeDir, "preference_learning_audit.json"), "utf8"));
    const { prepareLocalStage4ExportSource } = await import("../stage4/export_source_step.mjs");
    localSourceRegistration = registerEphemeral({ path: sourcePath, ownerStage: "local_stage4", cleanupWhen: "after_use", preserveOnFailure: true }, ephemeralRegistry);
    const source = await prepareLocalStage4ExportSource({ papers: repository.papers, sourcePath, runReport: stage1Result.report, preferenceLearningAudit: preferenceAudit });
    localSourceRegistration.markClosed();
    const paths = { sourcePath, reviewRoot: repository.exportsDir, reviewMonthDir: repository.exportsDir, reviewDayDir: exportDayDir, requestedOutputPath: path.join(exportDayDir, "周报.xlsx"), exportInputFiles: [sourcePath] };
    const labels = { dateStr: new Date().toISOString().slice(0, 10), reviewMonthLabel: "Local", reviewDayLabel: runId };
    const exportRunner = dependencies.runStage4Export || (await import("../stage4/export_execution_step.mjs")).runStage4WorkbookExport;
    const exported = await timing.run("stage4_export", async () => {
      const result = await exportRunner({ paths, labels, source });
      if (result.terminalExportError) throw result.terminalExportError;
      return result;
    });
    stage4Succeeded = true;
    localSourceRegistration.markConsumed();
    const exportManifest = exported.exportManifest || await (dependencies.buildExportManifest || buildExportManifest)(exported.exportAudit, { outputRoot: exportDayDir });
    const timingReport = timing.report("success");
    const runSummary = buildRunSummary({
      runId,
      pipelineMode: "local",
      status: "success",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: timingReport.total_duration_ms,
      runReport: stage1Result.report,
      localPersistence: persistence,
      createdItems: literatureItems,
      humanReviewCount: createdLiteratureItems.filter((item) => item.needs_human_review).length,
      feedbackCount: normalizedFeedbackRows.length,
      translationSummary: { success_count: generatedTranslations.generated_count },
      artifacts: exportManifest.artifacts,
      outputRoot: exportManifest.outputRoot,
    });
    const stage5Runner = dependencies.runStage5Notification || runStage5Notification;
    let stage5Notification;
    if (!options.recipient) {
      stage5Notification = await stage5Runner({ runSummary, literatureItems, recipient: "", forceResend: options.forceResend, config: { runStateRoot: runStateRoot(repository.runsDir, runId) } });
      timing.skip("stage5_notification", stage5Notification.reason);
    } else {
      stage5Notification = await timing.run("stage5_notification", () => stage5Runner({ runSummary, literatureItems, recipient: options.recipient, forceResend: options.forceResend, config: { runStateRoot: runStateRoot(repository.runsDir, runId) } }));
      if (stage5Notification.status === "failed") throw new Error(`STAGE5_NOTIFICATION_FAILED:${stage5Notification.reason}`);
    }
    const finalTimingReport = timing.report("success");
    businessSucceeded = true;
    await writeTiming(timingPath, finalTimingReport);
    return { ok: true, run_id: runId, output_root: options.outputRoot, imported: imported.items.length, import_errors: imported.errors, persistence, feedback_events_used: normalizedFeedbackRows.length, export_path: exported.exportAudit.actual_output_path, export_manifest: exportManifest, run_summary: runSummary, stage5_notification: stage5Notification, housekeeping, timing_path: timingPath, timings: finalTimingReport };
  } catch (error) {
    businessError = error;
    if (businessSucceeded) throw businessError;
    const timingReport = timing.report("failed");
    try { await writeTiming(timingPath, timingReport); }
    catch (timingError) { businessError.timing_write_error = String(timingError?.message || timingError); }
    throw businessError;
  } finally {
    if (ephemeralRegistry) {
      try {
        const immediate = await ephemeralRegistry.cleanup({ success: stage4Succeeded });
        Object.assign(housekeeping, {
          immediateDeletedFiles: immediate.immediateDeletedFiles,
          immediateDeletedBytes: immediate.immediateDeletedBytes,
          immediateFailedCount: immediate.immediateFailedCount,
          immediateSamples: immediate.samples,
          registeredEphemeralsRemaining: immediate.registeredRemaining,
        });
        housekeeping.warnings = [...(housekeeping.warnings || []), ...(immediate.warnings || [])].slice(0, 10);
        await recordImmediateCleanup({ runtimeRoot: path.resolve(options.outputRoot), summary: immediate });
      } catch (error) {
        housekeeping.warnings = [...(housekeeping.warnings || []), String(error?.message || error)];
      } finally {
        restoreEphemeralRegistry();
      }
    }
    if (runGroupManifestPath) {
      const extraArtifacts = [];
      if (stage1Result?.pipeDir) {
        const relativePipeline = path.relative(path.resolve(options.outputRoot), path.resolve(stage1Result.pipeDir));
        if (relativePipeline && !relativePipeline.startsWith("..") && !path.isAbsolute(relativePipeline)) {
          extraArtifacts.push({ kind: "pipeline", rootKey: "local", path: relativePipeline, retention: "30d" });
        }
      }
      try {
        await finishRunGroup({
          manifestPath: runGroupManifestPath,
          status: businessSucceeded ? "completed" : "failed",
          finishedAt: new Date().toISOString(),
          artifacts: extraArtifacts,
          monthlyAggregationPending: false,
        });
      } catch (error) {
        housekeeping.warnings = [...(housekeeping.warnings || []), String(error?.message || error)];
      }
    }
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseLocalArgs(argv);
  if (options.help) {
    console.log("Usage: node workflow/tools/local/main.mjs [--output-root PATH] [--input FILE_OR_DIR] [--feedback JSONL] [--llm-mode disabled|mock|real] [--email ADDRESS] [--force-resend]\nThe sender transport must be configured by the deployer.");
    return { ok: true, help: true };
  }
  const result = await runLocalPipeline(options, dependencies);
  console.log(JSON.stringify(result));
  console.log(formatTimingSummary(result.timings));
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(`${error.message}${error.details ? `: ${JSON.stringify(error.details)}` : ""}`);
    process.exitCode = 1;
  });
}
