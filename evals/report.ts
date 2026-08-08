import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EvalSummary } from './types.js';

const summaryPath = path.resolve(process.cwd(), 'evals/results/summary.json');
const githubSummaryPath = process.env.GITHUB_STEP_SUMMARY;

function link(label: string, url?: string): string {
  return url ? `[${label}](${url})` : label;
}

let markdown: string;
if (!fs.existsSync(summaryPath)) {
  const datasetId = process.env.LANGSMITH_DATASET_ID;
  const datasetUrl = datasetId
    ? `https://smith.langchain.com/o/979f0f7c-6b06-4c06-a818-2963df49d2d6/datasets/${datasetId}?tab=0`
    : undefined;
  markdown = [
    '## Opticlick evaluation',
    '',
    '> ❌ The evaluation stopped before `summary.json` was produced. Inspect the failing workflow step for the setup/runtime error.',
    '',
    `Dataset: ${link(process.env.LANGSMITH_DATASET_NAME || datasetId || 'unknown', datasetUrl)}`,
  ].join('\n');
} else {
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as EvalSummary;
  let inputTokens = 0;
  let cachedTokens = 0;
  let outputTokens = 0;
  let rateLimits = 0;
  for (const result of summary.results) {
    for (const match of result.agentOutput.matchAll(/LLM tokens: input=(\d+), cached=(\d+), output=(\d+)/g)) {
      inputTokens += Number(match[1]);
      cachedTokens += Number(match[2]);
      outputTokens += Number(match[3]);
    }
    rateLimits += (result.agentOutput.match(/Rate limited \(attempt/g) ?? []).length;
  }
  const cacheRate = inputTokens === 0 ? 0 : cachedTokens / inputTokens * 100;
  const status = summary.belowThreshold ? '❌ Below threshold' : '✅ Passed threshold';
  const rows = summary.results.map((result) =>
    `| ${result.caseId || 'unknown'} | ${result.passed ? '✅' : '❌'} | ${result.finishReason} | ${result.numSteps} | ${result.durationSeconds.toFixed(1)}s | ${result.reasoning.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()} |`,
  );
  markdown = [
    '## Opticlick evaluation',
    '',
    `${status}: **${summary.passRate.toFixed(1)}%** (${summary.passed}/${summary.totalCases}), required **${summary.threshold}%**.`,
    '',
    `- Dataset: ${link(summary.datasetName, summary.datasetUrl)}`,
    `- LangSmith experiment: ${link(summary.experimentName, summary.experimentUrl)}`,
    `- Agent tokens: **${inputTokens} input** / **${cachedTokens} cached (${cacheRate.toFixed(1)}%)** / **${outputTokens} output**`,
    `- Provider rate-limit retries: **${rateLimits}**`,
    `- Average agent cost: **${summary.averageAgentInputTokens.toFixed(0)} input tokens/case** / **${summary.averageAgentLlmCalls.toFixed(2)} LLM calls/case**`,
    `- Token budget: **${summary.tokenBudget} input tokens/case** ${summary.overTokenBudget ? '❌ exceeded' : '✅ met'}`,
    `- Failed: **${summary.failed}** · Timed out: **${summary.timedOut}**`,
    '',
    '<details><summary>Per-case results</summary>',
    '',
    '| Case | Result | Finish reason | Steps | Duration | Judge reasoning |',
    '|---|---:|---|---:|---:|---|',
    ...rows,
    '',
    '</details>',
    '',
    '> Full inputs, outputs, traces, evaluator scores, and run metadata are available in the linked LangSmith experiment.',
  ].join('\n');
}

console.log(markdown);
if (githubSummaryPath) fs.appendFileSync(githubSummaryPath, `${markdown}\n`);
