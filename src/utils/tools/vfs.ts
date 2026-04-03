/**
 * Virtual Filesystem (VFS) tools — any combination may be used per turn,
 * and all execute BEFORE the UI action.
 *
 * vfs_save_screenshot — persist the current step screenshot under a filename
 * vfs_write           — create or overwrite a text file
 * vfs_delete          — remove a file by UUID
 * vfs_download        — fetch a remote URL directly into VFS
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const vfsSaveScreenshotTool = tool(
  async () => 'ok',
  {
    name: 'vfs_save_screenshot',
    description:
      'Persist the current step screenshot to the VFS under a descriptive filename. ' +
      'Use at key moments (e.g. after login, before submitting a form) so the image can be ' +
      'referenced or uploaded later.',
    schema: z.object({
      name: z.string().describe('Filename to save as, e.g. "login_page.png"'),
    }),
  },
);

export const vfsWriteTool = tool(
  async () => 'ok',
  {
    name: 'vfs_write',
    description:
      'Create or overwrite a text file in the VFS. ' +
      'Use to store scraped data, notes, JSON payloads, CSV tables, or HTML snippets.',
    schema: z.object({
      name: z.string().describe('Filename including extension, e.g. "results.json"'),
      content: z.string().describe('Full UTF-8 text content to write'),
      mimeType: z
        .string()
        .optional()
        .describe('MIME type of the file (defaults to text/plain)'),
    }),
  },
);

export const vfsDeleteTool = tool(
  async () => 'ok',
  {
    name: 'vfs_delete',
    description: 'Delete a file from the VFS by its UUID.',
    schema: z.object({
      fileId: z.string().describe('VFS file UUID to delete'),
    }),
  },
);

export const vfsDownloadTool = tool(
  async () => 'ok',
  {
    name: 'vfs_download',
    description:
      'Fetch a remote URL directly into the VFS — no browser dialog, no size limit. ' +
      'Use for PDFs, images, CSVs, ZIPs, or any remote file. ' +
      'If unsure of the exact URL, call fetch_dom first to read the href, then download.',
    schema: z.object({
      url: z.string().describe('Full HTTP/HTTPS URL to download'),
      name: z.string().optional().describe('Optional filename override'),
    }),
  },
);

export const VFS_TOOLS = [
  vfsSaveScreenshotTool,
  vfsWriteTool,
  vfsDeleteTool,
  vfsDownloadTool,
] as const;
