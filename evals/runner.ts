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
import { getCurrentRunTree } from 'langsmith/traceable';
import type { EvaluationResult } from 'langsmith/evaluation';
import type { Run, Example } from 'langsmith/schemas';
import type { EvalCase, EvalResult, EvalSummary, JudgeResult, RunResult } from './types.js';
import { runEvalCase } from './harness.js';
import { compressVideo, extractFrames, cleanupFrames } from './recorder.js';
import { judgeRun } from './judge.js';
import { collectMetrics } from './metrics.js';
import { loadFilteredExamples, getClient, getDatasetId, exampleToEvalCase } from './langsmith.js';

/**
 * expectedOutput lives in example.outputs (Reference Outputs column), not inputs.
 * The TypeScript SDK's StandardTargetT doesn't expose referenceOutputs in the
 * target function config, so we pre-build a lookup Map before calling evaluate()
 * and close over it.
 */
const expectedOutputByCase = new Map<string, string>();

/** Build EvalCase from evaluate() inputs, using the pre-built expectedOutput map. */
function buildEvalCase(inputs: Record<string, unknown>): EvalCase {
  const rawRequiresAuth = inputs.requires_auth ?? inputs.requiresAuth ?? inputs['Requires Auth'] ?? inputs.Requires_Auth;
  const requiresAuth =
    rawRequiresAuth === true || String(rawRequiresAuth).toLowerCase() === 'true';

  const rawCaseNumber = inputs.case_number ?? inputs.caseNumber ?? inputs['Case Number'] ?? inputs.Case_Number;
  const id = rawCaseNumber != null
    ? String(rawCaseNumber)
    : (inputs.langsmithExampleId as string) || (inputs.id as string) || '';

  const rawDifficulty = (inputs.difficulty ?? inputs.Difficulty ?? 'medium') as string;
  const configuredTimeoutSeconds = Number(process.env.EVAL_CASE_TIMEOUT_SECONDS);
  const configuredTimeoutMs = Number.isFinite(configuredTimeoutSeconds) && configuredTimeoutSeconds > 0
    ? configuredTimeoutSeconds * 1000
    : undefined;
  const datasetTimeoutMs = Number(inputs.timeout_ms ?? inputs.timeoutMs);

  return {
    id,
    title:          (inputs.title as string) || `Case ${id}`,
    difficulty:     rawDifficulty.toLowerCase() as 'easy' | 'medium' | 'hard',
    requiresAuth,
    // CI's explicit safety limit takes precedence over stale/absent dataset
    // values. Previously the workflow set this env var but it was ignored,
    // leaving a failed case alive for the 20-minute fallback.
    timeoutMs:      configuredTimeoutMs
      ?? (Number.isFinite(datasetTimeoutMs) && datasetTimeoutMs > 0 ? datasetTimeoutMs : 1_200_000),
    prompt:         (inputs.prompt as string) || (inputs.input as string) || '',
    expectedOutput: expectedOutputByCase.get(id) ?? '',
  };
}

const RESULTS_DIR = path.resolve(process.cwd(), 'evals/results');
const SUMMARY_PATH = path.join(RESULTS_DIR, 'summary.json');

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

