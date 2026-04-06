/**
 * LangSmith debug utilities — call this to verify the extension
 * has access to the environment configuration at runtime.
 */

export function debugLangSmithConfig(): Record<string, unknown> {
  const config = {
    'import.meta.env.VITE_LANGSMITH_TRACING': import.meta.env.VITE_LANGSMITH_TRACING,
    'import.meta.env.VITE_LANGSMITH_ENDPOINT': import.meta.env.VITE_LANGSMITH_ENDPOINT,
    'import.meta.env.VITE_LANGSMITH_API_KEY_PREFIX': import.meta.env.VITE_LANGSMITH_API_KEY
      ? `${import.meta.env.VITE_LANGSMITH_API_KEY.substring(0, 20)}...`
      : undefined,
    'import.meta.env.VITE_LANGSMITH_PROJECT': import.meta.env.VITE_LANGSMITH_PROJECT,
    'process.env.LANGSMITH_TRACING': typeof process !== 'undefined' ? process.env.LANGSMITH_TRACING : 'N/A',
    'globalThis.LANGSMITH_API_KEY': typeof globalThis !== 'undefined'
      ? (globalThis as Record<string, unknown>).LANGSMITH_API_KEY
        ? `set (${((globalThis as Record<string, unknown>).LANGSMITH_API_KEY as string).substring(0, 20)}...)`
        : 'not set'
      : 'N/A',
  };

  console.table(config);
  return config;
}

/**
 * Verify LangSmith can actually send traces by checking connectivity and recent runs.
 */
export async function verifyLangSmithConnectivity(): Promise<boolean> {
  const endpoint = import.meta.env.VITE_LANGSMITH_ENDPOINT;
  const apiKey = import.meta.env.VITE_LANGSMITH_API_KEY;
  const project = import.meta.env.VITE_LANGSMITH_PROJECT;

  if (!endpoint || !apiKey) {
    console.warn('[LangSmith] Missing endpoint or API key, cannot verify connectivity');
    return false;
  }

  try {
    // Check if we can connect to LangSmith
    const projectResponse = await fetch(`${endpoint}/api/v1/projects`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
      },
    });
    console.log(`[LangSmith] API connectivity: ${projectResponse.ok ? '✓ OK' : `✗ ${projectResponse.status}`}`);

    if (!projectResponse.ok) return false;

    // Check for recent runs in the project
    if (project) {
      const runsUrl = `${endpoint}/api/v1/projects/${encodeURIComponent(project)}/runs?limit=5`;
      const runsResponse = await fetch(runsUrl, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
        },
      });

      if (runsResponse.ok) {
        const data = (await runsResponse.json()) as { runs?: unknown[] };
        const runCount = Array.isArray(data.runs) ? data.runs.length : 0;
        console.log(`[LangSmith] Recent runs in "${project}" project: ${runCount}`);
        if (runCount > 0) {
          console.log('[LangSmith] ✓ Traces are being received!');
          console.log(`[LangSmith] View at: https://smith.langchain.com/o/user/projects/p/${encodeURIComponent(project)}`);
        } else {
          console.warn('[LangSmith] No recent runs found. Check if LLM calls are being made.');
        }
      }
    }

    return projectResponse.ok;
  } catch (err) {
    console.error('[LangSmith] Connectivity check failed:', err);
    return false;
  }
}
