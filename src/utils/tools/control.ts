/**
 * Agent control tools.
 *
 * finish — declare the task fully accomplished
 * wait   — pause execution for a specified duration
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const finishTool = tool(
  async () => 'ok',
  {
    name: 'finish',
    description:
      "Mark the task as fully accomplished. " +
      "Call only when the user's goal is completely achieved. " +
      "You may combine this with VFS/todo tools in the same turn (e.g. write final results then finish).",
    schema: z.object({
      summary: z
        .string()
        .describe(
          'Complete, detailed answer to the user\'s original task. ' +
          'This is the final response the user will see — be thorough and specific. ' +
          'Include all findings, data discovered, actions taken, URLs visited, and any relevant results. ' +
          'Do NOT just say "task complete" — give the actual answer or outcome.',
        ),
    }),
  },
);

export const waitTool = tool(
  async () => 'ok',
  {
    name: 'wait',
    description:
      'Pause execution for a specified number of milliseconds before taking the next action. ' +
      'Use when a page needs time to load after an interaction, an animation must finish, ' +
      'a background request is in-flight, or a dynamic UI element is still rendering. ' +
      'Prefer short waits (500–2000 ms); only use longer waits when you have strong reason to.',
    schema: z.object({
      ms: z
        .number()
        .int()
        .min(100)
        .max(10_000)
        .describe('Milliseconds to wait before the next action (100–10 000)'),
    }),
  },
);

export const askUserTool = tool(
  async () => 'ok',
  {
    name: 'ask_user',
    description:
      'Pause the task and ask the user a clarification question before continuing. ' +
      'Use when the goal is ambiguous, critical information is missing, or a decision ' +
      'requires human judgement (e.g. which account to use, whether to confirm a destructive action). ' +
      'The agent will resume automatically once the user replies. ' +
      'Do NOT use for progress updates — only ask when you genuinely cannot proceed without the answer.',
    schema: z.object({
      question: z
        .string()
        .describe(
          'The specific question to ask the user. Be concise and clear — one question at a time.',
        ),
    }),
  },
);

export const CONTROL_TOOLS = [finishTool, waitTool, askUserTool] as const;
