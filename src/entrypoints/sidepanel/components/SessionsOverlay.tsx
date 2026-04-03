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

function SessionCard({ session, onOpen }: { session: Session; onOpen: (s: Session) => void }) {
  return (
    <button
      onClick={() => onOpen(session)}
      className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800/60 last:border-b-0 group"
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
        </p>
      </div>
      <span className="shrink-0 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-400 mt-1 transition-colors">
        <ChevronIcon />
      </span>
    </button>
  );
}

interface Props {
  sessions: Session[];
  onClose: () => void;
  onResume: (session: Session) => void;
}

export function SessionsOverlay({ sessions, onClose, onResume }: Props) {
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
              onOpen={(s) => { onResume(s); onClose(); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
