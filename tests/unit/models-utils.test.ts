import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  getModelLabel,
  getModelDescription,
  isOllamaModel,
  ollamaModelId,
  ollamaModelName,
  fetchOllamaModels,
} from '@/utils/models';

describe('models utilities', () => {
  describe('AVAILABLE_MODELS', () => {
    it('should contain 2 models', () => {
      expect(AVAILABLE_MODELS).toHaveLength(2);
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
        expect(model.provider).toBe('gemini');
      }
    });

    it('should have unique model IDs', () => {
      const ids = AVAILABLE_MODELS.map((m) => m.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('DEFAULT_MODEL', () => {
    it('should be set to the first model ID', () => {
      expect(DEFAULT_MODEL).toBe(AVAILABLE_MODELS[0].id);
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
  });

  describe('getModelDescription', () => {
    it('should return the description for a valid model ID', () => {
      const flashLiteDesc = getModelDescription('gemini-3.1-flash-lite-preview');
      expect(flashLiteDesc).toContain('Fast');
    });

    it('should return empty string if model not found', () => {
      expect(getModelDescription('unknown-model-id')).toBe('');
    });

    it('should handle all available models', () => {
      for (const model of AVAILABLE_MODELS) {
        expect(getModelDescription(model.id)).toBe(model.description);
      }
    });

    it('should resolve Ollama model descriptions from the provided list', () => {
      const ollama = [{ id: 'ollama:llama3.2:3b', label: 'llama3.2:3b', description: 'Local · 3B', provider: 'ollama' as const }];
      expect(getModelDescription('ollama:llama3.2:3b', ollama)).toBe('Local · 3B');
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
});
