/**
 * Browser tab management tools.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const openTabTool = tool(
  async () => 'ok',
  {
    name: 'open_tab',
    description:
      'Open a URL in a new browser tab and switch focus to it.',
    schema: z.object({
      url: z
        .string()
        .url()
        .describe('The URL to open in a new browser tab'),
    }),
  },
);

export const switchTabTool = tool(
  async () => 'ok',
  {
    name: 'switch_tab',
    description:
      'Switch focus to an existing browser tab by index. After switching, the task is complete unless the user requested additional actions.',
    schema: z.object({
      tabIndex: z
        .number()
        .int()
        .min(0)
        .describe('Zero-based tab index returned by list_tabs'),
    }),
  },
);

export const closeTabTool = tool(
  async () => 'ok',
  {
    name: 'close_tab',
    description:
        'Close the currently active browser tab exactly once. ' +
        'After the tab is closed, the task is complete. ' +
        'Do not call close_tab again. ' +
        'Do not verify by closing additional tabs.',
    schema: z.object({}),
  },
);

export const listTabsTool = tool(
  async () => 'ok',
  {
    name: 'list_tabs',
    description:
      'Returns all open browser tabs. Use once to gather tab information. After receiving the tab list, report the result to the user and call finish. Do not call list_tabs repeatedly unless the user explicitly asks for a refresh.',
    schema: z.object({}),
  },
);

export const TAB_TOOLS = [
  openTabTool,
  switchTabTool,
  closeTabTool,
  listTabsTool,
] as const;