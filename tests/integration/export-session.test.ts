import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSession,
  appendConversationTurn,
  updateSession,
  saveVFSFile,
} from '@/utils/db';
import { loadSessionExportBundle } from '@/utils/export/load';
import { exportSessionAsJSON, exportSessionAsMarkdown } from '@/utils/export';

describe('loadSessionExportBundle', () => {
  it('loads a full session bundle from IndexedDB', async () => {
    const id = await createSession('Export test');
    await updateSession(id, {
      startUrl: 'https://example.com',
      modelId: 'gemini-3.1-flash-lite',
      status: 'completed',
    });
    await appendConversationTurn(id, 'user', '[Step 1] Task: Do something');
    await appendConversationTurn(id, 'model', 'Working on it.', {
      toolCalls: [{ id: 'tc1', name: 'finish', args: { summary: 'All done.' } }],
    });
    await appendConversationTurn(id, 'tool', 'Task complete: All done.', {
      toolCallId: 'tc1',
      toolName: 'finish',
    });
    await saveVFSFile(id, 'step_1.png', 'aGVsbG8=', 'image/png');

    const bundle = await loadSessionExportBundle(id);
    expect(bundle.session.title).toBe('Export test');
    expect(bundle.startUrl).toBe('https://example.com');
    expect(bundle.modelId).toBe('gemini-3.1-flash-lite');
    expect(bundle.summary).toBe('All done.');
    expect(bundle.turns.length).toBeGreaterThanOrEqual(3);
    expect(bundle.vfsFiles.some((f) => f.name === 'step_1.png')).toBe(true);

    const json = JSON.parse(exportSessionAsJSON(bundle));
    expect(json.session.id).toBe(id);
    expect(json.summary).toBe('All done.');

    const md = exportSessionAsMarkdown(bundle);
    expect(md).toContain('All done.');
    expect(md).toContain('data:image/png;base64,aGVsbG8=');
  });

  it('throws when session does not exist', async () => {
    await expect(loadSessionExportBundle(999_999)).rejects.toThrow('not found');
  });
});

describe('EXPORT_SESSION message handler', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      downloads: {
        download: vi.fn(() => Promise.resolve(1)),
      },
    });
  });

  it('triggerDownload creates a data URL and calls chrome.downloads.download', async () => {
    const { triggerDownload } = await import('@/utils/export/download');
    await triggerDownload('{"ok":true}', 'test.json', 'application/json');
    expect(chrome.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'test.json',
        saveAs: false,
        url: expect.stringMatching(/^data:application\/json;base64,/),
      }),
    );
  });
});
