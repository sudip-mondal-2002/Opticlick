import { afterEach, describe, expect, it } from 'vitest';
import type { Example } from 'langsmith/schemas';
import { applyFilter, exampleToEvalCase } from '../../evals/langsmith.js';
import type { EvalCase } from '../../evals/types.js';

afterEach(() => {
  delete process.env.EVAL_AUTH_FILTER;
  delete process.env.EVAL_DIFFICULTY;
  delete process.env.EVAL_CASE_TIMEOUT_SECONDS;
});

describe('LangSmith eval dataset normalization', () => {
  it('reads benchmark fields from example metadata', () => {
    process.env.EVAL_CASE_TIMEOUT_SECONDS = '480';
    const example = {
      id: 'example-uuid',
      inputs: { title: 'Metadata case', prompt: 'do the task' },
      outputs: { expected_output: 'done' },
      metadata: {
        case_number: 27,
        difficulty: 'hard',
        requires_auth: false,
      },
    } as unknown as Example;

    expect(exampleToEvalCase(example)).toMatchObject({
      id: '27',
      title: 'Metadata case',
      difficulty: 'hard',
      requiresAuth: false,
      timeoutMs: 480000,
      prompt: 'do the task',
      expectedOutput: 'done',
    });
  });

  it('honors explicit per-example timeouts over the workflow default', () => {
    process.env.EVAL_CASE_TIMEOUT_SECONDS = '480';
    const example = {
      id: 'example-uuid',
      inputs: { prompt: 'do the task' },
      outputs: {},
      metadata: { timeout_ms: 90000 },
    } as unknown as Example;

    expect(exampleToEvalCase(example).timeoutMs).toBe(90000);
  });

  it('treats the workflow timeout as a hard maximum', () => {
    process.env.EVAL_CASE_TIMEOUT_SECONDS = '480';
    const example = {
      id: 'example-uuid',
      inputs: { prompt: 'do the task' },
      outputs: {},
      metadata: { timeout_ms: 1_200_000 },
    } as unknown as Example;

    expect(exampleToEvalCase(example).timeoutMs).toBe(480000);
  });

  it('excludes auth cases from a non-auth run', () => {
    process.env.EVAL_AUTH_FILTER = 'non-auth';
    process.env.EVAL_DIFFICULTY = 'all';
    const base = {
      id: '1', title: 'case', difficulty: 'medium', timeoutMs: 1000,
      prompt: 'prompt', expectedOutput: 'expected',
    } satisfies Omit<EvalCase, 'requiresAuth'>;

    expect(applyFilter([
      { ...base, id: 'public', requiresAuth: false },
      { ...base, id: 'private', requiresAuth: true },
    ]).map((testCase) => testCase.id)).toEqual(['public']);
  });
});
