/**
 * Memory management tools — persist cross-session facts about the user.
 *
 * memory_upsert — save or merge a memory entry
 * memory_delete — remove a memory entry
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const memoryUpsertTool = tool(
  async () => 'ok',
  {
    name: 'memory_upsert',
    description:
      'Save or update a fact in long-term memory. Call when you discover useful information ' +
      'about the user that should persist across sessions — accounts, preferences, display names, ' +
      'organizations, timezones, etc. If the key already exists, new values are merged with ' +
      'existing ones (duplicates are removed). ' +
      'Use descriptive namespaced keys like "github/username", "google/email", "twitter/handle". ' +
      'Do NOT store passwords, tokens, or API keys.',
    schema: z.object({
      key: z
        .string()
        .describe(
          'Namespaced identifier for this memory, e.g. "github/username", "locale/timezone". ' +
          'Use lowercase with forward-slash separators.',
        ),
      values: z
        .array(z.string())
        .describe(
          'One or more values to store. For multi-account scenarios, each account is a separate value.',
        ),
      category: z
        .enum(['account', 'preference', 'fact', 'other'])
        .describe(
          'Broad category: "account" for usernames/emails, "preference" for user settings, ' +
          '"fact" for general info, "other" for anything else.',
        ),
      sourceUrl: z
        .string()
        .optional()
        .describe('The URL where this information was discovered.'),
    }),
  },
);

export const memoryDeleteTool = tool(
  async () => 'ok',
  {
    name: 'memory_delete',
    description:
      'Remove a fact from long-term memory by its key. Use when information is known to be ' +
      'outdated, incorrect, or the user explicitly asks to forget something.',
    schema: z.object({
      key: z
        .string()
        .describe('The key of the memory entry to delete, e.g. "github/username".'),
    }),
  },
);

export const MEMORY_TOOLS = [memoryUpsertTool, memoryDeleteTool] as const;
