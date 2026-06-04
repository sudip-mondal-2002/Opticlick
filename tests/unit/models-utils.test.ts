import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AVAILABLE_MODELS,
  GEMINI_MODELS,
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  DEFAULT_MODEL,
  getModelLabel,
  getProviderForModel,
  isOllamaModel,
  isAnthropicModel,
  isOpenAIModel,
  isCustomOpenAIModel,
  ollamaModelId,
  ollamaModelName,
  anthropicModelName,
  openaiModelName,
  customOpenAIConfigId,
  fetchOllamaModels,
  isOllamaAvailable,
} from '@/utils/models';
import type { CustomOpenAIConfig } from '@/utils/models';

describe('models utilities', () => {
  describe('AVAILABLE_MODELS', () => {
    it('should contain all static cloud models', () => {
      expect(AVAILABLE_MODELS).toHaveLength(
        GEMINI_MODELS.length + ANTHROPIC_MODELS.length + OPENAI_MODELS.length,
      );
    });

    it('should have required properties for each model', () => {
      for (const model of AVAILABLE_MODELS) {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('label');
        expect(model).toHaveProperty('description');
        expect(model).toHaveProperty('provider');
        expect(typeof model.id).toBe('string');
        expect(typeof model.label).toBe('string');
        expect(typeof model.description).toBe('string');
      }
    });

    it('should have correct providers for each section', () => {
      for (const m of GEMINI_MODELS) expect(m.provider).toBe('gemini');
      for (const m of ANTHROPIC_MODELS) expect(m.provider).toBe('anthropic');
      for (const m of OPENAI_MODELS) expect(m.provider).toBe('openai');
    });

    it('should have unique model IDs', () => {
      const ids = AVAILABLE_MODELS.map((m) => m.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('per-provider model arrays', () => {
    it('GEMINI_MODELS should have 2 models', () => {
      expect(GEMINI_MODELS).toHaveLength(2);
    });

    it('ANTHROPIC_MODELS should have 2 models', () => {
      expect(ANTHROPIC_MODELS).toHaveLength(2);
    });

    it('OPENAI_MODELS should have 3 models', () => {
      expect(OPENAI_MODELS).toHaveLength(3);
    });

    it('Anthropic model IDs start with anthropic:', () => {
      for (const m of ANTHROPIC_MODELS) expect(m.id).toMatch(/^anthropic:/);
    });

    it('OpenAI model IDs start with openai:', () => {
      for (const m of OPENAI_MODELS) expect(m.id).toMatch(/^openai:/);
    });
  });

  describe('DEFAULT_MODEL', () => {
    it('should be set to the first Gemini model ID', () => {
      expect(DEFAULT_MODEL).toBe(GEMINI_MODELS[0].id);
    });

    it('should be gemini-3.1-flash-lite-preview', () => {
      expect(DEFAULT_MODEL).toBe('gemini-3.1-flash-lite-preview');
    });
  });

  describe('getModelLabel', () => {
    it('should return the label for a valid Gemini model ID', () => {
      expect(getModelLabel('gemini-3.1-flash-lite-preview')).toBe('Gemini 3.1 Flash Lite');
      expect(getModelLabel('gemma-4-31b-it')).toBe('Gemma 4 31B');
    });

    it('should return labels for Anthropic models', () => {
      expect(getModelLabel('anthropic:claude-sonnet-4-20250514')).toBe('Claude Sonnet 4');
    });

    it('should return labels for OpenAI models', () => {
      expect(getModelLabel('openai:gpt-4.1')).toBe('GPT-4.1');
    });

    it('should return the ID itself if model not found', () => {
      const unknownId = 'unknown-model-id';
      expect(getModelLabel(unknownId)).toBe(unknownId);
    });

    it('should handle all available models', () => {
      for (const model of AVAILABLE_MODELS) {
        expect(getModelLabel(model.id)).toBe(model.label);
      }
    });

    it('should resolve Ollama model labels from the provided list', () => {
      const ollama = [{ id: 'ollama:llama3.2:3b', label: 'llama3.2:3b', description: 'Local · 3B', provider: 'ollama' as const }];
      expect(getModelLabel('ollama:llama3.2:3b', ollama)).toBe('llama3.2:3b');
    });

    it('should resolve custom OpenAI labels from configs', () => {
      const configs: CustomOpenAIConfig[] = [
        { id: 'abc-123', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', modelName: 'llama3' },
      ];
      expect(getModelLabel('custom-openai:abc-123', [], configs)).toBe('Together AI');
    });

    it('should return raw ID for unknown custom config', () => {
      expect(getModelLabel('custom-openai:unknown', [], [])).toBe('custom-openai:unknown');
    });
  });

  describe('isOllamaModel', () => {
    it('should return true for ollama: prefixed IDs', () => {
      expect(isOllamaModel('ollama:llama3.2:3b')).toBe(true);
      expect(isOllamaModel('ollama:mistral')).toBe(true);
    });

    it('should return false for Gemini model IDs', () => {
      expect(isOllamaModel('gemini-3.1-flash-lite-preview')).toBe(false);
      expect(isOllamaModel('gemma-4-31b-it')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isOllamaModel('')).toBe(false);
    });
  });

  describe('isAnthropicModel', () => {
    it('should return true for anthropic: prefixed IDs', () => {
      expect(isAnthropicModel('anthropic:claude-sonnet-4-20250514')).toBe(true);
    });

    it('should return false for other providers', () => {
      expect(isAnthropicModel('gemini-3.1-flash-lite-preview')).toBe(false);
      expect(isAnthropicModel('openai:gpt-4.1')).toBe(false);
      expect(isAnthropicModel('ollama:llama3')).toBe(false);
    });
  });

  describe('isOpenAIModel', () => {
    it('should return true for openai: prefixed IDs', () => {
      expect(isOpenAIModel('openai:gpt-4.1')).toBe(true);
      expect(isOpenAIModel('openai:o4-mini')).toBe(true);
    });

    it('should return false for other providers', () => {
      expect(isOpenAIModel('gemini-3.1-flash-lite-preview')).toBe(false);
      expect(isOpenAIModel('anthropic:claude-sonnet-4')).toBe(false);
    });
  });

  describe('isCustomOpenAIModel', () => {
    it('should return true for custom-openai: prefixed IDs', () => {
      expect(isCustomOpenAIModel('custom-openai:abc-123')).toBe(true);
    });

    it('should return false for other providers', () => {
      expect(isCustomOpenAIModel('openai:gpt-4.1')).toBe(false);
      expect(isCustomOpenAIModel('ollama:llama3')).toBe(false);
    });
  });

  describe('getProviderForModel', () => {
    it('should detect gemini models (no prefix)', () => {
      expect(getProviderForModel('gemini-3.1-flash-lite-preview')).toBe('gemini');
      expect(getProviderForModel('gemma-4-31b-it')).toBe('gemini');
    });

    it('should detect anthropic models', () => {
      expect(getProviderForModel('anthropic:claude-sonnet-4-20250514')).toBe('anthropic');
    });

    it('should detect openai models', () => {
      expect(getProviderForModel('openai:gpt-4.1')).toBe('openai');
    });

    it('should detect custom-openai models', () => {
      expect(getProviderForModel('custom-openai:abc-123')).toBe('custom-openai');
    });

    it('should detect ollama models', () => {
      expect(getProviderForModel('ollama:llama3.2:3b')).toBe('ollama');
    });

    it('should default to gemini for unknown IDs', () => {
      expect(getProviderForModel('some-unknown-model')).toBe('gemini');
    });
  });

  describe('ollamaModelId / ollamaModelName', () => {
    it('ollamaModelId should prefix name with ollama:', () => {
      expect(ollamaModelId('llama3.2:3b')).toBe('ollama:llama3.2:3b');
    });

    it('ollamaModelName should strip the ollama: prefix', () => {
      expect(ollamaModelName('ollama:llama3.2:3b')).toBe('llama3.2:3b');
    });

    it('round-trips correctly', () => {
      const name = 'mistral:latest';
      expect(ollamaModelName(ollamaModelId(name))).toBe(name);
    });
  });

  describe('anthropicModelName', () => {
    it('should strip the anthropic: prefix', () => {
      expect(anthropicModelName('anthropic:claude-sonnet-4-20250514')).toBe('claude-sonnet-4-20250514');
    });
  });

  describe('openaiModelName', () => {
    it('should strip the openai: prefix', () => {
      expect(openaiModelName('openai:gpt-4.1')).toBe('gpt-4.1');
    });
  });

  describe('customOpenAIConfigId', () => {
    it('should strip the custom-openai: prefix', () => {
      expect(customOpenAIConfigId('custom-openai:abc-123-def')).toBe('abc-123-def');
    });
  });

  describe('fetchOllamaModels', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('marks models as running when they appear in /api/ps', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            models: [
              { name: 'llama3.2:3b', details: { parameter_size: '3B' } },
              { name: 'mistral', details: {} },
            ],
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3.2:3b' }] }),
        } as Response);

      const result = await fetchOllamaModels();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'ollama:llama3.2:3b',
        label: 'llama3.2:3b',
        description: 'Local · 3B',
        provider: 'ollama',
        running: true,
      });
      expect(result[1]).toEqual({
        id: 'ollama:mistral',
        label: 'mistral',
        description: 'Local Ollama model',
        provider: 'ollama',
        running: false,
      });
    });

    it('marks all models as not running when /api/ps returns empty', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'gemma4:latest', details: {} }] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [] }),
        } as Response);

      const result = await fetchOllamaModels();
      expect(result[0].running).toBe(false);
    });

    it('marks all models as not running when /api/ps fails', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'gemma4:latest', details: {} }] }),
        } as Response)
        .mockResolvedValueOnce({ ok: false } as Response);

      const result = await fetchOllamaModels();
      expect(result[0].running).toBe(false);
    });

    it('should return empty array when Ollama is not running (fetch throws)', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Connection refused'));
      const result = await fetchOllamaModels();
      expect(result).toEqual([]);
    });

    it('should return empty array when /api/tags is not ok', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: false } as Response)
        .mockResolvedValueOnce({ ok: false } as Response);
      const result = await fetchOllamaModels();
      expect(result).toEqual([]);
    });

    it('should return empty array when models list is absent', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
      const result = await fetchOllamaModels();
      expect(result).toEqual([]);
    });
  });

  describe('isOllamaAvailable', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should return true when Ollama responds with ok status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
      const result = await isOllamaAvailable();
      expect(result).toBe(true);
    });

    it('should return false when Ollama responds with non-ok status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
      const result = await isOllamaAvailable();
      expect(result).toBe(false);
    });

    it('should return false when fetch throws (connection refused)', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection refused'));
      const result = await isOllamaAvailable();
      expect(result).toBe(false);
    });

    it('should return false when fetch times out', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new DOMException('Signal aborted', 'AbortError'));
      const result = await isOllamaAvailable();
      expect(result).toBe(false);
    });

    it('should use 3 second timeout', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
      await isOllamaAvailable();
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'http://localhost:11434',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });
  });
});
