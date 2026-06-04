import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAnyModel } from '@/utils/llm';
import type { ApiKeys } from '@/utils/llm';

// Mock all LLM constructors
vi.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: vi.fn((config) => ({ _type: 'gemini', _config: config })),
}));

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: vi.fn((config) => ({ _type: 'anthropic', _config: config })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn((config) => ({ _type: 'openai', _config: config })),
}));

vi.mock('@langchain/ollama', () => ({
  ChatOllama: vi.fn((config) => ({ _type: 'ollama', _config: config })),
}));

describe('createAnyModel dispatch', () => {
  const keys: ApiKeys = {
    geminiApiKey: 'gemini-key',
    anthropicApiKey: 'anthropic-key',
    openaiApiKey: 'openai-key',
    customOpenaiConfigs: [
      { id: 'cfg-1', name: 'Together', baseUrl: 'https://api.together.xyz/v1', apiKey: 'tog-key', modelName: 'llama3' },
    ],
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should dispatch to Gemini for unprefixed model IDs', () => {
    const model = createAnyModel(keys, 'gemini-3.1-flash-lite-preview') as { _type: string };
    expect(model._type).toBe('gemini');
  });

  it('should dispatch to Anthropic for anthropic: prefixed IDs', () => {
    const model = createAnyModel(keys, 'anthropic:claude-sonnet-4-20250514') as { _type: string };
    expect(model._type).toBe('anthropic');
  });

  it('should dispatch to OpenAI for openai: prefixed IDs', () => {
    const model = createAnyModel(keys, 'openai:gpt-4.1') as { _type: string };
    expect(model._type).toBe('openai');
  });

  it('should dispatch to Custom OpenAI for custom-openai: prefixed IDs', () => {
    const model = createAnyModel(keys, 'custom-openai:cfg-1') as { _type: string };
    expect(model._type).toBe('openai'); // Custom uses ChatOpenAI under the hood
  });

  it('should dispatch to Ollama for ollama: prefixed IDs', () => {
    const model = createAnyModel(keys, 'ollama:llama3.2:3b') as { _type: string };
    expect(model._type).toBe('ollama');
  });

  // Error cases
  it('should throw for Gemini when no Gemini key', () => {
    expect(() => createAnyModel({ ...keys, geminiApiKey: null }, 'gemini-3.1-flash-lite-preview'))
      .toThrow('Gemini API key required');
  });

  it('should throw for Anthropic when no Anthropic key', () => {
    expect(() => createAnyModel({ ...keys, anthropicApiKey: null }, 'anthropic:claude-sonnet-4-20250514'))
      .toThrow('Anthropic API key required');
  });

  it('should throw for OpenAI when no OpenAI key', () => {
    expect(() => createAnyModel({ ...keys, openaiApiKey: null }, 'openai:gpt-4.1'))
      .toThrow('OpenAI API key required');
  });

  it('should throw for unknown custom config ID', () => {
    expect(() => createAnyModel(keys, 'custom-openai:nonexistent'))
      .toThrow('Custom OpenAI config "nonexistent" not found');
  });

  it('should not throw for Ollama (no key required)', () => {
    expect(() => createAnyModel({ geminiApiKey: null }, 'ollama:llama3')).not.toThrow();
  });
});
