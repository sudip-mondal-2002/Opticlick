/**
 * LangSmith configuration helper for Chrome extension context.
 *
 * process.env assignments are not reliably read by LangChain's internal tracer
 * in a service worker environment — so we use explicit callbacks instead.
 */

import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { Client } from 'langsmith';

let _tracer: LangChainTracer | null = null;

export function initializeLangSmith(): void {
  const apiKey = import.meta.env.VITE_LANGSMITH_API_KEY as string | undefined;
  const endpoint = import.meta.env.VITE_LANGSMITH_ENDPOINT as string | undefined;
  const project = import.meta.env.VITE_LANGSMITH_PROJECT as string | undefined;
  const tracing = import.meta.env.VITE_LANGSMITH_TRACING === 'true';

  console.log('[LangSmith] Initializing with config:', {
    tracing,
    endpoint: endpoint ? '✓ set' : '✗ empty',
    apiKey: apiKey ? `✓ set (${apiKey.substring(0, 20)}...)` : '✗ empty',
    project,
  });

  if (!tracing || !apiKey || !endpoint) {
    console.warn('[LangSmith] Tracing disabled or missing config — no traces will be sent.');
    _tracer = null;
    return;
  }

  const client = new Client({ apiKey, apiUrl: endpoint });
  _tracer = new LangChainTracer({ projectName: project, client });
  console.log('[LangSmith] Tracer initialized ✓');
}

/** Returns the active LangChainTracer, or null if tracing is disabled. */
export function getLangSmithTracer(): LangChainTracer | null {
  return _tracer;
}
