/**
 * evals/runner.ts
 *
 * Main entry point for the Opticlick LLM eval pipeline.
 *
 * Uses LangSmith's evaluate() API so every run is:
 *   - Linked to the dataset example (reference_example_id)
 *   - Grouped as a named experiment visible in the LangSmith UI
 *   - Automatically scored by evaluators
 *
 * Usage:
 *   GEMINI_API_KEY=xxx LANGSMITH_API_KEY=xxx npm run eval
 *   GEMINI_API_KEY=xxx LANGSMITH_API_KEY=xxx EVAL_IDS=eval-001 npm run eval
 *
 * Environment variables:
 *   GEMINI_API_KEY           — required
 *   LANGSMITH_API_KEY        — required
 *   LANGSMITH_PROJECT        — optional: project to log into (default: opticlick-evals)
 *   LANGSMITH_DATASET_NAME   — optional: dataset to run against (default: Opticlick Eval Test Cases)
 *   EVAL_EXPERIMENT_NAME     — optional: experiment prefix (default: opticlick-eval)
 *   EVAL_AUTH_FILTER         — optional: non-auth | auth | all (default: non-auth)
 *   EVAL_DIFFICULTY          — optional: easy | medium | hard | all (default: all)
 *   EVAL_IDS                 — optional: comma-separated case IDs
 *   EVAL_THRESHOLD           — optional: min pass rate 0-100 (default: 70)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { evaluate } from 'langsmith/evaluation';
import type { EvaluationResult } from 'langsmith/evaluation';
import type { Run, Example } from 'langsmith/schemas';
import type { EvalCase, EvalResult, EvalSummary, JudgeResult } from './types.js';
import { runEvalCase } from './harness.js';
import { compressVideo, extractFrames, cleanupFrames } from './recorder.js';
import { judgeRun } from './judge.js';
import { collectMetrics } from './metrics.js';
import { loadFilteredExamples, getClient } from './langsmith.js';

/**
 * expectedOutput lives in example.outputs (Reference Outputs column), not inputs.
 * The TypeScript SDK's StandardTargetT doesn't expose referenceOutputs in the
 * target function config, so we pre-build a lookup Map before calling evaluate()
 * and close over it.
 */
const expectedOutputByCase = new Map<string, string>();

/** Build EvalCase from evaluate() inputs, using the pre-built expectedOutput map. */
function buildEvalCase(inputs: Record<string, unknown>): EvalCase {
  const requiresAuth =
    inputs.requires_auth === true || String(inputs.requires_auth).toLowerCase() === 'true' ||
    inputs.requiresAuth  === true || String(inputs.requiresAuth).toLowerCase()  === 'true';

  const id = inputs.case_number != null
    ? String(inputs.case_number)
    : (inputs.langsmithExampleId as string) || (inputs.id as string) || '';

  return {
    id,
    title:          (inputs.title as string) || `Case ${id}`,
    difficulty:     (((inputs.difficulty as string) || 'medium').toLowerCase()) as 'easy' | 'medium' | 'hard',
    requiresAuth,
    timeoutMs:      (inputs.timeout_ms as number) || (inputs.timeoutMs as number) || 1_200_000,
    prompt:         (inputs.prompt as string) || (inputs.input as string) || '',
    expectedOutput: expectedOutputByCase.get(id) ?? '',
  };
}

const RESULTS_DIR = path.resolve(process.cwd(), 'evals/results');
const SUMMARY_PATH = path.join(RESULTS_DIR, 'summary.json');

/** Seconds to wait between cases — avoids hitting Gemini rate limits. */
const BETWEEN_CASE_DELAY_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function banner(msg: string): void {
  console.log(`\n${'─'.repeat(60)}\n  ${msg}\n${'─'.repeat(60)}`);
}

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMsg: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMsg)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

// ── Target function ───────────────────────────────────────────────────────────
// Called by evaluate() for each dataset example. Returns outputs that evaluators
// will score. evaluate() automatically creates a traced run in LangSmith.

let caseIndex = 0; // used to add inter-case delay without changing evaluate() API

