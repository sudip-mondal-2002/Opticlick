/**
 * Tests for writeTempFile — the CDP-based file upload mechanism.
 *
 * writeTempFile uses chrome.downloads.download (callback API) to write a base64
 * file to disk, then listens on chrome.downloads.onChanged for completion.
 * The chrome mock's _fire() helper drives these events in tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { writeTempFile, tempDownloadIds } from '@/utils/cdp';
import { getMockDownloads } from '../setup/chrome-mocks';

// Helper: configure the mock so download() calls its callback synchronously,
// then fire the 'complete' event + mock search() in the next microtask.
function resolveDownload(downloadId: number, filePath: string) {
  const dl = getMockDownloads();
  dl.download.mockImplementation(
    (_opts: unknown, cb: (id: number) => void) => cb(downloadId),
  );
  // Fire completion after current microtask (listener is registered inside callback)
  queueMicrotask(() => {
    dl.search.mockImplementation(
      (_q: unknown, cb: (items: unknown[]) => void) =>
        cb([{ id: downloadId, filename: filePath }]),
    );
    dl.onChanged._fire({ id: downloadId, state: { current: 'complete' } });
  });
}

function rejectDownload(downloadId: number, reason: 'interrupted' | 'no-path') {
  const dl = getMockDownloads();
  dl.download.mockImplementation(
    (_opts: unknown, cb: (id: number) => void) => cb(downloadId),
  );
  queueMicrotask(() => {
    if (reason === 'interrupted') {
      dl.onChanged._fire({ id: downloadId, state: { current: 'interrupted' } });
    } else {
      // 'no-path': complete event but search returns empty filename
      dl.search.mockImplementation(
        (_q: unknown, cb: (items: unknown[]) => void) =>
          cb([{ id: downloadId, filename: '' }]),
      );
      dl.onChanged._fire({ id: downloadId, state: { current: 'complete' } });
    }
  });
}

beforeEach(() => {
  tempDownloadIds.clear();
});

describe('writeTempFile', () => {
  it('sanitizes filename — replaces special chars but preserves dots and hyphens', async () => {
    resolveDownload(1, '/tmp/test.png');
    // spaces and '?' become '_'; dots, digits, letters, '-' are kept
    // "my.archive v2?.tar.gz" → "my.archive_v2_.tar.gz"
    await writeTempFile('base64data', 'my.archive v2?.tar.gz', 'application/gzip');
    const call = getMockDownloads().download.mock.calls[0][0] as { filename: string };
    expect(call.filename).toBe('_opticlick_tmp/my.archive_v2_.tar.gz');
  });

  it('calls chrome.downloads.download with correct data URL', async () => {
    resolveDownload(2, '/tmp/test.txt');
    await writeTempFile('aGVsbG8=', 'test.txt', 'text/plain');
    const call = getMockDownloads().download.mock.calls[0][0] as { url: string };
    expect(call.url).toBe('data:text/plain;base64,aGVsbG8=');
  });

  it('sets conflictAction to "overwrite" and saveAs to false', async () => {
    resolveDownload(3, '/tmp/test.txt');
    await writeTempFile('aA==', 'test.txt', 'text/plain');
    const call = getMockDownloads().download.mock.calls[0][0] as {
      conflictAction: string;
      saveAs: boolean;
    };
    expect(call.conflictAction).toBe('overwrite');
    expect(call.saveAs).toBe(false);
  });

  it('adds downloadId to tempDownloadIds immediately after callback', async () => {
    resolveDownload(10, '/tmp/file.bin');
    // Spy on tempDownloadIds.has inside the promise body by checking after resolution
    const promise = writeTempFile('dGVzdA==', 'file.bin', 'application/octet-stream');
    // After callback fires synchronously, downloadId should be in the set
    expect(tempDownloadIds.has(10)).toBe(true);
    await promise;
    // Still present after resolution (cleanup is caller's job)
    expect(tempDownloadIds.has(10)).toBe(true);
  });

  it('resolves with correct {downloadId, filePath}', async () => {
    resolveDownload(42, '/Users/user/Downloads/_opticlick_tmp/photo.png');
    const result = await writeTempFile('abc', 'photo.png', 'image/png');
    expect(result.downloadId).toBe(42);
    expect(result.filePath).toBe('/Users/user/Downloads/_opticlick_tmp/photo.png');
  });

  it('calls chrome.downloads.search with the downloadId on completion', async () => {
    resolveDownload(20, '/tmp/x.txt');
    await writeTempFile('dA==', 'x.txt', 'text/plain');
    const searchCall = getMockDownloads().search.mock.calls[0][0] as { id: number };
    expect(searchCall.id).toBe(20);
  });

  it('removes the onChange listener after resolution', async () => {
    resolveDownload(30, '/tmp/y.txt');
    await writeTempFile('dA==', 'y.txt', 'text/plain');
    expect(getMockDownloads().onChanged.removeListener).toHaveBeenCalledOnce();
    // The same function reference was passed to addListener and removeListener
    const added = getMockDownloads().onChanged.addListener.mock.calls[0][0];
    const removed = getMockDownloads().onChanged.removeListener.mock.calls[0][0];
    expect(added).toBe(removed);
  });

  it('rejects when chrome.runtime.lastError is set', async () => {
    const dl = getMockDownloads();
    dl.download.mockImplementation(
      (_opts: unknown, cb: (id: number | undefined) => void) => {
        // Set lastError before calling callback (Chrome API contract)
        (globalThis.chrome as { runtime: { lastError: unknown } }).runtime.lastError = {
          message: 'Disk quota exceeded',
        };
        cb(undefined as unknown as number);
      },
    );
    await expect(writeTempFile('x', 'f.txt', 'text/plain')).rejects.toThrow(
      'Disk quota exceeded',
    );
  });

  it('rejects when download state is "interrupted"', async () => {
    rejectDownload(50, 'interrupted');
    await expect(writeTempFile('x', 'f.txt', 'text/plain')).rejects.toThrow(
      'Temp download interrupted',
    );
  });

  it('removes the onChange listener when download is interrupted', async () => {
    rejectDownload(52, 'interrupted');
    await writeTempFile('x', 'f.txt', 'text/plain').catch(() => {});
    // listener must be cleaned up on both success and failure paths
    expect(getMockDownloads().onChanged.removeListener).toHaveBeenCalledOnce();
    const added   = getMockDownloads().onChanged.addListener.mock.calls[0][0];
    const removed = getMockDownloads().onChanged.removeListener.mock.calls[0][0];
    expect(added).toBe(removed);
  });

  it('removes downloadId from tempDownloadIds on "interrupted"', async () => {
    rejectDownload(51, 'interrupted');
    await writeTempFile('x', 'f.txt', 'text/plain').catch(() => {});
    expect(tempDownloadIds.has(51)).toBe(false);
  });

  it('rejects when search returns no file path (empty filename string)', async () => {
    rejectDownload(60, 'no-path');
    await expect(writeTempFile('x', 'f.txt', 'text/plain')).rejects.toThrow(
      'Temp download finished but path unknown',
    );
  });

  it('rejects when search returns an empty items array (items[0] is undefined)', async () => {
    const dl = getMockDownloads();
    dl.download.mockImplementation(
      (_opts: unknown, cb: (id: number) => void) => cb(62),
    );
    queueMicrotask(() => {
      // items is [] — items[0] is undefined, optional chain gives undefined, falsy
      dl.search.mockImplementation(
        (_q: unknown, cb: (items: unknown[]) => void) => cb([]),
      );
      dl.onChanged._fire({ id: 62, state: { current: 'complete' } });
    });
    await expect(writeTempFile('x', 'f.txt', 'text/plain')).rejects.toThrow(
      'Temp download finished but path unknown',
    );
  });

  it('removes downloadId from tempDownloadIds on "no-path" failure', async () => {
    rejectDownload(61, 'no-path');
    await writeTempFile('x', 'f.txt', 'text/plain').catch(() => {});
    expect(tempDownloadIds.has(61)).toBe(false);
  });

  it('ignores a delta with no state field (e.g. filename update) — promise stays pending', async () => {
    const dl = getMockDownloads();
    dl.download.mockImplementation(
      (_opts: unknown, cb: (id: number) => void) => cb(70),
    );
    let resolved = false;
    const promise = writeTempFile('x', 'f.txt', 'text/plain').then((r) => {
      resolved = true;
      return r;
    });

    // A filename-change event with no state field — should be silently ignored
    dl.onChanged._fire({ id: 70, filename: { current: 'downloaded.txt' } });
    await new Promise((r) => queueMicrotask(r as () => void));
    expect(resolved).toBe(false);

    // Properly resolve so the test doesn't leak a pending promise
    dl.search.mockImplementation(
      (_q: unknown, cb: (items: unknown[]) => void) =>
        cb([{ id: 70, filename: '/tmp/f.txt' }]),
    );
    dl.onChanged._fire({ id: 70, state: { current: 'complete' } });
    await promise;
    expect(resolved).toBe(true);
  });

  it('ignores onChanged events for a different downloadId', async () => {
    const dl = getMockDownloads();
    dl.download.mockImplementation(
      (_opts: unknown, cb: (id: number) => void) => cb(100),
    );
    let resolved = false;
    const promise = writeTempFile('x', 'f.txt', 'text/plain').then((r) => {
      resolved = true;
      return r;
    });

    // Fire event for wrong ID — should not resolve
    dl.onChanged._fire({ id: 999, state: { current: 'complete' } });
    await new Promise((r) => queueMicrotask(r as () => void));
    expect(resolved).toBe(false);

    // Now fire correct ID
    dl.search.mockImplementation(
      (_q: unknown, cb: (items: unknown[]) => void) =>
        cb([{ id: 100, filename: '/tmp/f.txt' }]),
    );
    dl.onChanged._fire({ id: 100, state: { current: 'complete' } });
    await promise;
    expect(resolved).toBe(true);
  });
});
