/**
 * Todo list management tools — execute BEFORE the UI action.
 *
 * todo_create — establish (or fully replace) the session plan
 * todo_update — apply partial status/notes updates to existing items
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const todoCreateTool = tool(
  async () => 'ok',
  {
    name: 'todo_create',
    description:
      'Create (or fully replace) the session todo list. ' +
      'MUST be called on step 1 when no list exists. ' +
      'Break the goal into ordered sub-tasks with short kebab-case IDs. ' +
      'Set the first task to in_progress, all others to pending.',
    schema: z.object({
      items: z
        .array(
          z.object({
            id: z.string().describe('Short kebab-case ID, e.g. "navigate-to-login"'),
            title: z.string().describe('Human-readable task title'),
            status: z
              .enum(['pending', 'in_progress'])
              .describe('Set first task to in_progress, rest to pending'),
            notes: z.string().optional().describe('Optional initial note'),
          }),
        )
        .describe('Ordered list of tasks'),
    }),
  },
);

export const todoUpdateTool = tool(
  async () => 'ok',
  {
    name: 'todo_update',
    description:
      'Apply partial updates to existing todo items. ' +
      'Call every turn: mark the just-completed item done, the next item in_progress, ' +
      'and attach observations as notes.',
    schema: z.object({
      updates: z.array(
        z.object({
          id: z.string().describe('ID of the item to update'),
          status: z.enum(['in_progress', 'done', 'skipped']).optional(),
          notes: z.string().optional().describe('Observation or note to attach'),
        }),
      ),
    }),
  },
);

export const TODO_TOOLS = [todoCreateTool, todoUpdateTool] as const;
