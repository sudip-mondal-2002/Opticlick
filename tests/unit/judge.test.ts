import { describe, expect, it } from 'vitest';
import { parseJudgeResponse } from '../../evals/judge';

describe('judge response parser', () => {
  it('recovers complete scores when only reasoning is truncated', () => {
    const result = parseJudgeResponse(`\`\`\`json
{
  "task_completed": true,
  "navigation_accuracy": 1,
  "output_correctness": 1,
  "unnecessary_actions": false,
  "reasoning": "The agent successfully navigated`);
    expect(result).toMatchObject({
      task_completed: true,
      navigation_accuracy: 1,
      output_correctness: 1,
      unnecessary_actions: false,
    });
  });
});