async function runAgent(
  inputs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Add delay between cases to avoid Gemini rate limits (skip first)
  if (caseIndex > 0) {
    console.log(`\n  Waiting ${BETWEEN_CASE_DELAY_MS / 1000}s before next case…`);
    await sleep(BETWEEN_CASE_DELAY_MS);
  }
  caseIndex++;

  const evalCase = buildEvalCase(inputs);

  console.log(`\n[${evalCase.id}] ▶  ${evalCase.title}  (${evalCase.difficulty})`);
  console.log(`     Timeout: ${evalCase.timeoutMs / 1000}s`);

  // ── Step 1: Run Playwright harness ────────────────────────────────────────
  const runResult = await runEvalCase(evalCase);
  console.log(`     Finish reason: ${runResult.finishReason} | Steps: ${runResult.numSteps} | Duration: ${runResult.durationSeconds.toFixed(1)}s`);

  // ── Step 2: Compress video ────────────────────────────────────────────────
  if (fs.existsSync(runResult.rawVideoPath)) {
    try {
      compressVideo(runResult.rawVideoPath, runResult.compressedVideoPath);
      console.log(`     Video compressed → ${path.basename(runResult.compressedVideoPath)}`);
    } catch (e) {
      console.warn(`     ⚠ Video compression failed: ${(e as Error).message}`);
    }
  }

  // ── Step 3: Extract frames for judge ─────────────────────────────────────
  const videoForJudge = fs.existsSync(runResult.compressedVideoPath)
    ? runResult.compressedVideoPath
    : runResult.rawVideoPath;

  const frames = extractFrames(videoForJudge, evalCase.id, 15);
  console.log(`     Extracted ${frames.length} frames for judge`);

  // ── Step 4: Judge with Gemma 4 ────────────────────────────────────────────
  let judgeResult: JudgeResult;
  try {
    judgeResult = await withTimeout(
      judgeRun(evalCase, runResult, frames),
      180_000,
      'Judge LLM timed out after 3 minutes',
    );
  } catch (err) {
    console.warn(`     ⚠ Judge failed or timed out: ${(err as Error).message}`);
    judgeResult = {
      task_completed: false,
      navigation_accuracy: 0,
      output_correctness: 0,
      unnecessary_actions: false,
      efficiency_score: 0,
      reasoning: `Judge error: ${(err as Error).message}`,
    };
  }

  console.log(`     Judge: task_completed=${judgeResult.task_completed} | nav=${judgeResult.navigation_accuracy} | output=${judgeResult.output_correctness}`);
  console.log(`     Reasoning: ${judgeResult.reasoning}`);

  // ── Step 5: Clean up frames ────────────────────────────────────────────────
  cleanupFrames(evalCase.id);

  const passed =
    judgeResult.task_completed &&
    !runResult.timedOut &&
    !runResult.errorOccurred;

  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`     ${icon}`);

  // Flush all pending LangSmith trace batches immediately so this case's
  // data is uploaded before the next case starts — prevents loss on crash.
  await getClient().awaitPendingTraceBatches();

  // Return all outputs — evaluators below will extract individual scores
  return {
    ...runResult,
    ...judgeResult,
    passed,
    // Include programmatic metrics in outputs for LangSmith trace
    ...collectMetrics(runResult),
  };
}

// ── Evaluators ────────────────────────────────────────────────────────────────
// Each function receives the completed run and returns a named score.
// evaluate() calls these after runAgent() and logs feedback to LangSmith.