async function runAgent(
  inputs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const evalCase = buildEvalCase(inputs);

  console.log(`\n[${evalCase.id}] ▶  ${evalCase.title}  (${evalCase.difficulty})`);
  console.log(`     Timeout: ${evalCase.timeoutMs / 1000}s`);

  // ── Step 1: Run Playwright harness ────────────────────────────────────────
  // Propagate the dataset example's distributed trace context into the Chrome
  // extension process so LangGraph/model/tool spans appear as children of this
  // exact runAgent row in the LangSmith experiment.
  const parentRun = getCurrentRunTree();
  const traceHeaders = parentRun?.toHeaders();
  const runResult = await runEvalCase(evalCase, traceHeaders);
  let nestedSpanCount = 0;
  if (parentRun) {
    await getClient().awaitPendingTraceBatches();
    // LangSmith ingestion is asynchronous. Verify the exact dataset trace has
    // children before accepting the case, rather than merely emitting a
    // separate project trace that the experiment UI cannot expand.
    for (let attempt = 0; attempt < 5 && nestedSpanCount === 0; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
      for await (const span of getClient().listRuns({ traceId: parentRun.trace_id })) {
        if (span.id !== parentRun.id && span.parent_run_id) nestedSpanCount++;
      }
    }
    console.log(`     LangSmith nested spans: ${nestedSpanCount} (trace ${parentRun.trace_id})`);
    if (nestedSpanCount === 0) {
      throw new Error(`No nested agent spans found under dataset trace ${parentRun.trace_id}`);
    }
  }
  console.log(`     Finish reason: ${runResult.finishReason} | Steps: ${runResult.numSteps} | Duration: ${runResult.durationSeconds.toFixed(1)}s`);

  // Agent execution and judging use separate phases. This returns the browser
  // result immediately so judge latency and quota never occupy an agent worker.
  if (process.env.EVAL_DEFER_JUDGE !== 'false') {
    return {
      ...runResult,
      nestedSpanCount,
      ...await collectMetrics(runResult),
    };
  }

  // ── Step 2: Compress video ────────────────────────────────────────────────
  if (fs.existsSync(runResult.rawVideoPath)) {
    try {
      await compressVideo(runResult.rawVideoPath, runResult.compressedVideoPath);
      console.log(`     Video compressed → ${path.basename(runResult.compressedVideoPath)}`);
    } catch (e) {
      console.warn(`     ⚠ Video compression failed: ${(e as Error).message}`);
    }
  }

  // ── Step 3: Extract frames for judge ─────────────────────────────────────
  const videoForJudge = fs.existsSync(runResult.compressedVideoPath)
    ? runResult.compressedVideoPath
    : runResult.rawVideoPath;

  // Six evenly-spaced frames are enough to establish navigation evidence and
  // keep multimodal judge requests comfortably below provider quota limits.
  const frames = await extractFrames(videoForJudge, evalCase.id, 6);
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
    nestedSpanCount,
    ...judgeResult,
    passed,
    // Include programmatic metrics in outputs for LangSmith trace
    ...await collectMetrics(runResult),
  };
}

// ── Evaluators ────────────────────────────────────────────────────────────────
// Each function receives the completed run and returns a named score.
// evaluate() calls these after runAgent() and logs feedback to LangSmith.

const evaluators: Array<(run: Run, example?: Example) => EvaluationResult> = [
  (run) => ({ key: 'timed_out',                 score: run.outputs?.timedOut ? 1 : 0 }),
  (run) => ({ key: 'num_steps',                 score: Number(run.outputs?.numSteps ?? 0) }),
  (run) => ({ key: 'time_to_completion_seconds',score: Number(run.outputs?.durationSeconds ?? 0) }),
  (run) => ({ key: 'agent_input_tokens',        score: Number(run.outputs?.agent_input_tokens ?? 0) }),
  (run) => ({ key: 'agent_llm_calls',           score: Number(run.outputs?.agent_llm_calls ?? 0) }),
  (run) => ({ key: 'deterministic_actions',     score: Number(run.outputs?.deterministic_actions ?? 0) }),
];

async function mapWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  }));
}

function retryDelayMs(error: unknown): number | undefined {
  const message = (error as Error).message ?? '';
  if (!/\b429\b|rate limit/i.test(message)) return undefined;
  const match = message.match(/try again in\s+([\d.]+)\s*(ms|s|m)/i);
  if (!match) return 6_000;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  return Math.ceil(value * (unit === 'm' ? 60_000 : unit === 's' ? 1_000 : 1)) + 500;
}

// Deferred judging keeps evaluators out of agent workers, but unconstrained
// concurrency creates a retry herd against Groq's TPM bucket. Gate request
// starts globally while completed calls and all agent cases remain parallel.
let nextJudgeStartAt = 0;
let judgeStartGate: Promise<void> = Promise.resolve();

