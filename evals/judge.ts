/**
 * evals/judge.ts
 *
 * Gemma 4 LLM-as-judge.
 *
 * Takes the eval case (prompt + expectedOutput) and a set of video frames
 * (base64 PNG), then asks Gemma 4 to return a structured JSON score.
 *
 * Judge rubric (0-3 points total):
 *   - task_completed (bool)        → PRIMARY CI gate
 *   - navigation_accuracy (0|0.5|1) → did agent visit correct sites?
 *   - output_correctness (0|0.5|1)  → does final answer match expected?
 *   - unnecessary_actions (bool)    → did agent waste steps?
 *
 * efficiency_score is computed locally (not by the LLM):
 *   min(1, EXPECTED_STEPS[difficulty] / actualSteps)
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import type { EvalCase, JudgeResult, RunResult } from './types.js';

/** Expected number of steps for each difficulty (for efficiency calculation). */
const EXPECTED_STEPS: Record<EvalCase['difficulty'], number> = {
  easy: 5,
  medium: 10,
  hard: 20,
};

/**
 * Use a separate quota bucket from the agent model. Judging immediately with
 * Gemma 4 caused deterministic 429s because the agent had just consumed the
 * model's free-tier input-token allowance.
 */
function getJudgeModel(): { model: ChatGoogleGenerativeAI | ChatOpenAI; supportsVision: boolean } {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    return {
      model: new ChatOpenAI({
        model: process.env.EVAL_JUDGE_MODEL ?? 'openai/gpt-oss-20b',
        apiKey: groqKey,
        temperature: 0,
        maxRetries: 2,
        configuration: { baseURL: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1' },
      }),
      supportsVision: false,
    };
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  return {
    model: new ChatGoogleGenerativeAI({
      model: process.env.EVAL_JUDGE_MODEL ?? 'gemini-3.1-flash-lite-preview',
      apiKey,
      temperature: 0,
      maxRetries: 2,
    }),
    supportsVision: true,
  };
}

const JUDGE_SYSTEM_PROMPT = 'Score this web-agent run objectively. Return JSON only.';

function buildJudgePrompt(
  evalCase: EvalCase,
  frames: string[],
  agentOutput: string,
  includeFrames = true,
): HumanMessage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: Array<any> = [
    {
      type: 'text',
      text: `${JUDGE_SYSTEM_PROMPT}
Task: ${evalCase.prompt}
Expected: ${evalCase.expectedOutput}
Run log: ${agentOutput || '(missing)'}
${includeFrames ? `Frames: ${frames.length}.` : ''}
JSON schema: {"task_completed":boolean,"navigation_accuracy":0|0.5|1,"output_correctness":0|0.5|1,"unnecessary_actions":boolean,"reasoning":"one sentence"}
Use 1 only for correct/complete, 0.5 for partial, 0 for wrong/missing.`,
    },
  ];

  // Add frames as inline images (Google GenAI format)
  for (let i = 0; includeFrames && i < frames.length; i++) {
    content.push({ type: 'text', text: `--- Frame ${i + 1} of ${frames.length} ---` });
    content.push({ type: 'image', url: `data:image/png;base64,${frames[i]}` });
  }

  return new HumanMessage({ content });
}

/** Parse the judge LLM's JSON response, with fallback on parse failure. */
export function parseJudgeResponse(raw: string): Omit<JudgeResult, 'efficiency_score'> {
  const fallback: Omit<JudgeResult, 'efficiency_score'> = {
    task_completed: false,
    navigation_accuracy: 0,
    output_correctness: 0,
    unnecessary_actions: true,
    reasoning: 'Failed to parse judge response',
  };

  try {
    // Strip markdown fences if present
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    return {
      task_completed: Boolean(parsed.task_completed),
      navigation_accuracy: [0, 0.5, 1].includes(parsed.navigation_accuracy)
        ? (parsed.navigation_accuracy as 0 | 0.5 | 1)
        : 0,
      output_correctness: [0, 0.5, 1].includes(parsed.output_correctness)
        ? (parsed.output_correctness as 0 | 0.5 | 1)
        : 0,
      unnecessary_actions: Boolean(parsed.unnecessary_actions),
      reasoning: String(parsed.reasoning ?? '').slice(0, 300),
    };
  } catch {
    // Small judges occasionally truncate only the final free-text reasoning
    // after already emitting every score. Recover those typed fields rather
    // than discarding an otherwise complete evaluation.
    const task = raw.match(/"task_completed"\s*:\s*(true|false)/i)?.[1];
    const navigation = Number(raw.match(/"navigation_accuracy"\s*:\s*(0(?:\.5)?|1)/i)?.[1]);
    const output = Number(raw.match(/"output_correctness"\s*:\s*(0(?:\.5)?|1)/i)?.[1]);
    const unnecessary = raw.match(/"unnecessary_actions"\s*:\s*(true|false)/i)?.[1];
    if (task && [0, 0.5, 1].includes(navigation) && [0, 0.5, 1].includes(output) && unnecessary) {
      return {
        task_completed: task.toLowerCase() === 'true',
        navigation_accuracy: navigation as 0 | 0.5 | 1,
        output_correctness: output as 0 | 0.5 | 1,
        unnecessary_actions: unnecessary.toLowerCase() === 'true',
        reasoning: 'Recovered scores from a truncated judge response',
      };
    }
    return fallback;
  }
}

/**
 * Judge a completed eval run using Gemma 4 vision.
 * Returns JudgeResult including the locally-computed efficiency_score.
 */
export async function judgeRun(
  evalCase: EvalCase,
  runResult: RunResult,
  frames: string[],
): Promise<JudgeResult> {
  if (frames.length === 0 || runResult.timedOut) {
    return {
      task_completed: false,
      navigation_accuracy: 0,
      output_correctness: 0,
      unnecessary_actions: false,
      efficiency_score: 0,
      reasoning: runResult.timedOut
        ? 'Agent timed out — task not completed'
        : 'No video frames available to judge',
    };
  }

  const { model, supportsVision } = getJudgeModel();
  const message = buildJudgePrompt(evalCase, frames, runResult.agentOutput ?? '', supportsVision);

  const response = await model.invoke([message]);

  // ChatGoogleGenerativeAI returns content as EITHER:
  //   - a plain string  (text-only response)
  //   - an array of blocks like [{ type: 'text', text: '...' }]  (multimodal response)
  // JSON.stringify-ing the array gives [{...}] not the inner JSON — we must extract text.
  let raw: string;
  if (typeof response.content === 'string') {
    raw = response.content;
  } else if (Array.isArray(response.content)) {
    // Find the first text block and use its text
    const textBlock = (response.content as Array<{ type: string; text?: string }>)
      .find((b) => b.type === 'text');
    raw = textBlock?.text ?? JSON.stringify(response.content);
  } else {
    raw = JSON.stringify(response.content);
  }

  // Debug: log raw response so we can inspect judge output during development
  console.log(`     [judge raw] ${raw.slice(0, 200)}`);

  const scores = parseJudgeResponse(raw);

  // Warn if reasoning is empty — indicates possible model/format issue
  if (!scores.reasoning) {
    console.warn(`     [judge warn] Empty reasoning — model may not have processed images correctly`);
  }

  const expectedSteps = EXPECTED_STEPS[evalCase.difficulty];
  const efficiency_score =
    runResult.numSteps === 0
      ? 0
      : Math.min(1, expectedSteps / runResult.numSteps);

  return { ...scores, efficiency_score };
}
