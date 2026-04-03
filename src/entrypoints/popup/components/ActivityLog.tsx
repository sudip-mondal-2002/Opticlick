import type { RefObject } from 'react';

interface LogItem {
  message: string;
  level: string;
}

interface Props {
  logs: LogItem[];
  logRef: RefObject<HTMLDivElement | null>;
}

const levelClass: Record<string, string> = {
  info: 'text-slate-500 dark:text-slate-400',
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-rose-600 dark:text-rose-400',
};

export function ActivityLog({ logs, logRef }: Props) {
  return (
    <div className="border-t border-sky-100 dark:border-slate-700 px-4 pt-2.5 pb-3 bg-white dark:bg-slate-900">
      <div className="text-[10px] font-bold uppercase tracking-[0.8px] text-sky-300 dark:text-sky-600 mb-1.5">
        Activity Log
      </div>

      <div
        ref={logRef}
        className="log-scroll h-[130px] overflow-y-auto bg-sky-50/60 dark:bg-slate-950 border border-sky-100 dark:border-slate-700 rounded-lg px-2.5 py-2 font-mono text-[11px] leading-[1.65]"
      >
        {logs.length === 0 ? (
          <span className="text-slate-400 dark:text-slate-600">No activity yet.</span>
        ) : (
          logs.map((entry, i) => (
            <div key={i} className={`mb-px ${levelClass[entry.level] ?? levelClass.info}`}>
              {entry.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