function waitForJudgeStartSlot(): Promise<void> {
  const interval = Number(process.env.EVAL_JUDGE_MIN_INTERVAL_MS
    ?? (process.env.GROQ_API_KEY ? '6000' : '0'));
  const slot = judgeStartGate.then(async () => {
    const delay = Math.max(0, nextJudgeStartAt - Date.now());
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    nextJudgeStartAt = Date.now() + Math.max(0, interval);
  });
  judgeStartGate = slot.catch(() => {});
  return slot;
}

async function judgeWithRateLimitRetry(
  evalCase: EvalCase,
  runResult: RunResult,
  frames: string[],
): Promise<JudgeResult> {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await waitForJudgeStartSlot();
      const judged = await judgeRun(evalCase, runResult, frames);
      if (judged.reasoning !== 'Failed to parse judge response' || attempt === 8) {
        return judged;
      }
      console.log(`     [${evalCase.id}] Judge returned malformed JSON; retrying`);
      continue;
    } catch (error) {
      const delay = retryDelayMs(error);
      if (delay === undefined || attempt === 8) throw error;
      console.log(`     [${evalCase.id}] Judge rate limited; retrying in ${(delay / 1000).toFixed(1)}s`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Judge retry loop exhausted');
}

async function judgeCompletedRun(result: { run?: Run }): Promise<void> {
  const run = result.run;
  if (!run?.outputs) return;
  const outputs = run.outputs as unknown as Record<string, unknown>;
  const runResult: RunResult = {
    caseId: String(outputs.caseId ?? ''),
    rawVideoPath: String(outputs.rawVideoPath ?? ''),
    compressedVideoPath: String(outputs.compressedVideoPath ?? ''),
    agentOutput: String(outputs.agentOutput ?? ''),
    finishReason: (outputs.finishReason as RunResult['finishReason']) ?? 'error',
    durationSeconds: Number(outputs.durationSeconds ?? 0),
    numSteps: Number(outputs.numSteps ?? 0),
    timedOut: Boolean(outputs.timedOut),
    errorOccurred: Boolean(outputs.errorOccurred),
  };
  const evalCase = buildEvalCase((run.inputs ?? {}) as Record<string, unknown>);

  if (fs.existsSync(runResult.rawVideoPath) && !fs.existsSync(runResult.compressedVideoPath)) {
    try { await compressVideo(runResult.rawVideoPath, runResult.compressedVideoPath); }
    catch (error) { console.warn(`     ⚠ Video compression failed for ${evalCase.id}: ${(error as Error).message}`); }
  }
  const video = fs.existsSync(runResult.compressedVideoPath) ? runResult.compressedVideoPath : runResult.rawVideoPath;
  const frames = await extractFrames(video, evalCase.id, 6);
  let judged: JudgeResult;
  try {
    judged = await withTimeout(
      judgeWithRateLimitRetry(evalCase, runResult, frames),
      180_000,
      'Judge LLM timed out after 3 minutes',
    );
  } catch (error) {
    judged = {
      task_completed: false, navigation_accuracy: 0, output_correctness: 0,
      unnecessary_actions: false, efficiency_score: 0,
      reasoning: `Judge error: ${(error as Error).message}`,
    };
  } finally {
    cleanupFrames(evalCase.id);
  }
  const answerLines = runResult.agentOutput
    .split(/\r?\n/)
    .filter((line) => line.includes('[ok]'))
    .map((line) => line.replace(/^.*?\[ok\]\s*/, '').trim())
    .filter((answer) => !/^task complete!?$/i.test(answer));
  const hasSubstantiveAnswer = answerLines
    .some((answer) => {
      return answer.length >= 12;
    });
  const answerIsGrounded = !/\b(?:assuming|assume|not available|insufficient information|cannot calculate|needed to proceed)\b/i
    .test(answerLines.join(' '));
  const passed = judged.task_completed
    // A correct answer collected from the requested site's public endpoint is
    // valid even when the visual UI itself blocks automation (0.5 navigation).
    && judged.navigation_accuracy >= 0.5
    && judged.output_correctness === 1
    && hasSubstantiveAnswer
    && answerIsGrounded
    && !runResult.timedOut
    && !runResult.errorOccurred;
  const merged = { ...outputs, ...judged, passed };
  run.outputs = merged;

  const client = getClient();
  const feedback = [
    ['task_completed', judged.task_completed ? 1 : 0],
    ['navigation_accuracy', judged.navigation_accuracy],
    ['output_correctness', judged.output_correctness],
    ['unnecessary_actions', judged.unnecessary_actions ? 1 : 0],
    ['efficiency_score', judged.efficiency_score],
    ['answer_present', hasSubstantiveAnswer ? 1 : 0],
    ['answer_grounded', answerIsGrounded ? 1 : 0],
    ['passed', passed ? 1 : 0],
  ] as const;
  await Promise.all(feedback.map(([key, score]) => client.createFeedback(run.id, key, {
    score,
    comment: key === 'passed' ? judged.reasoning : undefined,
  })));
  console.log(`     [${evalCase.id}] Judge: completed=${judged.task_completed} | output=${judged.output_correctness}`);
}

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
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    console.error('❌ EVAL_THRESHOLD must be a number between 0 and 100');
    process.exit(1);
  }
  const experimentPrefix = process.env.EVAL_EXPERIMENT_NAME || 'opticlick-eval';
  const maxConcurrency = Number(process.env.EVAL_MAX_CONCURRENCY ?? '3');
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 6) {
    console.error('❌ EVAL_MAX_CONCURRENCY must be an integer between 1 and 6');
    process.exit(1);
  }
  const datasetId = getDatasetId();
  const datasetName = process.env.LANGSMITH_DATASET_NAME || 'Opticlick Eval Test Cases';

  // Populate the expectedOutput lookup Map before evaluate() runs.
  // example.outputs = Reference Outputs column; example.inputs = Inputs column.
  for (const ex of examples) {
    const evalCase = exampleToEvalCase(ex);
    if (ex.inputs) {
      // evaluate() passes only inputs to the target. Copy normalized metadata
      // into inputs so filtering, IDs, timeouts, and reporting stay consistent.
      Object.assign(ex.inputs, {
        langsmithExampleId: ex.id,
        case_number: evalCase.id,
        difficulty: evalCase.difficulty,
        requires_auth: evalCase.requiresAuth,
        timeout_ms: evalCase.timeoutMs,
      });
    }
    const inp = (ex.inputs ?? {}) as Record<string, unknown>;
    const out = (ex.outputs ?? {}) as Record<string, unknown>;
    const rawCaseNumber = inp.case_number ?? inp.caseNumber ?? inp['Case Number'] ?? inp.Case_Number;
    const id = rawCaseNumber != null ? String(rawCaseNumber) : ex.id;
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
    maxConcurrency,
    description: `Opticlick browser-agent evaluation (${examples.length} cases, ${process.env.EVAL_AUTH_FILTER ?? 'non-auth'} auth filter, ${process.env.EVAL_DIFFICULTY ?? 'all'} difficulty)`,
    metadata: {
      dataset_id: datasetId,
      dataset_name: datasetName,
      auth_filter: process.env.EVAL_AUTH_FILTER ?? 'non-auth',
      difficulty: process.env.EVAL_DIFFICULTY ?? 'all',
      threshold,
      agent_model: process.env.EVAL_AGENT_MODEL ?? 'gemma-4-31b-it',
      agent_model_name: process.env.EVAL_AGENT_MODEL_NAME,
      judge_model: process.env.EVAL_JUDGE_MODEL ?? 'gemini-3.1-flash-lite-preview',
      github_repository: process.env.GITHUB_REPOSITORY,
      github_run_id: process.env.GITHUB_RUN_ID,
      github_sha: process.env.GITHUB_SHA,
    },
  });

  if (process.env.EVAL_DEFER_JUDGE !== 'false') {
    const judgeConcurrency = Number(process.env.EVAL_JUDGE_CONCURRENCY ?? '3');
    if (!Number.isInteger(judgeConcurrency) || judgeConcurrency < 1 || judgeConcurrency > 8) {
      throw new Error('EVAL_JUDGE_CONCURRENCY must be an integer between 1 and 8');
    }
    banner(`Judging phase (${judgeConcurrency} concurrent)`);
    await mapWithConcurrency(evalResults.results, judgeConcurrency, judgeCompletedRun);
    await getClient().awaitPendingTraceBatches();
  }

  const experimentName = evalResults.experimentName;
  const client = getClient();
  const [experimentUrl, datasetUrl] = await Promise.all([
    client.getProjectUrl({ projectName: experimentName }).catch(() => undefined),
    client.getDatasetUrl(datasetId ? { datasetId } : { datasetName }).catch(() => undefined),
  ]);

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
      agent_input_tokens:   Number(outputs.agent_input_tokens ?? 0),
      agent_cached_tokens:  Number(outputs.agent_cached_tokens ?? 0),
      agent_output_tokens:  Number(outputs.agent_output_tokens ?? 0),
      agent_llm_calls:      Number(outputs.agent_llm_calls ?? 0),
      rate_limit_retries:   Number(outputs.rate_limit_retries ?? 0),
      deterministic_actions:Number(outputs.deterministic_actions ?? 0),
    };
    results.push(evalResult);
    if (evalResult.passed) passed++;
  }

  const passRate = results.length > 0 ? (passed / results.length) * 100 : 0;
  const averageAgentInputTokens = results.length > 0
    ? results.reduce((sum, result) => sum + result.agent_input_tokens, 0) / results.length
    : 0;
  const averageAgentLlmCalls = results.length > 0
    ? results.reduce((sum, result) => sum + result.agent_llm_calls, 0) / results.length
    : 0;
  const tokenBudget = Number(process.env.EVAL_MAX_AVG_AGENT_INPUT_TOKENS ?? '1000');
  const overTokenBudget = tokenBudget > 0 && averageAgentInputTokens > tokenBudget;

  const summary: EvalSummary = {
    runAt: new Date().toISOString(),
    datasetId,
    datasetName,
    datasetUrl,
    experimentName,
    experimentUrl,
    totalCases: results.length,
    passed,
    failed: results.length - passed,
    timedOut: results.filter((r) => r.timedOut).length,
    passRate,
    threshold,
    belowThreshold: passRate < threshold,
    averageAgentInputTokens,
    averageAgentLlmCalls,
    tokenBudget,
    overTokenBudget,
    results,
  };

  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));

  banner('Results');
  console.log(`  Total     : ${results.length}`);
  console.log(`  Passed    : ${passed}`);
  console.log(`  Failed    : ${results.length - passed}`);
  console.log(`  Timed out : ${summary.timedOut}`);
  console.log(`  Pass rate : ${passRate.toFixed(1)}%  (threshold: ${threshold}%)`);
  console.log(`  Agent avg : ${averageAgentInputTokens.toFixed(0)} input tokens | ${averageAgentLlmCalls.toFixed(2)} LLM calls`);
  console.log(`\n  Summary written to: ${SUMMARY_PATH}`);

  if (passRate < threshold) {
    console.error(`\n❌ Pass rate ${passRate.toFixed(1)}% is below threshold ${threshold}% — failing CI`);
    process.exit(1);
  }
  if (overTokenBudget) {
    console.error(`\n❌ Average agent input ${averageAgentInputTokens.toFixed(0)} exceeds budget ${tokenBudget} — failing CI`);
    process.exit(1);
  }

  console.log(`\n✅ Pass rate ${passRate.toFixed(1)}% meets threshold ${threshold}%`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  },
);
