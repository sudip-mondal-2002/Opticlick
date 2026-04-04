import { describe, it, expect, vi } from 'vitest';
import { createModel } from '@/utils/llm';
import { DEFAULT_MODEL } from '@/utils/models';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

// Mock the ChatGoogleGenerativeAI constructor
vi.mock('@langchain/google-genai', () => {
  return {
    ChatGoogleGenerativeAI: vi.fn((config) => ({
      _config: config,
    })),
  };
});

describe('createModel', () => {
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
    const customModelId = 'gemini-2.5-flash';
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
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-4-31b',
      'gemini-4-26b',
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
