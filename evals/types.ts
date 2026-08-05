/** Shared types for the Opticlick LLM eval pipeline. */

export interface EvalCase {
  id: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  requiresAuth: boolean;
  /** Per-test safety timeout in milliseconds. */
  timeoutMs: number;
  /** Prompt injected into the Opticlick sidebar. */
  prompt: string;
  /** Reference description of what success looks like (used by LLM judge). */
  expectedOutput: string;
  /** LangSmith Example UUID — stored at load time to avoid redundant dataset scans. */
  langsmithExampleId?: string;
}

export interface RunResult {
  caseId: string;
  /** Path to the raw WebM video captured by Playwright. */
  rawVideoPath: string;
  /** Path to the ffmpeg-compressed MP4. */
  compressedVideoPath: string;
  /** How the agent stopped. */
  finishReason: 'done' | 'stopped' | 'error' | 'timeout';
  /** Wall-clock seconds from agent start to completion. */
  durationSeconds: number;
  /** Value of agentState.step at completion. */
  numSteps: number;
  /** True if the per-test timeout fired. */
  timedOut: boolean;
  /** True if agentState.status === 'error'. */
  errorOccurred: boolean;
  /** Last N agent log messages from chrome.storage.session — the agent's actual text output. */
  agentOutput: string;
}

export interface JudgeResult {
  /** PRIMARY CI gate — did the agent complete the task? */
  task_completed: boolean;
  /** 0 = wrong site, 0.5 = partially correct, 1 = correct site(s). */
  navigation_accuracy: 0 | 0.5 | 1;
  /** 0 = wrong answer, 0.5 = partially correct, 1 = correct answer. */
  output_correctness: 0 | 0.5 | 1;
  /** True if agent wasted steps on irrelevant actions. */
  unnecessary_actions: boolean;
  /** min(1, expectedSteps / actualSteps) — 1.0 is perfectly efficient. */
  efficiency_score: number;
  /** One-sentence reasoning from the judge. */
  reasoning: string;
}

export type EvalResult = RunResult &
  JudgeResult & {
    /** task_completed && !timedOut && !errorOccurred */
    passed: boolean;
  };

/** Summary written to evals/results/summary.json after all cases complete. */
export interface EvalSummary {
  runAt: string;
  datasetId?: string;
  datasetName: string;
  datasetUrl?: string;
  experimentName: string;
  experimentUrl?: string;
  totalCases: number;
  passed: number;
  failed: number;
  timedOut: number;
  passRate: number;
  threshold: number;
  belowThreshold: boolean;
  results: EvalResult[];
}
