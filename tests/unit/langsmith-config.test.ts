import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializeLangSmith, getLangSmithParentRunId, getLangSmithTracer } from '@/utils/langsmith-config';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { Client } from 'langsmith';
import { RunTree } from 'langsmith/run_trees';

vi.mock('langsmith', () => ({
  Client: vi.fn(function () {
    return { awaitPendingTraceBatches: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock('@langchain/core/tracers/tracer_langchain', () => ({
  LangChainTracer: vi.fn(function () {
    return { name: 'mocked-tracer', updateFromRunTree: vi.fn() };
  }),
}));

vi.mock('langsmith/run_trees', () => ({
  RunTree: { fromHeaders: vi.fn() },
}));

describe('langsmith-config', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env
    for (const key of Object.keys(import.meta.env)) {
      vi.stubEnv(key, '');
    }
    // Reset globals
    const g = globalThis as any;
    delete g.__LANGSMITH_API_KEY__;
    delete g.__LANGSMITH_PROJECT__;
    delete g.__LANGSMITH_ENDPOINT__;
    delete g.__LANGSMITH_TRACING__;
    delete g.__LANGSMITH_PARENT_HEADERS__;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const g = globalThis as any;
    delete g.__LANGSMITH_API_KEY__;
    delete g.__LANGSMITH_PROJECT__;
    delete g.__LANGSMITH_ENDPOINT__;
    delete g.__LANGSMITH_TRACING__;
    delete g.__LANGSMITH_PARENT_HEADERS__;
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
    expect(getLangSmithTracer()).toMatchObject({ name: 'mocked-tracer' });
  });

  it('initializes tracer correctly using global overrides', () => {
    const g = globalThis as any;
    g.__LANGSMITH_API_KEY__ = 'global-secret-key';
    g.__LANGSMITH_PROJECT__ = 'global-project';
    g.__LANGSMITH_ENDPOINT__ = 'https://global.smith.langchain.com';
    g.__LANGSMITH_TRACING__ = 'true';

    initializeLangSmith();

    expect(Client).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'global-secret-key',
        apiUrl: 'https://global.smith.langchain.com',
      })
    );
    expect(LangChainTracer).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'global-project',
      })
    );
    expect(getLangSmithTracer()).toMatchObject({ name: 'mocked-tracer' });
  });

  it('treats tracing as enabled if __LANGSMITH_API_KEY__ is set and __LANGSMITH_TRACING__ is not false', () => {
    const g = globalThis as any;
    g.__LANGSMITH_API_KEY__ = 'global-secret-key';
    g.__LANGSMITH_ENDPOINT__ = 'https://global.smith.langchain.com';

    initializeLangSmith();

    expect(getLangSmithTracer()).toMatchObject({ name: 'mocked-tracer' });
  });

  it('does not initialize tracer if __LANGSMITH_TRACING__ is set to false', () => {
    const g = globalThis as any;
    g.__LANGSMITH_API_KEY__ = 'global-secret-key';
    g.__LANGSMITH_ENDPOINT__ = 'https://global.smith.langchain.com';
    g.__LANGSMITH_TRACING__ = 'false';

    initializeLangSmith();

    expect(getLangSmithTracer()).toBeNull();
  });

  it('links model spans to distributed parent headers', () => {
    const parent = { id: 'parent-run-id' };
    vi.mocked(RunTree.fromHeaders).mockReturnValue(parent as never);
    const g = globalThis as any;
    g.__LANGSMITH_API_KEY__ = 'global-secret-key';
    g.__LANGSMITH_ENDPOINT__ = 'https://api.smith.langchain.com';
    g.__LANGSMITH_PARENT_HEADERS__ = JSON.stringify({ traceparent: 'parent' });

    initializeLangSmith();

    expect(getLangSmithParentRunId()).toBe('parent-run-id');
    const tracer = vi.mocked(LangChainTracer).mock.results.at(-1)?.value as any;
    expect(tracer.updateFromRunTree).toHaveBeenCalledWith(parent);
  });

  it('ignores malformed distributed parent headers', () => {
    const g = globalThis as any;
    g.__LANGSMITH_API_KEY__ = 'global-secret-key';
    g.__LANGSMITH_ENDPOINT__ = 'https://api.smith.langchain.com';
    g.__LANGSMITH_PARENT_HEADERS__ = '{invalid';

    expect(() => initializeLangSmith()).not.toThrow();
    expect(getLangSmithParentRunId()).toBeUndefined();
  });

  it('flushes pending trace batches through the eval hook', async () => {
    const g = globalThis as any;
    g.__LANGSMITH_API_KEY__ = 'global-secret-key';
    g.__LANGSMITH_ENDPOINT__ = 'https://api.smith.langchain.com';
    initializeLangSmith();
    const client = vi.mocked(Client).mock.results.at(-1)?.value as any;

    await g.__OPTICLICK_FLUSH_LANGSMITH__();

    expect(client.awaitPendingTraceBatches).toHaveBeenCalledOnce();
  });
});
