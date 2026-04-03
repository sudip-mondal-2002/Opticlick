/**
 * DOM inspection tool.
 *
 * fetch_dom — ask the extension for the full outer HTML of an annotated element.
 *             The HTML is injected into the conversation for the next step.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const fetchDOMTool = tool(
  async () => 'ok',
  {
    name: 'fetch_dom',
    description:
      'Request the full outer HTML of an annotated element. ' +
      'The HTML is injected into context for the next step — nothing is stored in VFS. ' +
      'Use when the screenshot lacks detail: link hrefs, table data, hidden attributes, clipped text.',
    schema: z.object({
      targetId: z.number().int().describe('Numeric ID of the element whose HTML to fetch'),
    }),
  },
);

export const DOM_TOOLS = [fetchDOMTool] as const;
