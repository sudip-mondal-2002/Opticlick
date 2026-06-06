import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectFileUpload } from '@/utils/file-upload';
import { createSession, saveVFSFile, listVFSFiles } from '@/utils/db';
import { getMockDebugger } from '../setup/chrome-mocks';
import { writeTempFile, cleanupTempFile } from '@/utils/cdp';
import type { CoordinateEntry } from '@/utils/types';

vi.mock('@/utils/cdp', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/utils/cdp')>();
  return {
    ...original,
    attachDebugger: vi.fn().mockResolvedValue(undefined),
    detachDebugger: vi.fn().mockResolvedValue(undefined),
    writeTempFile: vi.fn().mockResolvedValue({ downloadId: 100, filePath: '/mock/Downloads/_opticlick_tmp/test.txt' }),
    cleanupTempFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe('injectFileUpload', () => {
  let sessionId: number;
  const target: CoordinateEntry = {
    id: 1,
    tag: 'input',
    text: 'Choose file',
    rect: { x: 100, y: 200, left: 100, top: 200, width: 50, height: 20 },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionId = await createSession('Upload Test');
  });

  it('throws error when file is not found in VFS', async () => {
    await expect(
      injectFileUpload(1, sessionId, 'nonexistent-id', target)
    ).rejects.toThrow('VFS file "nonexistent-id" not found.');
  });

  it('triggers drag-drop evaluation and resolves when input is already populated (no CDP fallback needed)', async () => {
    // Seed VFS file
    await saveVFSFile(sessionId, 'hello.txt', btoa('hello world'), 'text/plain');
    const files = await listVFSFiles(sessionId);
    const fileId = files[0].id;

    const dbg = getMockDebugger();
    dbg.sendCommand.mockImplementation(async (targetInfo, method, params) => {
      if (method === 'Runtime.evaluate') {
        const expression = (params as any).expression ?? '';
        if (expression.includes('window.__opticlick_fileInput')) {
          // Mock input.files.length > 0 (already populated by drag-drop in this test case, so return null)
          return { result: { subtype: 'null', value: null } };
        }
      }
      return {};
    });

    await injectFileUpload(1, sessionId, fileId, target);

    // Verify it called Runtime.evaluate for drag-drop
    const evaluateCalls = dbg.sendCommand.mock.calls.filter(c => c[1] === 'Runtime.evaluate');
    expect(evaluateCalls.length).toBeGreaterThanOrEqual(2);

    // Verify it did NOT call DOM.setFileInputFiles because input was already populated
    expect(dbg.sendCommand).not.toHaveBeenCalledWith(
      expect.any(Object),
      'DOM.setFileInputFiles',
      expect.any(Object)
    );
  });

  it('triggers drag-drop AND falls back to CDP DOM.setFileInputFiles when input is empty', async () => {
    await saveVFSFile(sessionId, 'hello.txt', btoa('hello world'), 'text/plain');
    const files = await listVFSFiles(sessionId);
    const fileId = files[0].id;

    const dbg = getMockDebugger();
    dbg.sendCommand.mockImplementation(async (targetInfo, method, params) => {
      if (method === 'Runtime.evaluate') {
        const expression = (params as any).expression ?? '';
        if (expression.includes('window.__opticlick_fileInput')) {
          // Mock input.files.length === 0 (empty, triggering fallback)
          return { result: { objectId: 'input-obj-456', subtype: 'node' } };
        }
      }
      return {};
    });

    await injectFileUpload(1, sessionId, fileId, target);

    // Verify it wrote temp file and called DOM.setFileInputFiles
    expect(writeTempFile).toHaveBeenCalledOnce();
    expect(dbg.sendCommand).toHaveBeenCalledWith(
      { tabId: 1 },
      'DOM.setFileInputFiles',
      { objectId: 'input-obj-456', files: ['/mock/Downloads/_opticlick_tmp/test.txt'] }
    );
    expect(cleanupTempFile).toHaveBeenCalledWith(100);
  });

  it('resolves the file by name when uploadFileId is the filename instead of fileId', async () => {
    await saveVFSFile(sessionId, 'named-file.txt', btoa('hello world'), 'text/plain');
    const dbg = getMockDebugger();
    dbg.sendCommand.mockResolvedValue({ result: { subtype: 'null', value: null } });

    await injectFileUpload(1, sessionId, 'named-file.txt', target);

    const evaluateCalls = dbg.sendCommand.mock.calls.filter(c => c[1] === 'Runtime.evaluate');
    expect(evaluateCalls.length).toBeGreaterThanOrEqual(2);
  });
});
