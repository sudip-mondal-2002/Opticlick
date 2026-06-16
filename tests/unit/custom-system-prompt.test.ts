/**
 * Unit tests for the Custom System Prompt feature.
 *
 * Covers:
 *   - Storage helpers (getCustomSystemPrompt, setCustomSystemPrompt, isCustomPromptEffective)
 *   - Prompt assembly logic (buildSystemMessage) — prepend, append, disabled, empty
 *   - Security rails invariant: always at the very end
 *   - Edge cases: whitespace-only content, corrupt storage values
 *
 * Note: buildSystemMessage is tested by directly invoking the assembly logic
 * using the exported CORE_INSTRUCTIONS / SECURITY_INSTRUCTIONS constants and
 * the storage helpers, mirroring the implementation without importing llm.ts
 * (which carries heavy model-provider dependencies not relevant to this unit).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCustomSystemPrompt,
  setCustomSystemPrompt,
  isCustomPromptEffective,
  type CustomSystemPrompt,
} from '../../src/utils/custom-system-prompt';
import { CORE_INSTRUCTIONS, SECURITY_INSTRUCTIONS } from '../../src/utils/system-prompt';

// ── Mock chrome.storage.local ─────────────────────────────────────────────────

let fakeStore: Record<string, unknown> = {};

const chromeMock = {
  storage: {
    local: {
      get: vi.fn((key: string) => Promise.resolve({ [key]: fakeStore[key] })),
      set: vi.fn((data: Record<string, unknown>) => {
        Object.assign(fakeStore, data);
        return Promise.resolve();
      }),
    },
  },
};

// Override the global chrome that the chrome-mocks setup installed
beforeEach(() => {
  fakeStore = {};
  vi.clearAllMocks();
  const g = globalThis as Record<string, unknown>;
  g.chrome = { ...((g.chrome as object) ?? {}), storage: chromeMock.storage };
  // Re-wire mocks after clearAllMocks
  chromeMock.storage.local.get.mockImplementation((key: string) =>
    Promise.resolve({ [key]: fakeStore[key] }),
  );
  chromeMock.storage.local.set.mockImplementation((data: Record<string, unknown>) => {
    Object.assign(fakeStore, data);
    return Promise.resolve();
  });
});

// ── Inline assembly helper (mirrors buildSystemMessage logic) ─────────────────

async function assembleSystemMessage(): Promise<string> {
  const custom = await getCustomSystemPrompt();
  const effective = custom.enabled && custom.content.trim().length > 0;
  if (!effective) return CORE_INSTRUCTIONS + SECURITY_INSTRUCTIONS;
  const separator = '\n\n---\n\n';
  const userBlock = `Additional instructions from user:\n\n${custom.content.trim()}`;
  if (custom.insertPosition === 'prepend') {
    return userBlock + separator + CORE_INSTRUCTIONS + SECURITY_INSTRUCTIONS;
  }
  return CORE_INSTRUCTIONS + separator + userBlock + separator + SECURITY_INSTRUCTIONS;
}

// ── getCustomSystemPrompt ─────────────────────────────────────────────────────

describe('getCustomSystemPrompt', () => {
  it('returns safe defaults when nothing is stored', async () => {
    const result = await getCustomSystemPrompt();
    expect(result.enabled).toBe(false);
    expect(result.content).toBe('');
    expect(result.insertPosition).toBe('prepend');
  });

  it('returns stored values when they exist', async () => {
    const saved: CustomSystemPrompt = { enabled: true, content: 'Be concise.', insertPosition: 'append' };
    fakeStore['customSystemPrompt'] = saved;
    const result = await getCustomSystemPrompt();
    expect(result).toEqual(saved);
  });

  it('defaults insertPosition to prepend for unknown/invalid values', async () => {
    fakeStore['customSystemPrompt'] = { enabled: true, content: 'x', insertPosition: 'invalid_value' };
    const result = await getCustomSystemPrompt();
    expect(result.insertPosition).toBe('prepend');
  });

  it('returns defaults when stored value is null', async () => {
    fakeStore['customSystemPrompt'] = null;
    const result = await getCustomSystemPrompt();
    expect(result.enabled).toBe(false);
    expect(result.content).toBe('');
  });

  it('returns defaults when stored value is a non-object primitive', async () => {
    fakeStore['customSystemPrompt'] = 42;
    const result = await getCustomSystemPrompt();
    expect(result.enabled).toBe(false);
  });

  it('coerces enabled to boolean', async () => {
    fakeStore['customSystemPrompt'] = { enabled: 1, content: 'hi', insertPosition: 'prepend' };
    const result = await getCustomSystemPrompt();
    expect(result.enabled).toBe(true);
  });
});

// ── setCustomSystemPrompt ─────────────────────────────────────────────────────

describe('setCustomSystemPrompt', () => {
  it('persists the config to storage', async () => {
    const config: CustomSystemPrompt = { enabled: true, content: 'Test instructions.', insertPosition: 'prepend' };
    await setCustomSystemPrompt(config);
    expect(fakeStore['customSystemPrompt']).toEqual(config);
  });

  it('saved config can be round-tripped through getCustomSystemPrompt', async () => {
    const config: CustomSystemPrompt = { enabled: false, content: 'Saved but off.', insertPosition: 'append' };
    await setCustomSystemPrompt(config);
    const retrieved = await getCustomSystemPrompt();
    expect(retrieved).toEqual(config);
  });

  it('saving disabled state preserves the content', async () => {
    await setCustomSystemPrompt({ enabled: false, content: 'My rules.', insertPosition: 'prepend' });
    const retrieved = await getCustomSystemPrompt();
    expect(retrieved.content).toBe('My rules.');
    expect(retrieved.enabled).toBe(false);
  });
});

// ── isCustomPromptEffective ───────────────────────────────────────────────────

describe('isCustomPromptEffective', () => {
  it('returns true when enabled and content is non-empty', () => {
    expect(isCustomPromptEffective({ enabled: true, content: 'Hello', insertPosition: 'prepend' })).toBe(true);
  });

  it('returns false when disabled even if content exists', () => {
    expect(isCustomPromptEffective({ enabled: false, content: 'Hello', insertPosition: 'prepend' })).toBe(false);
  });

  it('returns false when enabled but content is empty string', () => {
    expect(isCustomPromptEffective({ enabled: true, content: '', insertPosition: 'prepend' })).toBe(false);
  });

  it('returns false when enabled but content is whitespace-only', () => {
    expect(isCustomPromptEffective({ enabled: true, content: '   \n\t  ', insertPosition: 'prepend' })).toBe(false);
  });

  it('returns true regardless of insertPosition when enabled and non-empty', () => {
    expect(isCustomPromptEffective({ enabled: true, content: 'x', insertPosition: 'append' })).toBe(true);
  });
});

// ── System prompt assembly logic ──────────────────────────────────────────────

describe('assembleSystemMessage (prompt assembly logic)', () => {
  it('returns built-in prompt when no custom instructions are stored', async () => {
    const result = await assembleSystemMessage();
    expect(result).toBe(CORE_INSTRUCTIONS + SECURITY_INSTRUCTIONS);
  });

  it('returns built-in prompt when custom instructions are disabled', async () => {
    await setCustomSystemPrompt({ enabled: false, content: 'Ignored.', insertPosition: 'prepend' });
    const result = await assembleSystemMessage();
    expect(result).toBe(CORE_INSTRUCTIONS + SECURITY_INSTRUCTIONS);
  });

  it('returns built-in prompt when content is whitespace-only', async () => {
    await setCustomSystemPrompt({ enabled: true, content: '   \n  ', insertPosition: 'prepend' });
    const result = await assembleSystemMessage();
    expect(result).toBe(CORE_INSTRUCTIONS + SECURITY_INSTRUCTIONS);
  });

  it('prepend: user block appears before CORE_INSTRUCTIONS', async () => {
    await setCustomSystemPrompt({ enabled: true, content: 'Only use GitHub.', insertPosition: 'prepend' });
    const result = await assembleSystemMessage();
    const customIdx = result.indexOf('Only use GitHub.');
    const coreIdx = result.indexOf(CORE_INSTRUCTIONS.trim().slice(0, 30));
    expect(customIdx).toBeGreaterThanOrEqual(0);
    expect(customIdx).toBeLessThan(coreIdx);
  });

  it('append: user block appears after CORE_INSTRUCTIONS but before SECURITY_INSTRUCTIONS', async () => {
    await setCustomSystemPrompt({ enabled: true, content: 'Use Python 3.12.', insertPosition: 'append' });
    const result = await assembleSystemMessage();
    const customIdx = result.indexOf('Use Python 3.12.');
    const coreEnd = result.indexOf(CORE_INSTRUCTIONS.trim().slice(-30));
    const securityIdx = result.indexOf(SECURITY_INSTRUCTIONS.trim().slice(0, 30));
    expect(coreEnd).toBeLessThan(customIdx);
    expect(customIdx).toBeLessThan(securityIdx);
  });

  it('security instructions are ALWAYS at the end for both positions', async () => {
    const lastChunk = SECURITY_INSTRUCTIONS.trim().slice(-80);
    for (const insertPosition of ['prepend', 'append'] as const) {
      await setCustomSystemPrompt({ enabled: true, content: 'Custom.', insertPosition });
      const result = await assembleSystemMessage();
      const idx = result.lastIndexOf(lastChunk);
      const afterSecurity = result.slice(idx + lastChunk.length).trim();
      expect(afterSecurity).toBe('');
    }
  });

  it('trims surrounding whitespace from custom content', async () => {
    await setCustomSystemPrompt({ enabled: true, content: '  My rules.  \n', insertPosition: 'prepend' });
    const result = await assembleSystemMessage();
    expect(result).toContain('My rules.');
    expect(result).not.toContain('  My rules.  ');
  });

  it('assembled output contains all three sections', async () => {
    const customText = 'You only navigate to internal.company.com.';
    await setCustomSystemPrompt({ enabled: true, content: customText, insertPosition: 'append' });
    const result = await assembleSystemMessage();
    expect(result).toContain(customText);
    expect(result).toContain(CORE_INSTRUCTIONS.slice(0, 50));
    expect(result).toContain(SECURITY_INSTRUCTIONS.slice(0, 50));
  });
});
