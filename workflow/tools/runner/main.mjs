import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import "../lib/env_file_bootstrap.mjs";
import { parseRunnerArgs } from "./args.mjs";
import { resolveRunnerConfiguration } from "./config_loader.mjs";
import { EXIT_CODES } from "./constants.mjs";
import { buildExecutionPlan, runPreflight } from "./preflight.mjs";
import { validateProductionResult } from "./result_validation.mjs";

const SECRET_NAMES = ["SMTP_PASS", "ZOTERO_API_KEY", "TITLE_TRANSLATION_API_KEY", "PREFERENCE_LEARNING_API_KEY", "EASYSCHOLAR_SECRET_KEY"];

export function redactText(text, env = process.env) {
  let safe = String(text || "");
  for (const name of SECRET_NAMES) {
    const value = String(env[name] || "");
    if (value) safe = safe.split(value).join("[REDACTED]");
  }
  return safe;
}

export function runProduction(plan, dependencies = {}) {
  const spawnImpl = dependencies.spawnImpl || spawn;
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, [plan.entry, ...plan.args], { cwd: plan.cwd, env: plan.childEnv, shell: false, stdio: ["inherit", "pipe", "pipe"] });
    let rawStdout = "";
    let rawStderr = "";
    child.stdout?.on("data", (chunk) => {
      rawStdout += chunk;
      stdout.write(redactText(chunk, plan.childEnv));
    });
    child.stderr?.on("data", (chunk) => {
      rawStderr += chunk;
      stderr.write(redactText(chunk, plan.childEnv));
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code: Number(code ?? 1), signal, stdout: rawStdout, stderr: rawStderr }));
  });
}

function blockedExitCode(preflight) {
  const categories = new Set(preflight.requiredMissing.map((item) => item.category));
  if (categories.has("input")) return EXIT_CODES.input;
  if (categories.has("dependency")) return EXIT_CODES.dependency;
  return EXIT_CODES.configuration;
}

export function formatPreflightSummary(preflight) {
  const missing = preflight.requiredMissing.map((item) => item.name).join(", ");
  return `[runner] preflight ${preflight.status}: mode=${preflight.mode} profile=${preflight.profile}${missing ? ` missing=${missing}` : ""}`;
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  let cliOptions;
  try { cliOptions = parseRunnerArgs(argv, { cwd: dependencies.cwd || process.cwd(), allowUnresolvedMode: true }); }
  catch (error) {
    stderr.write(`${JSON.stringify({ schemaVersion: 1, status: "invalid_input", error: String(error?.message || error) })}\n`);
    return EXIT_CODES.input;
  }
  let resolved;
  try {
    resolved = await (dependencies.resolveRunnerConfigurationImpl || resolveRunnerConfiguration)(cliOptions, dependencies);
  } catch (error) {
    stderr.write(`${JSON.stringify({ schemaVersion: 1, status: "invalid_configuration", code: String(error?.code || "CONFIG_INVALID"), error: redactText(error?.message || error, dependencies.env || process.env), details: error?.details || {} })}\n`);
    return EXIT_CODES.configuration;
  }
  const options = resolved.options;
  const runtimeDependencies = { ...dependencies, env: resolved.env };
  const preflight = await (dependencies.runPreflightImpl || runPreflight)(options, runtimeDependencies);
  stdout.write(`${formatPreflightSummary(preflight)}\n${JSON.stringify({ type: "preflight", ...preflight })}\n`);
  if (!preflight.canRun) return blockedExitCode(preflight);
  if (options.action === "check") return EXIT_CODES.success;

  const plan = (dependencies.buildExecutionPlanImpl || buildExecutionPlan)(options, runtimeDependencies);
  let processResult;
  try { processResult = await (dependencies.runProductionImpl || runProduction)(plan, dependencies); }
  catch (error) {
    stderr.write(`${JSON.stringify({ type: "runner_error", status: "failed", error: redactText(error?.message || error, dependencies.env || process.env) })}\n`);
    return EXIT_CODES.pipeline;
  }
  const validation = await (dependencies.validateProductionResultImpl || validateProductionResult)({ options, plan, processResult, fsApi: dependencies.fsApi });
  stdout.write(`${JSON.stringify({ type: "result", ...validation })}\n`);
  return validation.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ schemaVersion: 1, status: "runner_crash", error: redactText(error?.message || error) })}\n`);
    process.exitCode = EXIT_CODES.pipeline;
  });
}
