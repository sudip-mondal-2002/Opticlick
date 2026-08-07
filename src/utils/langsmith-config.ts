/**
 * LangSmith configuration helper for Chrome extension context.
 *
 * process.env assignments are not reliably read by LangChain's internal tracer
 * in a service worker environment — so we use explicit callbacks instead.
 */

import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { Client } from 'langsmith';
import { RunTree } from 'langsmith/run_trees';

let _tracer: LangChainTracer | null = null;
let _client: Client | null = null;

export function initializeLangSmith(): void {
  const globalObj = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});
  const g = globalObj as unknown as Record<string, string | undefined>;

  const apiKey = g.__LANGSMITH_API_KEY__ || (import.meta.env.VITE_LANGSMITH_API_KEY as string | undefined);
  const endpoint = g.__LANGSMITH_ENDPOINT__ || (import.meta.env.VITE_LANGSMITH_ENDPOINT as string | undefined);
  const project = g.__LANGSMITH_PROJECT__ || (import.meta.env.VITE_LANGSMITH_PROJECT as string | undefined);
  const tracing = g.__LANGSMITH_TRACING__ === 'true' || (g.__LANGSMITH_API_KEY__ !== undefined && g.__LANGSMITH_TRACING__ !== 'false') || import.meta.env.VITE_LANGSMITH_TRACING === 'true';

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
  _client = client;
  _tracer = new LangChainTracer({ projectName: project, client });
  const parentHeadersRaw = g.__LANGSMITH_PARENT_HEADERS__;
  if (parentHeadersRaw) {
    try {
      const parent = RunTree.fromHeaders(JSON.parse(parentHeadersRaw) as Record<string, string>, {
        client,
        project_name: project,
      });
      if (parent) _tracer.updateFromRunTree(parent);
    } catch (error) {
      console.warn('[LangSmith] Invalid distributed parent headers:', error);
    }
  }
  console.log('[LangSmith] Tracer initialized ✓');
}

/** Returns the active LangChainTracer, or null if tracing is disabled. */
export function getLangSmithTracer(): LangChainTracer | null {
  return _tracer;
}

// The Playwright eval harness injects ephemeral LangSmith credentials after
// the MV3 service worker has loaded. Expose a narrow re-initialization hook so
// detailed graph/model/tool traces are enabled without baking secrets into the
// extension bundle.
if (typeof globalThis !== 'undefined') {
  const runtime = globalThis as typeof globalThis & {
    __OPTICLICK_INITIALIZE_LANGSMITH__?: () => void;
    __OPTICLICK_FLUSH_LANGSMITH__?: () => Promise<void>;
  };
  runtime.__OPTICLICK_INITIALIZE_LANGSMITH__ = initializeLangSmith;
  runtime.__OPTICLICK_FLUSH_LANGSMITH__ = async () => {
    await _client?.awaitPendingTraceBatches();
  };
}
