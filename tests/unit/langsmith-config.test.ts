import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializeLangSmith, getLangSmithTracer } from '@/utils/langsmith-config';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { Client } from 'langsmith';

vi.mock('langsmith', () => ({
  Client: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@langchain/core/tracers/tracer_langchain', () => ({
  LangChainTracer: vi.fn(function () {
    return { name: 'mocked-tracer' };
  }),
}));

describe('langsmith-config', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env
    for (const key of Object.keys(import.meta.env)) {
      vi.stubEnv(key, '');
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not initialize tracer if tracing is disabled', () => {
    vi.stubEnv('VITE_LANGSMITH_TRACING', 'false');
    vi.stubEnv('VITE_LANGSMITH_API_KEY', 'test-key');
    vi.stubEnv('VITE_LANGSMITH_ENDPOINT', 'https://api.smith.langchain.com');

    initializeLangSmith();

    expect(Client).not.toHaveBeenCalled();
    expect(LangChainTracer).not.toHaveBeenCalled();
    expect(getLangSmithTracer()).toBeNull();
  });

  it('does not initialize tracer if API key is missing', () => {
    vi.stubEnv('VITE_LANGSMITH_TRACING', 'true');
    vi.stubEnv('VITE_LANGSMITH_API_KEY', '');
    vi.stubEnv('VITE_LANGSMITH_ENDPOINT', 'https://api.smith.langchain.com');

    initializeLangSmith();

    expect(Client).not.toHaveBeenCalled();
    expect(getLangSmithTracer()).toBeNull();
  });

  it('does not initialize tracer if endpoint is missing', () => {
    // Covers the `!endpoint` branch of the `if (!tracing || !apiKey || !endpoint)` guard.
    vi.stubEnv('VITE_LANGSMITH_TRACING', 'true');
    vi.stubEnv('VITE_LANGSMITH_API_KEY', 'my-secret-key-1234567890');
    vi.stubEnv('VITE_LANGSMITH_ENDPOINT', '');

    initializeLangSmith();

    expect(Client).not.toHaveBeenCalled();
    expect(getLangSmithTracer()).toBeNull();
  });

  it('initializes tracer correctly when all configs are present', () => {
    vi.stubEnv('VITE_LANGSMITH_TRACING', 'true');
    vi.stubEnv('VITE_LANGSMITH_API_KEY', 'my-secret-key-1234567890');
    vi.stubEnv('VITE_LANGSMITH_ENDPOINT', 'https://api.smith.langchain.com');
    vi.stubEnv('VITE_LANGSMITH_PROJECT', 'my-project');

    initializeLangSmith();

    expect(Client).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'my-secret-key-1234567890',
        apiUrl: 'https://api.smith.langchain.com',
      })
    );
    expect(LangChainTracer).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'my-project',
      })
    );
    expect(getLangSmithTracer()).toEqual({ name: 'mocked-tracer' });
  });
});
