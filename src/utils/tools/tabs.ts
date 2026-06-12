import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const openTabTool = tool(
  async () => 'ok',
  {
    name: 'open_tab',
    description: 'Open a URL in a new browser tab and switch focus to it.',
    schema: z.object({
      url: z.string().url(),
    }),
  },
);

export const switchTabTool = tool(
  async () => 'ok',
  {
    name: 'switch_tab',
    description: 'Switch to an existing tab by index.',
    schema: z.object({
      tabIndex: z.number().int().min(0),
    }),
  },
);

export const closeTabTool = tool(
  async () => 'ok',
  {
    name: 'close_tab',
    description: 'Close the current tab.',
    schema: z.object({}),
  },
);

export const listTabsTool = tool(
  async () => 'ok',
  {
    name: 'list_tabs',
    description: 'List all open tabs.',
    schema: z.object({}),
  },
);

export const TAB_TOOLS = [
  openTabTool,
  switchTabTool,
  closeTabTool,
  listTabsTool,
] as const;