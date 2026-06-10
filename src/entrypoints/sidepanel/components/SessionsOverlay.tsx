import { useEffect, useMemo, useState } from 'react';
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
import { exportSessionAsJson, exportSessionAsMarkdown, importSession } from '@/utils/session-export';
import type { SessionExportData } from '@/utils/session-export';

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
  onOpen,
  onExport,
}: {
  session: Session;
  query: string;
  modelLabel: (id: string) => string;
  onOpen: (s: Session) => void;
  onExport: (s: Session, format: 'json' | 'markdown') => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const metaParts = [formatSessionDate(session.updatedAt)];
  if (session.modelId) metaParts.push(modelLabel(session.modelId));

  return (
    <div
      className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800/60 last:border-b-0 group relative"
    >
      <div
        onClick={() => onOpen(session)}
        className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer"
      >
        <div className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-sky-100 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800/60 flex items-center justify-center text-sky-500">
          <HistoryIcon />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium text-slate-700 dark:text-slate-200 leading-snug line-clamp-2">
            <HighlightedText text={session.title} query={query} />
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
            {metaParts.join(' · ')}
          </p>
        </div>
      </div>

      <div className="relative shrink-0 flex items-center gap-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDropdownOpen(!dropdownOpen);
          }}
          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          title="Export Session"
          aria-label="Export menu"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>

        {dropdownOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.stopPropagation();
                setDropdownOpen(false);
              }}
            />
            <div className="absolute right-7 top-7 w-28 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg py-1 z-50 text-[11px]">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDropdownOpen(false);
                  onExport(session, 'json');
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
              >
                Export JSON
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDropdownOpen(false);
                  onExport(session, 'markdown');
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
              >
                Export MD
              </button>
            </div>
          </>
        )}

        <span className="text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-400 transition-colors pointer-events-none">
          <ChevronIcon />
        </span>
      </div>
    </div>
  );
}

interface Props {
  sessions: Session[];
  onClose: () => void;
  onResume: (session: Session) => void;
  onRefresh: () => Promise<void>;
  modelLabel: (modelId: string) => string;
}

export function SessionsOverlay({ sessions, onClose, onResume, onRefresh, modelLabel }: Props) {
  const [query, setQuery] = useState('');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('all');
  const [modelFilter, setModelFilter] = useState('');
  const [sort, setSort] = useState<SessionSort>('newest');
  const [backfilling, setBackfilling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

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

  const handleImport = () => {
    setImportError(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setImporting(true);
      try {
        const text = await file.text();
        const data: SessionExportData = JSON.parse(text);
        const newSessionId = await importSession(data);
        await onRefresh();
        // Find the freshly imported session and resume it
        const { getSessions } = await import('@/utils/db');
        const all = await getSessions();
        const imported = all.find((s) => s.id === newSessionId);
        if (imported) {
          onResume(imported);
          onClose();
        }
      } catch (err) {
        setImportError(`Import failed: ${(err as Error).message}`);
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  const handleExport = async (session: Session, format: 'json' | 'markdown') => {
    if (session.id == null) return;
    try {
      const content = format === 'json' 
        ? await exportSessionAsJson(session.id) 
        : await exportSessionAsMarkdown(session.id);
        
      const slug = session.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 30);
      const ext = format === 'markdown' ? 'md' : 'json';
      const filename = `opticlick-session-${session.id}-${slug || 'untitled'}.${ext}`;

      const blob = new Blob([content], { 
        type: format === 'json' ? 'application/json' : 'text/markdown' 
      });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.error('Export failed:', err);
      alert(`Export failed: ${(err as Error).message}`);
    }
  };

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
          onClick={handleImport}
          disabled={importing}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800/60 hover:bg-sky-100 dark:hover:bg-sky-900/50 disabled:opacity-50 transition-colors"
          title="Load session from JSON file"
          aria-label="Load session"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {importing ? 'Loading…' : 'Load'}
        </button>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-[11px] font-medium transition-colors"
        >
          Close
        </button>
      </div>
      {importError && (
        <div className="shrink-0 px-3 py-2 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800/60 text-[11px] text-red-600 dark:text-red-400 flex items-center justify-between gap-2">
          <span>{importError}</span>
          <button
            onClick={() => setImportError(null)}
            className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-300 font-bold leading-none"
            aria-label="Dismiss error"
          >×</button>
        </div>
      )}

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
              onOpen={(s) => { onResume(s); onClose(); }}
              onExport={handleExport}
            />
          ))}
        </div>
      )}
    </div>
  );
}
