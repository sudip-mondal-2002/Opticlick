import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteVFSFile,
  listVFSFiles,
  type VFSFile,
} from '@/utils/db/vfs';

interface Props {
  sessionId: number | null;
}

const STEP_SCREENSHOT_RE = /^step_\d+\.png$/i;

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export function VFSBrowser({ sessionId }: Props) {
  const [files, setFiles] = useState<VFSFile[]>([]);
  const loadFilesRequestId = useRef(0);
  const stepScreenshotFiles = files.filter((file) => STEP_SCREENSHOT_RE.test(file.name));

  const loadFiles = useCallback(async () => {
    const requestId = ++loadFilesRequestId.current;

    if (!sessionId) {
      setFiles([]);
      return;
    }

    try {
      const files = await listVFSFiles(sessionId);

      if (requestId === loadFilesRequestId.current) {
        setFiles(files);
      }
    } catch (error) {
      if (requestId === loadFilesRequestId.current) {
        console.error('Failed to load VFS files', error);
      }
    }
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
        <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
          {files.map((file) => (
            <div
              key={file.id}
              className="group flex items-center gap-2 py-2"
            >
              {file.mimeType.startsWith('image/') && (
                <img
                  src={`data:${file.mimeType};base64,${file.data}`}
                  alt={file.name}
                  className="w-9 h-9 shrink-0 object-cover rounded-[6px] border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900"
                />
              )}
              <div className="min-w-0 flex-1 flex items-center gap-2">
                <div className="truncate text-[12px] font-medium text-slate-700 dark:text-slate-200">
                  {file.name}
                </div>
                <div className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                  {(file.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-1">
                <button
                  onClick={() => downloadFile(file)}
                  className="w-7 h-7 flex items-center justify-center rounded-[6px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="Download"
                  aria-label={`Download ${file.name}`}
                >
                  <DownloadIcon />
                </button>

                <button
                  onClick={async () => {
                    await deleteVFSFile(file.id);
                    await loadFiles();
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded-[6px] text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                  title="Delete"
                  aria-label={`Delete ${file.name}`}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
