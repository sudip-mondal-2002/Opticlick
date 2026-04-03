import { describe, it, expect, beforeEach } from 'vitest';
import { setFileInputFiles, _resetAttachedDebuggers } from '@/utils/cdp';
import { getMockDebugger } from '../setup/chrome-mocks';

beforeEach(() => {
  _resetAttachedDebuggers();
});

describe('setFileInputFiles', () => {
  it('calls attachDebugger (chrome.debugger.attach) before proceeding', async () => {
    getMockDebugger().sendCommand.mockImplementation(
      (_target: unknown, method: string) => {
        if (method === 'Runtime.evaluate') return { result: { objectId: 'obj1' } };
        return {};
      },
    );
    await setFileInputFiles(1, ['/tmp/file.txt']);
    expect(getMockDebugger().attach).toHaveBeenCalledWith({ tabId: 1 }, '1.3');
  });

  it('evaluates exactly document.querySelector for a single file input', async () => {
    getMockDebugger().sendCommand.mockImplementation(
      (_target: unknown, method: string) => {
        if (method === 'Runtime.evaluate') return { result: { objectId: 'obj2' } };
        return {};
      },
    );
    await setFileInputFiles(2, ['/tmp/a.jpg']);
    const evaluateCalls = getMockDebugger().sendCommand.mock.calls.filter(
      (c: unknown[]) => c[1] === 'Runtime.evaluate',
    );
    expect(evaluateCalls).toHaveLength(1);
    const evalArgs = evaluateCalls[0][2] as { expression: string };
    // Must use querySelector (not querySelectorAll) so CDP gets a single objectId
    expect(evalArgs.expression).toBe(`document.querySelector('input[type="file"]')`);
  });

  it('does NOT call DOM.setFileInputFiles when no input is found', async () => {
    getMockDebugger().sendCommand.mockImplementation(
      (_target: unknown, method: string) => {
        if (method === 'Runtime.evaluate') return { result: {} };
        return {};
      },
    );
    await setFileInputFiles(7, ['/tmp/f.txt']).catch(() => {});
    const setFileCalls = getMockDebugger().sendCommand.mock.calls.filter(
      (c: unknown[]) => c[1] === 'DOM.setFileInputFiles',
    );
    expect(setFileCalls).toHaveLength(0);
  });

  it('calls DOM.setFileInputFiles with the objectId and filePaths', async () => {
    getMockDebugger().sendCommand.mockImplementation(
      (_target: unknown, method: string) => {
        if (method === 'Runtime.evaluate') return { result: { objectId: 'obj3' } };
        return {};
      },
    );
    await setFileInputFiles(3, ['/tmp/upload.pdf', '/tmp/second.pdf']);
    const setFileCalls = getMockDebugger().sendCommand.mock.calls.filter(
      (c: unknown[]) => c[1] === 'DOM.setFileInputFiles',
    );
    expect(setFileCalls).toHaveLength(1);
    const setArgs = setFileCalls[0][2] as { objectId: string; files: string[] };
    expect(setArgs.objectId).toBe('obj3');
    expect(setArgs.files).toEqual(['/tmp/upload.pdf', '/tmp/second.pdf']);
  });

  it('throws when objectId is absent (no file input found)', async () => {
    getMockDebugger().sendCommand.mockImplementation(
      (_target: unknown, method: string) => {
        if (method === 'Runtime.evaluate') return { result: {} }; // no objectId
        return {};
      },
    );
    await expect(setFileInputFiles(4, ['/tmp/f.txt'])).rejects.toThrow(
      'No <input type="file"> found in page',
    );
  });

  it('throws when CDP returns subtype "null" (querySelector returned null)', async () => {
    getMockDebugger().sendCommand.mockImplementation(
      (_target: unknown, method: string) => {
        if (method === 'Runtime.evaluate')
          return { result: { objectId: 'obj5', subtype: 'null' } };
        return {};
      },
    );
    await expect(setFileInputFiles(5, ['/tmp/f.txt'])).rejects.toThrow(
      'No <input type="file"> found in page',
    );
  });

  it('passes multiple file paths in the files array', async () => {
    const paths = ['/a/1.png', '/b/2.png', '/c/3.png'];
    getMockDebugger().sendCommand.mockImplementation(
      (_target: unknown, method: string) => {
        if (method === 'Runtime.evaluate') return { result: { objectId: 'objM' } };
        return {};
      },
    );
    await setFileInputFiles(6, paths);
    const setArgs = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'DOM.setFileInputFiles',
    )![2] as { files: string[] };
    expect(setArgs.files).toEqual(paths);
  });
});
