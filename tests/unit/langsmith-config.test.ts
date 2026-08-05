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
    // Reset globals
    const g = globalThis as any;
    delete g.__LANGSMITH_API_KEY__;
    delete g.__LANGSMITH_PROJECT__;
    delete g.__LANGSMITH_ENDPOINT__;
    delete g.__LANGSMITH_TRACING__;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const g = globalThis as any;
    delete g.__LANGSMITH_API_KEY__;
    delete g.__LANGSMITH_PROJECT__;
    delete g.__LANGSMITH_ENDPOINT__;
    delete g.__LANGSMITH_TRACING__;
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
    expect(getLangSmithTracer()).toEqual({ name: 'mocked-tracer' });
  });

  it('treats tracing as enabled if __LANGSMITH_API_KEY__ is set and __LANGSMITH_TRACING__ is not false', () => {
    const g = globalThis as any;
    g.__LANGSMITH_API_KEY__ = 'global-secret-key';
    g.__LANGSMITH_ENDPOINT__ = 'https://global.smith.langchain.com';

    initializeLangSmith();

    expect(getLangSmithTracer()).toEqual({ name: 'mocked-tracer' });
  });

  it('does not initialize tracer if __LANGSMITH_TRACING__ is set to false', () => {
    const g = globalThis as any;
    g.__LANGSMITH_API_KEY__ = 'global-secret-key';
    g.__LANGSMITH_ENDPOINT__ = 'https://global.smith.langchain.com';
    g.__LANGSMITH_TRACING__ = 'false';

    initializeLangSmith();

    expect(getLangSmithTracer()).toBeNull();
  });
});
