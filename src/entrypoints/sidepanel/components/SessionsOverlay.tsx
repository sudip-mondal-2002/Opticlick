<<<<<<< Updated upstream
import { useState, useRef, useEffect, useMemo } from 'react';
=======
import { useEffect, useRef, useState } from 'react';
>>>>>>> Stashed changes
import type { Session } from '@/utils/types';
import {
  searchSessions,
  dateRangeToBounds,
  uniqueSessionModelIds,
  type DateRangePreset,
  type SessionSort,
} from '@/utils/session-search';
import { HighlightedText } from '@/utils/highlight-match';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { backfillSessionMetadata } from '@/utils/session-backfill';

function formatSessionDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
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

<<<<<<< Updated upstream
function DownloadIcon() {
=======
function ExportIcon() {
>>>>>>> Stashed changes
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ExportMenu({
<<<<<<< Updated upstream
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
=======
  session,
  onExport,
}: {
  session: Session;
  onExport: (sessionId: number, format: 'json' | 'markdown') => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const sessionId = session.id;
  if (sessionId == null) return null;

  const handleExport = (format: 'json' | 'markdown') => {
    onExport(sessionId, format);
    setOpen(false);
  };

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        aria-label={`Export session: ${session.title}`}
      >
        <ExportIcon />
        Export
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 min-w-[9rem] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleExport('json'); }}
            className="w-full text-left px-3 py-1.5 text-[11px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Download JSON
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleExport('markdown'); }}
            className="w-full text-left px-3 py-1.5 text-[11px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Download Markdown
>>>>>>> Stashed changes
          </button>
        </div>
      )}
    </div>
  );
}

<<<<<<< Updated upstream
const DATE_PRESETS: { id: DateRangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

const SORT_OPTIONS: { id: SessionSort; label: string }[] = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
];

function SessionCard({
  session,
  query,
  modelLabel,
  exportingId,
=======
function SessionCard({
  session,
>>>>>>> Stashed changes
  onOpen,
  onExport,
}: {
  session: Session;
<<<<<<< Updated upstream
  query: string;
  modelLabel: (id: string) => string;
  exportingId: number | null;
  onOpen: (s: Session) => void;
  onExport: (sessionId: number, format: 'json' | 'markdown') => void;
}) {
  const metaParts = [formatSessionDate(session.updatedAt)];
  if (session.modelId) metaParts.push(modelLabel(session.modelId));
  if (session.status) metaParts.push(session.status);

=======
  onOpen: (s: Session) => void;
  onExport: (sessionId: number, format: 'json' | 'markdown') => void;
}) {
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
            <HighlightedText text={session.title} query={query} />
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
            {metaParts.join(' · ')}
=======
            {session.title}
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
            {formatRelativeDate(session.updatedAt)}
            {session.status ? ` · ${session.status.replace('_', ' ')}` : ''}
>>>>>>> Stashed changes
          </p>
        </div>
        <span className="shrink-0 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-400 mt-1 transition-colors">
          <ChevronIcon />
        </span>
      </button>
<<<<<<< Updated upstream
      {session.id != null && (
        <ExportMenu
          sessionId={session.id}
          exporting={exportingId === session.id}
          onExport={onExport}
        />
      )}
=======
      <ExportMenu session={session} onExport={onExport} />
>>>>>>> Stashed changes
    </div>
  );
}

interface Props {
  sessions: Session[];
  exportingId: number | null;
  onClose: () => void;
  onResume: (session: Session) => void;
  onExport: (sessionId: number, format: 'json' | 'markdown') => void;
<<<<<<< Updated upstream
  onRefresh: () => Promise<void>;
  modelLabel: (modelId: string) => string;
}

export function SessionsOverlay({ sessions, exportingId, onClose, onResume, onExport, onRefresh, modelLabel }: Props) {
  const [query, setQuery] = useState('');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('all');
  const [modelFilter, setModelFilter] = useState('');
  const [sort, setSort] = useState<SessionSort>('newest');
  const [backfilling, setBackfilling] = useState(false);

  const debouncedQuery = useDebouncedValue(query, 200);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBackfilling(true);
      try {
        const updated = await backfillSessionMetadata(sessions);
        if (!cancelled && updated > 0) await onRefresh();
      } finally {
        if (!cancelled) setBackfilling(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on overlay mount
  }, []);

  const modelIds = useMemo(() => uniqueSessionModelIds(sessions), [sessions]);

  const filtered = useMemo(() => {
    const dateBounds = dateRangeToBounds(datePreset);
    return searchSessions(sessions, debouncedQuery, {
      ...dateBounds,
      modelId: modelFilter || undefined,
      sort: debouncedQuery.trim() ? sort : sort === 'relevance' ? 'newest' : sort,
    });
  }, [sessions, debouncedQuery, datePreset, modelFilter, sort]);

  const hasActiveFilters = query.trim() !== '' || datePreset !== 'all' || modelFilter !== '';

=======
}

export function SessionsOverlay({ sessions, onClose, onResume, onExport }: Props) {
>>>>>>> Stashed changes
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-slate-950">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800">
        <span className="flex-1 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
          Past Sessions
        </span>
        {backfilling && (
          <span className="text-[10px] text-slate-400 dark:text-slate-500">Indexing…</span>
        )}
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-[11px] font-medium transition-colors"
        >
          Close
        </button>
      </div>

      {sessions.length > 0 && (
        <div className="shrink-0 px-3 py-2 space-y-2 border-b border-slate-100 dark:border-slate-800">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              <SearchIcon />
            </span>
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sessions…"
              className="w-full pl-8 pr-2.5 py-1.5 text-[12px] border border-slate-200 dark:border-slate-700 rounded-[6px] bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value as DateRangePreset)}
              className="flex-1 min-w-0 px-2 py-1 text-[11px] border border-slate-200 dark:border-slate-700 rounded-[6px] bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 outline-none focus:border-sky-500"
              aria-label="Date range"
            >
              {DATE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1 text-[11px] border border-slate-200 dark:border-slate-700 rounded-[6px] bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 outline-none focus:border-sky-500"
              aria-label="Model filter"
            >
              <option value="">All models</option>
              {modelIds.map((id) => (
                <option key={id} value={id}>{modelLabel(id)}</option>
              ))}
            </select>
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SessionSort)}
            className="w-full px-2 py-1 text-[11px] border border-slate-200 dark:border-slate-700 rounded-[6px] bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 outline-none focus:border-sky-500"
            aria-label="Sort order"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-slate-400 dark:text-slate-600 px-8 text-center">
          <HistoryIcon />
          <p className="text-[12px]">No past sessions yet.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-slate-400 dark:text-slate-600 px-8 text-center">
          <SearchIcon />
          <p className="text-[12px]">
            {hasActiveFilters ? 'No sessions match your search.' : 'No past sessions yet.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => { setQuery(''); setDatePreset('all'); setModelFilter(''); }}
              className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto log-scroll">
          {filtered.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              query={debouncedQuery}
              modelLabel={modelLabel}
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
