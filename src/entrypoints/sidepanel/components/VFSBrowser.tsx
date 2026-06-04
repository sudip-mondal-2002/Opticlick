import { useCallback, useEffect, useState } from 'react';
import {
  deleteVFSFile,
  listVFSFiles,
  type VFSFile,
} from '@/utils/db/vfs';

interface Props {
  sessionId: number | null;
}

const STEP_SCREENSHOT_RE = /^step_\d+\.png$/i;

export function VFSBrowser({ sessionId }: Props) {
  const [files, setFiles] = useState<VFSFile[]>([]);
  const stepScreenshotFiles = files.filter((file) => STEP_SCREENSHOT_RE.test(file.name));

  const loadFiles = useCallback(async () => {
    if (!sessionId) {
      setFiles([]);
      return;
    }

    setFiles(await listVFSFiles(sessionId));
  }, [sessionId]);

  const downloadFile = (file: VFSFile) => {
    const link = document.createElement('a');

    link.href = `data:${file.mimeType};base64,${file.data}`;
    link.download = file.name;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearStepScreenshots = async () => {
    await Promise.all(stepScreenshotFiles.map((file) => deleteVFSFile(file.id)));
    await loadFiles();
  };

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    const handler = (msg: Record<string, unknown>) => {
      if (msg.type === 'AGENT_STATE_CHANGE') loadFiles();
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [loadFiles]);

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Files ({files.length})
        </h2>
        <button
          onClick={clearStepScreenshots}
          disabled={stepScreenshotFiles.length === 0}
          className="text-xs px-2 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Clear Step Screenshots
        </button>
      </div>

      {files.length === 0 ? (
        <div className="text-center text-sm text-slate-500 mt-6">
          No files found for this session.
        </div>
      ) : (
        files.map((file) => (
          <div
            key={file.id}
            className="border rounded p-2 mb-2"
          >
            {file.mimeType.startsWith('image/') && (
              <img
                src={`data:${file.mimeType};base64,${file.data}`}
                alt={file.name}
                className="w-full max-h-32 object-contain border rounded mb-2"
              />
            )}
            <div className="font-medium text-sm">
              {file.name}
            </div>

            <div className="text-xs text-slate-500">
              {file.mimeType}
            </div>

            <div className="text-xs text-slate-500">
              {(file.size / 1024).toFixed(1)} KB
            </div>

            <div className="text-xs text-slate-500">
              {new Date(file.createdAt).toLocaleString()}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => downloadFile(file)}
                className="text-xs px-2 py-1 rounded border"
              >
                Download
              </button>

              <button
                onClick={async () => {
                  await deleteVFSFile(file.id);
                  await loadFiles();
                }}
                className="text-xs px-2 py-1 rounded border"
              >
                Delete
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
