/**
 * UI interaction tools — at most one may be called per agent turn.
 *
 * click     — hardware-level click, optionally followed by type + key press
 * navigate  — load a full URL in the current tab
 * scroll    — wheel-scroll the page or a specific element
 * press_key — dispatch a raw key event with no prior click
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const clickTool = tool(
  async () => 'ok',
  {
    name: 'click',
    description:
      'Click an annotated element by its numeric ID. ' +
      'Optionally type text into the focused element afterward, then optionally press a key. ' +
      'For file inputs, set uploadFileId to a VFS file ID or filename to inject the file ' +
      'programmatically instead of opening an OS dialog.',
    schema: z.object({
      targetId: z.number().int().min(1).describe('Numeric ID from the annotated screenshot'),
      modifier: z
        .enum(['ctrl', 'meta', 'shift', 'alt'])
        .optional()
        .describe(
          'Modifier key held during the click. ' +
          'Use "ctrl" for Ctrl+Click (open link in new tab, multi-select) — works on all platforms. ' +
          'Use "meta" for Cmd+Click on macOS (same effect as ctrl on Mac) or Win+Click on Windows. ' +
          'Use "shift" to extend a selection. ' +
          'Omit for a plain click.',
        ),
      clearField: z
        .boolean()
        .optional()
        .describe(
          'Set to true to select all existing text in the field (Ctrl+A) before typing, ' +
          'so the new text REPLACES the current value instead of appending to it. ' +
          'Always use this when typing into a search box, input, or textarea that may already have content.',
        ),
      typeText: z.string().optional().describe('Text to type into the element after clicking. WARNING: this APPENDS to existing field content — set clearField:true to replace it.'),
      pressKey: z
        .string()
        .optional()
        .describe('Key to press after click+type, e.g. "Enter" to submit a form, "Tab" to advance focus'),
      uploadFileId: z
        .string()
        .optional()
        .describe('VFS file ID or filename to inject into this file input (skips OS dialog)'),
    }),
  },
);

export const navigateTool = tool(
  async () => 'ok',
  {
    name: 'navigate',
    description:
      'Navigate the browser to a full URL. ' +
      'Prefer this over guessing form submissions when the target URL is known. ' +
      'Also use this to recover when the current page is wrong.',
    schema: z.object({
      url: z.string().describe('Full HTTP/HTTPS URL to navigate to'),
    }),
  },
);

export const scrollTool = tool(
  async () => 'ok',
  {
    name: 'scroll',
    description:
      'Scroll the page or a specific annotated element in a direction. ' +
      'Use scrollTargetId when content overflows inside a container (e.g. a list or modal).',
    schema: z.object({
      direction: z.enum(['up', 'down', 'left', 'right']).describe('Direction to scroll'),
      scrollTargetId: z
        .number()
        .int()
        .optional()
        .describe('If set, scroll inside this annotated element instead of the whole page'),
    }),
  },
);

export const pressKeyTool = tool(
  async () => 'ok',
  {
    name: 'press_key',
    description:
      'Press a keyboard key without clicking an element first. ' +
      'Examples: Escape to close a dialog, ArrowDown to move focus, Tab to advance fields.',
    schema: z.object({
      key: z.string().describe('Key name, e.g. "Enter", "Escape", "Tab", "ArrowDown"'),
    }),
  },
);

export const UI_TOOLS = [clickTool, navigateTool, scrollTool, pressKeyTool] as const;
