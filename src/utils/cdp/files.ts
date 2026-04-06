/**
 * CDP-based file upload helpers.
 * Writes base64 data to a temp file on disk via chrome.downloads, then uses
 * DOM.setFileInputFiles to inject it into a file input without opening a dialog.
 */

/** IDs of our own temp downloads — exported so the download interceptor can skip them. */
export const tempDownloadIds = new Set<number>();

/** Write base64 data to a temp file on disk. Returns the download ID and OS file path. */
export function writeTempFile(
  base64Data: string, filename: string, mimeType: string,
): Promise<{ downloadId: number; filePath: string }> {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: dataUrl, filename: `_opticlick_tmp/${safeFilename}`, conflictAction: 'overwrite', saveAs: false },
      (downloadId) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        tempDownloadIds.add(downloadId);

        const onChange = (delta: chrome.downloads.DownloadDelta) => {
          if (delta.id !== downloadId) return;
          if (delta.state?.current === 'complete') {
            chrome.downloads.onChanged.removeListener(onChange);
            chrome.downloads.search({ id: downloadId }, (items) => {
              const path = items?.[0]?.filename;
              if (path) { resolve({ downloadId, filePath: path }); }
              else { tempDownloadIds.delete(downloadId); reject(new Error('Temp download finished but path unknown')); }
            });
          }
          if (delta.state?.current === 'interrupted') {
            chrome.downloads.onChanged.removeListener(onChange);
            tempDownloadIds.delete(downloadId);
            reject(new Error('Temp download interrupted'));
          }
        };
        chrome.downloads.onChanged.addListener(onChange);
      },
    );
  });
}

/** Remove the temp file and erase the download entry from Chrome's list. */
export async function cleanupTempFile(downloadId: number): Promise<void> {
  tempDownloadIds.delete(downloadId);
  try { await chrome.downloads.removeFile(downloadId); } catch { /* already gone */ }
  try { await chrome.downloads.erase({ id: downloadId }); } catch { /* */ }
}
