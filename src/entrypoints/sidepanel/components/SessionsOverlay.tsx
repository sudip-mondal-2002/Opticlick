import { useState, useRef, useEffect } from 'react';
import type { Session } from '@/utils/types';

function formatRelativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function HistoryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
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

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ExportMenu({
  sessionId,
  exporting,
  onExport,
}: {
  sessionId: number;
  exporting: boolean;
  onExport: (sessionId: number, format: 'json' | 'markdown') => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        disabled={exporting}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex items-center gap-1 px-1.5 py-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
        title="Export session"
      >
        <DownloadIcon />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 min-w-[148px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1">
          <button
            type="button"
            disabled={exporting}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onExport(sessionId, 'json');
            }}
            className="w-full text-left px-3 py-1.5 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            Export as JSON
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onExport(sessionId, 'markdown');
            }}
            className="w-full text-left px-3 py-1.5 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            Export as Markdown
          </button>
        </div>
      )}
    </div>
  );
}

function SessionCard({
  session,
  exportingId,
  onOpen,
  onExport,
}: {
  session: Session;
  exportingId: number | null;
  onOpen: (s: Session) => void;
  onExport: (sessionId: number, format: 'json' | 'markdown') => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800/60 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
      <button
        type="button"
        onClick={() => onOpen(session)}
        className="flex items-start gap-3 flex-1 min-w-0 text-left"
      >
        <div className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-sky-100 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800/60 flex items-center justify-center text-sky-500">
          <HistoryIcon />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium text-slate-700 dark:text-slate-200 leading-snug line-clamp-2">
            {session.title}
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
            {formatRelativeDate(session.updatedAt)}
            {session.status && (
              <span className="ml-1.5 text-slate-400 dark:text-slate-500">· {session.status}</span>
            )}
          </p>
        </div>
        <span className="shrink-0 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-400 mt-1 transition-colors">
          <ChevronIcon />
        </span>
      </button>
      {session.id != null && (
        <ExportMenu
          sessionId={session.id}
          exporting={exportingId === session.id}
          onExport={onExport}
        />
      )}
    </div>
  );
}

interface Props {
  sessions: Session[];
  exportingId: number | null;
  onClose: () => void;
  onResume: (session: Session) => void;
  onExport: (sessionId: number, format: 'json' | 'markdown') => void;
}

export function SessionsOverlay({ sessions, exportingId, onClose, onResume, onExport }: Props) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-slate-950">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800">
        <span className="flex-1 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
          Past Sessions
        </span>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-[11px] font-medium transition-colors"
        >
          Close
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-slate-400 dark:text-slate-600 px-8 text-center">
          <HistoryIcon />
          <p className="text-[12px]">No past sessions yet.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto log-scroll">
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              exportingId={exportingId}
              onOpen={(s) => { onResume(s); onClose(); }}
              onExport={onExport}
            />
          ))}
        </div>
      )}
    </div>
  );
}