const evaluators: Array<(run: Run, example?: Example) => EvaluationResult> = [
  (run) => ({ key: 'task_completed',            score: run.outputs?.task_completed ? 1 : 0 }),
  (run) => ({ key: 'navigation_accuracy',       score: Number(run.outputs?.navigation_accuracy ?? 0) }),
  (run) => ({ key: 'output_correctness',        score: Number(run.outputs?.output_correctness ?? 0) }),
  (run) => ({ key: 'unnecessary_actions',       score: run.outputs?.unnecessary_actions ? 1 : 0 }),
  (run) => ({ key: 'efficiency_score',          score: Number(run.outputs?.efficiency_score ?? 0) }),
  (run) => ({ key: 'passed',                    score: run.outputs?.passed ? 1 : 0 }),
  (run) => ({ key: 'timed_out',                 score: run.outputs?.timedOut ? 1 : 0 }),
  (run) => ({ key: 'num_steps',                 score: Number(run.outputs?.numSteps ?? 0) }),
  (run) => ({ key: 'time_to_completion_seconds',score: Number(run.outputs?.durationSeconds ?? 0) }),
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  banner('Opticlick LLM Eval Pipeline');

  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY is not set');
    process.exit(1);
  }
  if (!process.env.LANGSMITH_API_KEY) {
    console.error('❌ LANGSMITH_API_KEY is not set — required to fetch the dataset and log results');
    process.exit(1);
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  // Load filtered examples from LangSmith — passing these to evaluate() ensures
  // runs are linked to the dataset and shown as an experiment in the LangSmith UI
  const examples = await loadFilteredExamples();
  if (examples.length === 0) {
    console.error('❌ No eval cases found. Check EVAL_AUTH_FILTER, EVAL_DIFFICULTY, or EVAL_IDS env vars.');
    process.exit(1);
  }

  const threshold = Number(process.env.EVAL_THRESHOLD ?? '70');
  if (Number.isNaN(threshold)) {
    console.error('❌ EVAL_THRESHOLD must be a valid number');
    process.exit(1);
  }
  const experimentPrefix = process.env.EVAL_EXPERIMENT_NAME || 'opticlick-eval';

  // Populate the expectedOutput lookup Map before evaluate() runs.
  // example.outputs = Reference Outputs column; example.inputs = Inputs column.
  for (const ex of examples) {
    if (ex.inputs) {
      ex.inputs.langsmithExampleId = ex.id; // inject so runAgent has access to it
    }
    const inp = (ex.inputs ?? {}) as Record<string, unknown>;
    const out = (ex.outputs ?? {}) as Record<string, unknown>;
    const id = inp.case_number != null ? String(inp.case_number) : ex.id;
    expectedOutputByCase.set(
      id,
      (out.expected_output as string) || (out.expectedOutput as string) || (out.output as string) || '',
    );
  }

  console.log(`\nDataset : ${process.env.LANGSMITH_DATASET_NAME || 'Opticlick Eval Test Cases'}`);
  console.log(`Cases   : ${examples.length} | Threshold: ${threshold}% | Experiment: ${experimentPrefix}`);

  // ── Run evaluate() ────────────────────────────────────────────────────────
  // This is the LangSmith-native way to run experiments:
  //   • Each call to runAgent() is traced as a run linked to its dataset example
  //   • All runs are grouped under a single named experiment
  //   • Evaluators post feedback scores to each run automatically
  const evalResults = await evaluate(runAgent, {
    data: examples,          // filtered Example[] — ties runs to the dataset
    evaluators,
    experimentPrefix,        // experiment name shown in LangSmith UI
    maxConcurrency: 1,       // sequential — avoids Gemini rate limits
  });

  // ── Build summary from evaluate() results ─────────────────────────────────
  const results: EvalResult[] = [];
  let passed = 0;

  for (const r of evalResults.results) {
    const outputs = (r.run?.outputs ?? {}) as Record<string, unknown>;
    const evalResult: EvalResult = {
      caseId:               String(outputs.caseId ?? ''),
      rawVideoPath:         String(outputs.rawVideoPath ?? ''),
      compressedVideoPath:  String(outputs.compressedVideoPath ?? ''),
      agentOutput:          String(outputs.agentOutput ?? ''),
      finishReason:         (outputs.finishReason as EvalResult['finishReason']) ?? 'error',
      durationSeconds:      Number(outputs.durationSeconds ?? 0),
      numSteps:             Number(outputs.numSteps ?? 0),
      timedOut:             Boolean(outputs.timedOut),
      errorOccurred:        Boolean(outputs.errorOccurred),
      task_completed:       Boolean(outputs.task_completed),
      navigation_accuracy:  (outputs.navigation_accuracy as 0 | 0.5 | 1) ?? 0,
      output_correctness:   (outputs.output_correctness as 0 | 0.5 | 1) ?? 0,
      unnecessary_actions:  Boolean(outputs.unnecessary_actions),
      efficiency_score:     Number(outputs.efficiency_score ?? 0),
      reasoning:            String(outputs.reasoning ?? ''),
      passed:               Boolean(outputs.passed),
    };
    results.push(evalResult);
    if (evalResult.passed) passed++;
  }

  const passRate = results.length > 0 ? (passed / results.length) * 100 : 0;

  const summary: EvalSummary = {
    runAt: new Date().toISOString(),
    totalCases: results.length,
    passed,
    failed: results.length - passed,
    timedOut: results.filter((r) => r.timedOut).length,
    passRate,
    threshold,
    belowThreshold: passRate < threshold,
    results,
  };

  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));

  banner('Results');
  console.log(`  Total     : ${results.length}`);
  console.log(`  Passed    : ${passed}`);
  console.log(`  Failed    : ${results.length - passed}`);
  console.log(`  Timed out : ${summary.timedOut}`);
  console.log(`  Pass rate : ${passRate.toFixed(1)}%  (threshold: ${threshold}%)`);
  console.log(`\n  Summary written to: ${SUMMARY_PATH}`);

  if (passRate < threshold) {
    console.error(`\n❌ Pass rate ${passRate.toFixed(1)}% is below threshold ${threshold}% — failing CI`);
    process.exit(1);
  }

  console.log(`\n✅ Pass rate ${passRate.toFixed(1)}% meets threshold ${threshold}%`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
