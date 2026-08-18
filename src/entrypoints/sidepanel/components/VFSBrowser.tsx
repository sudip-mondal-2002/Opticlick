import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteVFSFile,
  listVFSFiles,
  listGlobalVFSFiles,
  type VFSFile,
} from '@/utils/db/vfs';

import { getSessions } from '@/utils/db/sessions';
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

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function VFSBrowser({ sessionId: _sessionId }: Props)  {
  const [files, setFiles] = useState<VFSFile[]>([]);
  const [globalFiles, setGlobalFiles] = useState<VFSFile[]>([]);
  const [sessionGroups, setSessionGroups] = useState<
    { id?: number; title: string; files: VFSFile[] }[]
  >([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const loadFilesRequestId = useRef(0);
  const stepScreenshotFiles = files.filter((file) => STEP_SCREENSHOT_RE.test(file.name));

  const loadFiles = useCallback(async () => {
    const requestId = ++loadFilesRequestId.current;

    try {
      const sessions = await getSessions();

      const groupedSessions = await Promise.all(
        sessions.map(async (session) => ({
          id: session.id,
          title: session.title,
          files: session.id
            ? await listVFSFiles(session.id)
            : [],
        })),
      );

      const globals = await listGlobalVFSFiles();

      if (requestId === loadFilesRequestId.current) {
        setGlobalFiles(globals);

        setSessionGroups(
          groupedSessions.filter((g) => g.files.length > 0),
        );

        setFiles([
          ...globals,
          ...groupedSessions.flatMap((g) => g.files),
        ]);
      }
    } catch (error) {
      console.error('Failed to load VFS files', error);
    }
  }, []);
  
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

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
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

  const renderFile = (file: VFSFile) => (
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
          className="w-7 h-7 flex items-center justify-center rounded-[6px]"
        >
          <DownloadIcon />
        </button>

        <button
          onClick={async () => {
            await deleteVFSFile(file.id);
            await loadFiles();
          }}
          className="w-7 h-7 flex items-center justify-center rounded-[6px]"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );

  const filteredSessionGroups = sessionGroups.filter((group) =>
    group.title.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const showGlobal = searchQuery === '' || 'global files'.includes(searchQuery.toLowerCase());
  const hasMatches = filteredSessionGroups.length > 0 || (showGlobal && globalFiles.length > 0);

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

      {files.length > 0 && (
        <div className="relative mb-3">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <SearchIcon />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions…"
            className="w-full pl-8 pr-12 py-1.5 text-[12px] border border-slate-200 dark:border-slate-700 rounded-[6px] bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-semibold"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {files.length === 0 ? (
        <div className="text-center text-sm text-slate-500 mt-6">
          No files found.
        </div>
      ) : !hasMatches ? (
        <div className="text-center text-sm text-slate-500 mt-6">
          No sessions match your search.
        </div>
      ) : (
        <div className="space-y-3">
          {globalFiles.length > 0 && showGlobal && (
            <div className="border border-slate-200 dark:border-slate-800 rounded-[6px] overflow-hidden bg-slate-50/30 dark:bg-slate-900/10">
              <button
                onClick={() => toggleGroup('global')}
                className="w-full px-3 py-2 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100/70 dark:hover:bg-slate-800/50 text-left font-semibold text-[12px] text-slate-700 dark:text-slate-300 transition-colors"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`transform transition-transform duration-200 ${collapsedGroups['global'] ? '' : 'rotate-90'}`}>
                    <ChevronIcon />
                  </span>
                  <span className="truncate">Global Files</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                    ({globalFiles.length})
                  </span>
                </div>
              </button>

              {!collapsedGroups['global'] && (
                <div className="px-3 divide-y divide-slate-100 dark:divide-slate-800/70 bg-white dark:bg-transparent">
                  {globalFiles.map(renderFile)}
                </div>
              )}
            </div>
          )}

          {filteredSessionGroups.map((group) => {
            const groupKey = group.id != null ? String(group.id) : group.title;
            const isCollapsed = !!collapsedGroups[groupKey];
            return (
              <div key={groupKey} className="border border-slate-200 dark:border-slate-800 rounded-[6px] overflow-hidden bg-slate-50/30 dark:bg-slate-900/10">
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="w-full px-3 py-2 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100/70 dark:hover:bg-slate-800/50 text-left font-semibold text-[12px] text-slate-700 dark:text-slate-300 transition-colors"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`transform transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}>
                      <ChevronIcon />
                    </span>
                    <span className="truncate" title={group.title}>{group.title}</span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                      ({group.files.length})
                    </span>
                  </div>
                </button>

                {!isCollapsed && (
                  <div className="px-3 divide-y divide-slate-100 dark:divide-slate-800/70 bg-white dark:bg-transparent">
                    {group.files.map(renderFile)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}