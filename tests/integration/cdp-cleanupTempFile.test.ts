import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupTempFile, tempDownloadIds } from '@/utils/cdp';
import { getMockDownloads } from '../setup/chrome-mocks';

beforeEach(() => {
  tempDownloadIds.clear();
});

describe('cleanupTempFile', () => {
  it('removes downloadId from tempDownloadIds', async () => {
    tempDownloadIds.add(10);
    await cleanupTempFile(10);
    expect(tempDownloadIds.has(10)).toBe(false);
  });

  it('calls chrome.downloads.removeFile with the downloadId', async () => {
    await cleanupTempFile(20);
    expect(getMockDownloads().removeFile).toHaveBeenCalledWith(20);
  });

  it('calls chrome.downloads.erase with { id: downloadId }', async () => {
    await cleanupTempFile(30);
    expect(getMockDownloads().erase).toHaveBeenCalledWith({ id: 30 });
  });

  it('still calls erase when removeFile rejects', async () => {
    getMockDownloads().removeFile.mockRejectedValueOnce(new Error('not found'));
    await cleanupTempFile(40);
    // Both try/catch blocks are independent — erase must still run
    expect(getMockDownloads().erase).toHaveBeenCalledWith({ id: 40 });
  });

  it('still resolves when removeFile rejects', async () => {
    getMockDownloads().removeFile.mockRejectedValueOnce(new Error('not found'));
    await expect(cleanupTempFile(40)).resolves.toBeUndefined();
  });

  it('still called removeFile before erase even when erase rejects', async () => {
    getMockDownloads().erase.mockRejectedValueOnce(new Error('gone'));
    await cleanupTempFile(50);
    expect(getMockDownloads().removeFile).toHaveBeenCalledWith(50);
  });

  it('still resolves when erase rejects', async () => {
    getMockDownloads().erase.mockRejectedValueOnce(new Error('gone'));
    await expect(cleanupTempFile(50)).resolves.toBeUndefined();
  });

  it('removes from tempDownloadIds before making any async calls', async () => {
    tempDownloadIds.add(60);
    // Even if both calls fail synchronously, the delete must happen first
    getMockDownloads().removeFile.mockRejectedValueOnce(new Error('x'));
    getMockDownloads().erase.mockRejectedValueOnce(new Error('y'));
    await cleanupTempFile(60);
    expect(tempDownloadIds.has(60)).toBe(false);
  });
});
