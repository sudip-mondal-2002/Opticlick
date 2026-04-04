import { describe, it, expect } from 'vitest';
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  getModelLabel,
  getModelDescription,
} from '@/utils/models';

describe('models utilities', () => {
  describe('AVAILABLE_MODELS', () => {
    it('should contain 4 models', () => {
      expect(AVAILABLE_MODELS).toHaveLength(4);
    });

    it('should have required properties for each model', () => {
      for (const model of AVAILABLE_MODELS) {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('label');
        expect(model).toHaveProperty('description');
        expect(typeof model.id).toBe('string');
        expect(typeof model.label).toBe('string');
        expect(typeof model.description).toBe('string');
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
    it('should return the label for a valid model ID', () => {
      expect(getModelLabel('gemini-3.1-flash-lite-preview')).toBe('Gemini 3.1 Flash Lite');
      expect(getModelLabel('gemini-2.5-flash')).toBe('Gemini 2.5 Flash');
      expect(getModelLabel('gemini-4-31b')).toBe('Gemma 4 31B');
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
  });

  describe('getModelDescription', () => {
    it('should return the description for a valid model ID', () => {
      const flashLiteDesc = getModelDescription('gemini-3.1-flash-lite-preview');
      expect(flashLiteDesc).toContain('Fast');

      const flash25Desc = getModelDescription('gemini-2.5-flash');
      expect(flash25Desc).toContain('Balanced');
    });

    it('should return empty string if model not found', () => {
      expect(getModelDescription('unknown-model-id')).toBe('');
    });

    it('should handle all available models', () => {
      for (const model of AVAILABLE_MODELS) {
        expect(getModelDescription(model.id)).toBe(model.description);
      }
    });
  });
});
