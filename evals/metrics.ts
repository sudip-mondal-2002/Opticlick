/**
 * evals/metrics.ts
 *
 * Collects programmatic (non-LLM) metrics from a completed run.
 * These are cheap, deterministic, and always available.
 */

import { getVideoDuration } from './recorder.js';
import type { RunResult } from './types.js';

export interface ProgrammaticMetrics {
  /** Total wall-clock seconds from agent start to finish. */
  time_to_completion_seconds: number;
  /** Length of the compressed MP4 in seconds. */
  video_duration_seconds: number;
  /** Number of agent loop iterations (agentState.step). */
  num_steps: number;
  /** How the agent exited. */
  finish_reason: 'done' | 'stopped' | 'error' | 'timeout';
  /** True if the per-test timeout fired. */
  timed_out: boolean;
  /** True if agentState.status was 'error'. */
  error_occurred: boolean;
  agent_input_tokens: number;
  agent_cached_tokens: number;
  agent_output_tokens: number;
  agent_llm_calls: number;
  rate_limit_retries: number;
  deterministic_actions: number;
}

export function tokenMetrics(agentOutput: string) {
  let input = 0;
  let cached = 0;
  let output = 0;
  let calls = 0;
  for (const match of agentOutput.matchAll(/LLM tokens: input=(\d+), cached=(\d+), output=(\d+)/g)) {
    input += Number(match[1]);
    cached += Number(match[2]);
    output += Number(match[3]);
    calls++;
  }
  return {
    agent_input_tokens: input,
    agent_cached_tokens: cached,
    agent_output_tokens: output,
    agent_llm_calls: calls,
    rate_limit_retries: (agentOutput.match(/Rate limited \(attempt/g) ?? []).length,
    deterministic_actions: (agentOutput.match(/Deterministic (?:navigation|relationship click):/g) ?? []).length,
  };
}

export async function collectMetrics(runResult: RunResult): Promise<ProgrammaticMetrics> {
  const video_duration_seconds = runResult.compressedVideoPath
    ? await getVideoDuration(runResult.compressedVideoPath)
    : await getVideoDuration(runResult.rawVideoPath);

  return {
    time_to_completion_seconds: runResult.durationSeconds,
    video_duration_seconds,
    num_steps: runResult.numSteps,
    finish_reason: runResult.finishReason,
    timed_out: runResult.timedOut,
    error_occurred: runResult.errorOccurred,
    ...tokenMetrics(runResult.agentOutput),
  };
}

/** Convert all metrics to a flat Record for LangSmith feedback logging. */
export function metricsToFeedback(
  metrics: ProgrammaticMetrics,
): Array<{ key: string; score: number | boolean }> {
  return [
    { key: 'time_to_completion_seconds', score: metrics.time_to_completion_seconds },
    { key: 'video_duration_seconds', score: metrics.video_duration_seconds },
    { key: 'num_steps', score: metrics.num_steps },
    { key: 'timed_out', score: metrics.timed_out },
    { key: 'error_occurred', score: metrics.error_occurred },
    { key: 'agent_input_tokens', score: metrics.agent_input_tokens },
    { key: 'agent_cached_tokens', score: metrics.agent_cached_tokens },
    { key: 'agent_output_tokens', score: metrics.agent_output_tokens },
    { key: 'agent_llm_calls', score: metrics.agent_llm_calls },
    { key: 'rate_limit_retries', score: metrics.rate_limit_retries },
    { key: 'deterministic_actions', score: metrics.deterministic_actions },
  ];
}
