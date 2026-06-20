/**
 * Storage utility for the Custom System Prompt feature.
 *
 * Persists user-defined agent instructions in chrome.storage.local under
 * the key `customSystemPrompt`. The built-in SECURITY_INSTRUCTIONS are
 * always appended last, regardless of insertPosition, so they can never
 * be overridden.
 */

export interface CustomSystemPrompt {
  /** Whether custom instructions are active. Saving the toggle off preserves content. */
  enabled: boolean;
  /** Raw user-authored instruction text. Max 4000 characters. */
  content: string;
  /** Where to inject relative to the agent's CORE_INSTRUCTIONS. */
  insertPosition: 'prepend' | 'append';
}

const STORAGE_KEY = 'customSystemPrompt';

const DEFAULT: CustomSystemPrompt = {
  enabled: false,
  content: '',
  insertPosition: 'prepend',
};

/** Load the saved custom prompt config from chrome.storage.local. */
export async function getCustomSystemPrompt(): Promise<CustomSystemPrompt> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    if (!stored || typeof stored !== 'object') return DEFAULT;
    return {
      enabled: Boolean(stored.enabled),
      content: typeof stored.content === 'string' ? stored.content : '',
      insertPosition: stored.insertPosition === 'append' ? 'append' : 'prepend',
    };
  } catch {
    return DEFAULT;
  }
}

/** Persist a custom prompt config to chrome.storage.local. */
export async function setCustomSystemPrompt(config: CustomSystemPrompt): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}

/** True if the content is non-empty after trimming. */
export function isCustomPromptEffective(config: CustomSystemPrompt): boolean {
  return config.enabled && config.content.trim().length > 0;
}
