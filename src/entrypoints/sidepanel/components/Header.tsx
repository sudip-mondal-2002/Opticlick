import { useTheme } from '../context/ThemeContext';

interface Props {
  isRunning: boolean;
  isError: boolean;
  sessionCount: number;
  onShowSessions: () => void;
}

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function Header({ isRunning, isError, sessionCount, onShowSessions }: Props) {
  const { theme, toggleTheme } = useTheme();

  const dotClass = isRunning
    ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.2)] animate-pulse-dot'
    : isError
      ? 'bg-rose-500'
      : 'bg-slate-600';

  return (
    <header className="relative flex items-center gap-2.5 px-4 py-3 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
      {/* Gradient accent line */}
      <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-sky-600 via-sky-400 to-transparent opacity-60 pointer-events-none" />

      {/* Logo mark */}
      <img src="/icon.svg" width={28} height={28} className="shrink-0 rounded-[8px]" alt="Opticlick" />

      {/* Title */}
      <div className="flex flex-col leading-none">
        <span className="text-[13px] font-bold tracking-[0.1px] text-slate-800 dark:text-slate-100">
          Opticlick
        </span>
        <span className="text-[8px] font-semibold tracking-[1.8px] uppercase text-slate-400 dark:text-slate-500 mt-[2px]">
          Engine
        </span>
      </div>

      {/* Agent badge */}
      <span className="text-[8px] font-bold tracking-[1.2px] uppercase text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-950/60 border border-sky-300 dark:border-sky-800 rounded px-[6px] py-[2px]">
        Agent
      </span>

      {/* Sessions button */}
      <button
        onClick={onShowSessions}
        className="ml-auto flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 bg-slate-200/60 dark:bg-slate-800 rounded-md transition-colors"
        title="Past sessions"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
        {sessionCount > 0 && <span>{sessionCount}</span>}
      </button>

      {/* Status dot */}
      <div className={`w-2 h-2 rounded-full shrink-0 transition-[background,box-shadow] duration-300 ${dotClass}`} />

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="w-6 h-6 shrink-0 flex items-center justify-center rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
        title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      >
        {theme === 'light' ? <MoonIcon /> : <SunIcon />}
      </button>
    </header>
  );
}
