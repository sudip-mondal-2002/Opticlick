/**
 * evals/langsmith.ts
 *
 * LangSmith SDK wrapper.
 *
 * - loadFilteredExamples() : fetch raw LangSmith Example objects filtered by
 *                            EVAL_AUTH_FILTER, EVAL_DIFFICULTY, or EVAL_IDS — passed directly
 *                            to evaluate() so runs are properly linked to the dataset as an experiment.
 * - loadCases()            : same data, typed as EvalCase[] (used for summary/threshold logic)
 */

import { Client } from 'langsmith';
import type { Example } from 'langsmith/schemas';
import type { EvalCase } from './types.js';

/** Dataset name — set via LANGSMITH_DATASET_NAME env var (workflow dispatch input). */
function getDatasetName(): string {
  return process.env.LANGSMITH_DATASET_NAME || 'Opticlick Eval Test Cases';
}

/** Immutable dataset UUID. Prefer this over the display name when configured. */
export function getDatasetId(): string | undefined {
  return process.env.LANGSMITH_DATASET_ID || undefined;
}

export function getClient(): Client {
  const apiKey = process.env.LANGSMITH_API_KEY;
  if (!apiKey) throw new Error('LANGSMITH_API_KEY is not set');
  return new Client({ apiKey });
}

/** Convert raw LangSmith Example inputs into a typed EvalCase. */
export function exampleToEvalCase(example: Example): EvalCase {
  const inputs  = (example.inputs  ?? {}) as Record<string, unknown>;
  const outputs = (example.outputs ?? {}) as Record<string, unknown>;
  const metadata = (example.metadata ?? {}) as Record<string, unknown>;
  // Dataset table columns such as difficulty/requires_auth are metadata in
  // LangSmith. Inputs win when a dataset intentionally embeds them there.
  const fields = { ...metadata, ...inputs };

  // LangSmith dataset uses snake_case field names; support both for robustness
  const rawRequiresAuth = fields.requires_auth ?? fields.requiresAuth ?? fields['Requires Auth'] ?? fields.Requires_Auth;
  const requiresAuth =
    rawRequiresAuth === true || String(rawRequiresAuth).toLowerCase() === 'true';

  const rawDifficulty = (fields.difficulty ?? fields.Difficulty ?? 'medium') as string;
  const difficulty = rawDifficulty.toLowerCase() as 'easy' | 'medium' | 'hard';

  // case_number is the dataset's numeric ID field; fall back to example.id (UUID)
  const rawCaseNumber = fields.case_number ?? fields.caseNumber ?? fields['Case Number'] ?? fields.Case_Number;
  const id = rawCaseNumber != null
    ? String(rawCaseNumber)
    : (fields.id as string) || example.id;

  const configuredTimeout = Number(process.env.EVAL_CASE_TIMEOUT_SECONDS ?? 480) * 1000;
  const timeoutMs =
    Number(fields.timeout_ms ?? fields.timeoutMs) || configuredTimeout;

  const prompt =
    (fields.prompt as string) ||
    (fields.input  as string) || '';

  const expectedOutput =
    (outputs.expected_output as string) ||
    (outputs.expectedOutput  as string) ||
    (outputs.output          as string) || '';

  return {
    id,
    title:             (fields.title as string) || `Case ${id}`,
    difficulty,
    requiresAuth,
    timeoutMs,
    prompt,
    expectedOutput,
    langsmithExampleId: example.id, // LangSmith UUID — used to link run to example
  };
}

export function applyFilter(cases: EvalCase[]): EvalCase[] {
  const ids = process.env.EVAL_IDS;
  if (ids) {
    const idSet = new Set(ids.split(',').map((s) => s.trim()));
    return cases.filter((c) => idSet.has(c.id));
  }

  let filtered = cases;

  const authFilter = (process.env.EVAL_AUTH_FILTER ?? 'non-auth').toLowerCase();
  if (authFilter === 'non-auth') {
    filtered = filtered.filter((c) => !c.requiresAuth);
  } else if (authFilter === 'auth') {
    filtered = filtered.filter((c) => c.requiresAuth);
  }

  const diffFilter = (process.env.EVAL_DIFFICULTY ?? 'all').toLowerCase();
  if (diffFilter !== 'all') {
    filtered = filtered.filter((c) => c.difficulty === diffFilter);
  }

  return filtered;
}

/**
 * Fetch raw LangSmith Example objects, filtered by EVAL_AUTH_FILTER / EVAL_DIFFICULTY / EVAL_IDS.
 * Pass the returned array directly to evaluate() so runs are linked to the
 * dataset and grouped as a proper experiment.
 */
export async function loadFilteredExamples(): Promise<Example[]> {
  const client = getClient();
  const datasetName = getDatasetName();
  const datasetId = getDatasetId();
  const allExamples: Example[] = [];

  try {
    for await (const example of client.listExamples(datasetId ? { datasetId } : { datasetName })) {
      allExamples.push(example);
    }
  } catch (err) {
    console.error(`❌ Failed to fetch dataset '${datasetId ?? datasetName}' from LangSmith: ${(err as Error).message}`);
    console.error('Make sure LANGSMITH_API_KEY is set and the dataset exists in LangSmith.');
    process.exit(1);
  }

  // Convert to EvalCase for filtering, then map back to Example
  const allCases = allExamples.map(exampleToEvalCase);
  const filteredCases = applyFilter(allCases);
  const filteredIds = new Set(filteredCases.map((c) => c.langsmithExampleId));

  return allExamples.filter((ex) => filteredIds.has(ex.id));
}

/**
 * Load filtered examples as typed EvalCase[] (used for threshold/summary logic).
 */
export async function loadCases(): Promise<EvalCase[]> {
  const examples = await loadFilteredExamples();
  return examples.map(exampleToEvalCase);
}
