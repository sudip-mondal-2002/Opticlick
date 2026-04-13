import { describe, it, expect, vi, afterEach } from 'vitest';
import { createModel, createAnthropicModel, createOpenAIModel, createCustomOpenAIModel } from '@/utils/llm';
import { DEFAULT_MODEL } from '@/utils/models';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';

// Mock all LLM constructors
vi.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: vi.fn((config) => ({ _config: config })),
}));

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: vi.fn((config) => ({ _config: config })),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn((config) => ({ _config: config })),
}));

describe('createModel (Gemini)', () => {
  const testApiKey = 'test-api-key-12345';

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create a model with provided API key', () => {
    createModel(testApiKey);
    expect(ChatGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: testApiKey,
      }),
    );
  });

  it('should use DEFAULT_MODEL when no modelId is provided', () => {
    createModel(testApiKey);
    expect(ChatGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_MODEL,
      }),
    );
  });

  it('should use provided modelId when specified', () => {
    const customModelId = 'gemini-4-31b';
    createModel(testApiKey, customModelId);
    expect(ChatGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({
        model: customModelId,
      }),
    );
  });

  it('should set temperature to 0.1', () => {
    createModel(testApiKey);
    expect(ChatGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.1,
      }),
    );
  });

  it('should set maxRetries to 0', () => {
    createModel(testApiKey);
    expect(ChatGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 0,
      }),
    );
  });

  it('should enable thinking config', () => {
    createModel(testApiKey);
    expect(ChatGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({
        thinkingConfig: {
          thinkingLevel: 'HIGH',
          includeThoughts: true,
        },
      }),
    );
  });

  it('should handle different model IDs correctly', () => {
    const modelIds = [
      'gemini-3.1-flash-lite-preview',
      'gemini-4-31b',
    ];

    for (const modelId of modelIds) {
      vi.clearAllMocks();
      createModel(testApiKey, modelId);
      expect(ChatGoogleGenerativeAI).toHaveBeenCalledWith(
        expect.objectContaining({
          model: modelId,
        }),
      );
    }
  });
});

describe('createAnthropicModel', () => {
  const testApiKey = 'sk-ant-test-key';

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create ChatAnthropic with correct model name (prefix stripped)', () => {
    createAnthropicModel(testApiKey, 'anthropic:claude-sonnet-4-20250514');
    expect(ChatAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-20250514',
      }),
    );
  });

  it('should pass the API key', () => {
    createAnthropicModel(testApiKey, 'anthropic:claude-haiku-4-20250514');
    expect(ChatAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        anthropicApiKey: testApiKey,
      }),
    );
  });

  it('should set temperature 0.1 and maxRetries 0', () => {
    createAnthropicModel(testApiKey, 'anthropic:claude-sonnet-4-20250514');
    expect(ChatAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.1,
        maxRetries: 0,
      }),
    );
  });

  it('should enable extended thinking', () => {
    createAnthropicModel(testApiKey, 'anthropic:claude-sonnet-4-20250514');
    expect(ChatAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        thinking: { type: 'enabled', budget_tokens: 10000 },
      }),
    );
  });
});

describe('createOpenAIModel', () => {
  const testApiKey = 'sk-test-key';

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create ChatOpenAI with correct model name (prefix stripped)', () => {
    createOpenAIModel(testApiKey, 'openai:gpt-4.1');
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4.1',
      }),
    );
  });

  it('should pass the API key', () => {
    createOpenAIModel(testApiKey, 'openai:gpt-4.1');
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        openAIApiKey: testApiKey,
      }),
    );
  });

  it('should set temperature 0.1 for standard models', () => {
    createOpenAIModel(testApiKey, 'openai:gpt-4.1');
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.1,
      }),
    );
  });

  it('should use reasoning_effort for o-series models instead of temperature', () => {
    createOpenAIModel(testApiKey, 'openai:o4-mini');
    const call = vi.mocked(ChatOpenAI).mock.calls[0][0];
    expect(call).not.toHaveProperty('temperature');
    expect(call).toHaveProperty('modelKwargs', { reasoning_effort: 'medium' });
  });
});

describe('createCustomOpenAIModel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create ChatOpenAI with custom base URL', () => {
    createCustomOpenAIModel({
      id: 'abc-123',
      name: 'Together AI',
      baseUrl: 'https://api.together.xyz/v1',
      apiKey: 'together-key',
      modelName: 'meta-llama/Llama-3-70b',
    });
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'meta-llama/Llama-3-70b',
        openAIApiKey: 'together-key',
        configuration: { baseURL: 'https://api.together.xyz/v1' },
      }),
    );
  });

  it('should use "not-needed" when no API key is provided', () => {
    createCustomOpenAIModel({
      id: 'local-1',
      name: 'Local vLLM',
      baseUrl: 'http://localhost:8000/v1',
      modelName: 'llama3',
    });
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        openAIApiKey: 'not-needed',
      }),
    );
  });
});
