/**
 * Scratchpad tools — in-session note-taking for intermediate findings.
 *
 * note_write  — write/update a scratchpad entry
 * note_delete — remove a scratchpad entry
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const noteWriteTool = tool(
  async () => 'ok',
  {
    name: 'note_write',
    description:
      'Write or update a note in the in-session scratchpad. Use this to accumulate ' +
      'intermediate findings across multiple turns — e.g. items discovered while scrolling, ' +
      'data extracted from multiple pages, running totals, or partial results. ' +
      'The scratchpad is shown in every subsequent prompt so you will not lose track of ' +
      'what you have already gathered. ' +
      'Use descriptive keys like "issues_found", "search_results", "extracted_emails". ' +
      'The scratchpad is cleared at session end — use memory_upsert for facts to keep across sessions.',
    schema: z.object({
      key: z
        .string()
        .describe(
          'Short descriptive key for this note, e.g. "issues_found", "emails_collected". ' +
          'Use lowercase with underscores.',
        ),
      value: z
        .string()
        .describe(
          'The note content — can be a list, a count, a JSON snippet, or free text. ' +
          'When building a list across multiple scrolls, include ALL items found so far, ' +
          'not just the new ones.',
        ),
    }),
  },
);

export const noteDeleteTool = tool(
  async () => 'ok',
  {
    name: 'note_delete',
    description:
      'Remove a note from the scratchpad by its key. Use when a note is no longer ' +
      'relevant or has been superseded by the final result.',
    schema: z.object({
      key: z
        .string()
        .describe('The key of the note to delete, e.g. "issues_found".'),
    }),
  },
);

export const SCRATCHPAD_TOOLS = [noteWriteTool, noteDeleteTool] as const;
