/**
 * evals/langsmith.ts
 *
 * LangSmith SDK wrapper.
 *
 * - loadCases()    : load eval cases from local dataset.json
 *                    (optionally filtered by EVAL_FILTER / EVAL_IDS env vars)
 * - logResult()    : log a completed EvalResult to LangSmith as a run + feedback scores
 * - createExperimentRun() / endExperimentRun() : wrap the entire batch
 */

import { Client } from 'langsmith';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { EvalCase, EvalResult } from './types.js';
import type { ProgrammaticMetrics } from './metrics.js';
import type { JudgeResult } from './types.js';

const LANGSMITH_DATASET_NAME = 'Opticlick Eval Test Cases';

function getClient(): Client {
  const apiKey = process.env.LANGSMITH_API_KEY;
  if (!apiKey) throw new Error('LANGSMITH_API_KEY is not set');
  return new Client({ apiKey });
}

/**
 * Load eval cases directly from LangSmith SDK instead of local dataset.json.
 * Filtered by:
 *   EVAL_IDS      = comma-separated case IDs  (e.g. "eval-001,eval-003")
 *   EVAL_FILTER   = difficulty level or "non-auth" | "all" | "easy" | "medium" | "hard"
 */
export async function loadCases(): Promise<EvalCase[]> {
  const client = getClient();
  const all: EvalCase[] = [];

  try {
    for await (const example of client.listExamples({ datasetName: LANGSMITH_DATASET_NAME })) {
      const inputs = example.inputs || {};
      const outputs = example.outputs || {};
      
      all.push({
        id: (inputs.id as string) || example.id,
        title: (inputs.title as string) || 'Untitled Case',
        difficulty: (inputs.difficulty as 'easy' | 'medium' | 'hard') || 'medium',
        requiresAuth: (inputs.requiresAuth as boolean) || false,
        timeoutMs: (inputs.timeoutMs as number) || 300000,
        prompt: (inputs.prompt as string) || (inputs.input as string) || '',
        expectedOutput: (outputs?.expectedOutput as string) || (outputs?.output as string) || '',
      });
    }
  } catch (err) {
    console.error(`❌ Failed to fetch dataset '${LANGSMITH_DATASET_NAME}' from LangSmith: ${(err as Error).message}`);
    console.error('Make sure LANGSMITH_API_KEY is set and the dataset exists.');
    process.exit(1);
  }

  const ids = process.env.EVAL_IDS;
  if (ids) {
    const idSet = new Set(ids.split(',').map((s) => s.trim()));
    return all.filter((c) => idSet.has(c.id));
  }

  const filter = (process.env.EVAL_FILTER ?? 'non-auth').toLowerCase();
  switch (filter) {
    case 'all':
      return all;
    case 'easy':
      return all.filter((c) => c.difficulty === 'easy');
    case 'medium':
      return all.filter((c) => c.difficulty === 'medium');
    case 'hard':
      return all.filter((c) => c.difficulty === 'hard');
    case 'non-auth':
    default:
      return all.filter((c) => !c.requiresAuth);
  }
}

/**
 * Log a single eval result to LangSmith.
 * Creates a run linked to the dataset + logs all metric scores as feedback.
 */
export async function logResult(
  evalCase: EvalCase,
  result: EvalResult,
  metrics: ProgrammaticMetrics,
  judgeResult: JudgeResult,
  experimentName: string,
): Promise<void> {
  const client = getClient();

  // Find the matching example in the LangSmith dataset (best-effort; skip if not found)
  let referenceExampleId: string | undefined;
  try {
    for await (const example of client.listExamples({
      datasetName: LANGSMITH_DATASET_NAME,
    })) {
      // Match by title or id stored in example inputs
      const exInputs = example.inputs as Record<string, unknown>;
      if (
        exInputs?.id === evalCase.id ||
        exInputs?.title === evalCase.title
      ) {
        referenceExampleId = example.id;
        break;
      }
    }
  } catch {
    // Non-fatal — LangSmith dataset lookup is optional
  }

  const runId = crypto.randomUUID();
  const startTime = new Date(Date.now() - metrics.time_to_completion_seconds * 1000);

  // Create the run
  await client.createRun({
    id: runId,
    name: `[${evalCase.id}] ${evalCase.title}`,
    run_type: 'chain',
    project_name: process.env.LANGSMITH_PROJECT ?? 'opticlick-evals',
    inputs: {
      id: evalCase.id,
      title: evalCase.title,
      difficulty: evalCase.difficulty,
      prompt: evalCase.prompt,
      expectedOutput: evalCase.expectedOutput,
    },
    outputs: {
      finishReason: result.finishReason,
      passed: result.passed,
      videoPath: result.compressedVideoPath,
      judgeReasoning: judgeResult.reasoning,
    },
    extra: {
      metadata: {
        experiment: experimentName,
        model: 'gemma-4-31b-it',
        requiresAuth: evalCase.requiresAuth,
      },
    },
    reference_example_id: referenceExampleId,
    start_time: startTime.toISOString(),
  });

  // End the run
  await client.updateRun(runId, {
    end_time: new Date().toISOString(),
    error: result.errorOccurred ? 'Agent errored' : undefined,
  });

  // Log qualitative (LLM judge) feedback scores
  const qualitativeScores: Array<[string, number | boolean]> = [
    ['task_completed', judgeResult.task_completed ? 1 : 0],
    ['navigation_accuracy', judgeResult.navigation_accuracy],
    ['output_correctness', judgeResult.output_correctness],
    ['unnecessary_actions', judgeResult.unnecessary_actions ? 1 : 0],
    ['efficiency_score', judgeResult.efficiency_score],
  ];

  for (const [key, score] of qualitativeScores) {
    await client.createFeedback(runId, key, {
      score: score as number,
      sourceInfo: { model: 'gemma-4-31b-it', type: 'llm_judge' },
    });
  }

  // Log programmatic feedback scores
  const programmaticScores: Array<[string, number]> = [
    ['time_to_completion_seconds', metrics.time_to_completion_seconds],
    ['video_duration_seconds', metrics.video_duration_seconds],
    ['num_steps', metrics.num_steps],
    ['timed_out', metrics.timed_out ? 1 : 0],
    ['error_occurred', metrics.error_occurred ? 1 : 0],
  ];

  for (const [key, score] of programmaticScores) {
    await client.createFeedback(runId, key, {
      score,
      sourceInfo: { type: 'programmatic' },
    });
  }
}
