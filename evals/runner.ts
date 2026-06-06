/**
 * evals/runner.ts
 *
 * Main entry point for the Opticlick LLM eval pipeline.
 *
 * Usage:
 *   GEMINI_API_KEY=xxx LANGSMITH_API_KEY=xxx npm run eval
 *   GEMINI_API_KEY=xxx LANGSMITH_API_KEY=xxx EVAL_IDS=eval-001 npm run eval
 *
 * Environment variables:
 *   GEMINI_API_KEY       — required: Google AI Studio key (agent + judge)
 *   LANGSMITH_API_KEY    — required: LangSmith logging
 *   LANGSMITH_PROJECT    — optional: defaults to "opticlick-evals"
 *   EVAL_FILTER          — optional: non-auth | all | easy | medium | hard
 *   EVAL_IDS             — optional: comma-separated case IDs to run
 *   EVAL_THRESHOLD       — optional: min pass rate 0-100 (default 70)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EvalCase, EvalResult, EvalSummary } from './types.js';
import { runEvalCase } from './harness.js';
import { compressVideo, extractFrames, cleanupFrames } from './recorder.js';
import { judgeRun } from './judge.js';
import { collectMetrics } from './metrics.js';
import { loadCases, logResult } from './langsmith.js';

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

async function runOne(
  evalCase: EvalCase,
  experimentName: string,
): Promise<EvalResult> {
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
  const judgeResult = await judgeRun(evalCase, runResult, frames);
  console.log(`     Judge: task_completed=${judgeResult.task_completed} | nav=${judgeResult.navigation_accuracy} | output=${judgeResult.output_correctness}`);
  console.log(`     Reasoning: ${judgeResult.reasoning}`);

  // ── Step 5: Collect programmatic metrics ──────────────────────────────────
  const metrics = collectMetrics(runResult);

  // ── Step 6: Log to LangSmith ──────────────────────────────────────────────
  try {
    await logResult(evalCase, {
      ...runResult,
      ...judgeResult,
      passed: judgeResult.task_completed && !runResult.timedOut && !runResult.errorOccurred,
    }, metrics, judgeResult, experimentName);
    console.log(`     ✓ Logged to LangSmith`);
  } catch (e) {
    console.warn(`     ⚠ LangSmith logging failed: ${(e as Error).message}`);
  }

  // ── Step 7: Clean up extracted frames ─────────────────────────────────────
  cleanupFrames(evalCase.id);

  const passed =
    judgeResult.task_completed &&
    !runResult.timedOut &&
    !runResult.errorOccurred;

  const result: EvalResult = {
    ...runResult,
    ...judgeResult,
    passed,
  };

  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`     ${icon}`);

  return result;
}

async function main(): Promise<void> {
  banner('Opticlick LLM Eval Pipeline');

  // Validate required env vars
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY is not set');
    process.exit(1);
  }
  if (!process.env.LANGSMITH_API_KEY) {
    console.warn('⚠ LANGSMITH_API_KEY is not set — results will not be logged to LangSmith');
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const cases = loadCases();
  if (cases.length === 0) {
    console.error('❌ No eval cases found. Check EVAL_FILTER / EVAL_IDS env vars.');
    process.exit(1);
  }

  const threshold = Number(process.env.EVAL_THRESHOLD ?? '70');
  const experimentName = `opticlick-eval-${new Date().toISOString().slice(0, 16).replace('T', '-')}`;

  console.log(`\nRunning ${cases.length} case(s) | Threshold: ${threshold}% | Experiment: ${experimentName}`);
  console.log(`Cases: ${cases.map((c) => c.id).join(', ')}`);

  const results: EvalResult[] = [];
  let passed = 0;

  // ── Sequential loop (one by one to avoid rate limits) ────────────────────
  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];
    try {
      const result = await runOne(evalCase, experimentName);
      results.push(result);
      if (result.passed) passed++;
    } catch (err) {
      console.error(`[${evalCase.id}] ❌ Unexpected error: ${(err as Error).message}`);
      // Push a failed result so totals stay accurate
      results.push({
        caseId: evalCase.id,
        rawVideoPath: '',
        compressedVideoPath: '',
        finishReason: 'error',
        durationSeconds: 0,
        numSteps: 0,
        timedOut: false,
        errorOccurred: true,
        task_completed: false,
        navigation_accuracy: 0,
        output_correctness: 0,
        unnecessary_actions: false,
        efficiency_score: 0,
        reasoning: (err as Error).message,
        passed: false,
      });
    }

    // Wait between cases (skip after last)
    if (i < cases.length - 1) {
      console.log(`\n  Waiting ${BETWEEN_CASE_DELAY_MS / 1000}s before next case…`);
      await sleep(BETWEEN_CASE_DELAY_MS);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const passRate = cases.length > 0 ? (passed / cases.length) * 100 : 0;

  const summary: EvalSummary = {
    runAt: new Date().toISOString(),
    totalCases: cases.length,
    passed,
    failed: cases.length - passed,
    timedOut: results.filter((r) => r.timedOut).length,
    passRate,
    threshold,
    belowThreshold: passRate < threshold,
    results,
  };

  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));

  banner('Results');
  console.log(`  Total : ${cases.length}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${cases.length - passed}`);
  console.log(`  Timed out: ${summary.timedOut}`);
  console.log(`  Pass rate: ${passRate.toFixed(1)}%  (threshold: ${threshold}%)`);
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
