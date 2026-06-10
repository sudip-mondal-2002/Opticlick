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
import { HumanMessage } from '@langchain/core/messages';
import type { EvalCase, JudgeResult, RunResult } from './types.js';

/** Expected number of steps for each difficulty (for efficiency calculation). */
const EXPECTED_STEPS: Record<EvalCase['difficulty'], number> = {
  easy: 5,
  medium: 10,
  hard: 20,
};

/** Gemma 4 judge model — temperature 0 for deterministic scoring. */
function getJudgeModel(): ChatGoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  return new ChatGoogleGenerativeAI({
    model: 'gemma-4-31b-it',
    apiKey,
    temperature: 0,
    maxRetries: 2,
  });
}

const JUDGE_SYSTEM_PROMPT = `You are an impartial evaluator for an autonomous web agent called Opticlick.
You will be shown screen recording frames of the agent completing a task in a browser.
Your job is to score the agent's performance objectively.
Always respond with valid JSON only — no markdown, no explanation outside the JSON.`;

function buildJudgePrompt(
  evalCase: EvalCase,
  frames: string[],
  agentOutput: string,
): HumanMessage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: Array<any> = [
    {
      type: 'text',
      text: `${JUDGE_SYSTEM_PROMPT}

Task given to the agent:
"${evalCase.prompt}"

Expected outcome:
"${evalCase.expectedOutput}"

${
  agentOutput
    ? `Agent's actual log output (last 40 entries from the session):
<agent_output>
${agentOutput}
</agent_output>

Use this text output to evaluate output_correctness — it shows exactly what the agent found and reported.`
    : 'No agent log output was captured.'
}

You are also shown ${frames.length} screen frames sampled from the main browser tab recording (navigation evidence).
Analyze both the text output above AND the frames, then respond with ONLY this JSON (no extra text):

{
  "task_completed": true or false,
  "navigation_accuracy": 0 or 0.5 or 1,
  "output_correctness": 0 or 0.5 or 1,
  "unnecessary_actions": true or false,
  "reasoning": "one concise sentence explaining your verdict"
}

Scoring guide:
- task_completed: true ONLY if the agent fully finished the stated task AND provided the answer
- navigation_accuracy: 1 = visited the exact correct site(s); 0.5 = partially correct; 0 = wrong
- output_correctness: 1 = agent's answer matches expected; 0.5 = partially correct; 0 = wrong or missing
- unnecessary_actions: true if agent took clearly irrelevant steps that added no value`,
    },
  ];

  // Add frames as inline images (Google GenAI format)
  for (let i = 0; i < frames.length; i++) {
    content.push({ type: 'text', text: `--- Frame ${i + 1} of ${frames.length} ---` });
    content.push({ type: 'image', url: `data:image/png;base64,${frames[i]}` });
  }

  return new HumanMessage({ content });
}

/** Parse the judge LLM's JSON response, with fallback on parse failure. */
function parseJudgeResponse(raw: string): Omit<JudgeResult, 'efficiency_score'> {
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

  const model = getJudgeModel();
  const message = buildJudgePrompt(evalCase, frames, runResult.agentOutput ?? '');

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
