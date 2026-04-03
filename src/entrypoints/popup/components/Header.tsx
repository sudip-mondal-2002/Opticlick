import { useTheme } from '../context/ThemeContext';

interface Props {
  isRunning: boolean;
  isError: boolean;
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function Header({ isRunning, isError }: Props) {
  const { theme, toggleTheme } = useTheme();

  const dotClass = isRunning
    ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.2)] animate-pulse-dot'
    : isError
      ? 'bg-rose-500'
      : 'bg-slate-300 dark:bg-slate-600';

  return (
    <header className="relative flex items-center gap-2.5 px-4 py-3 bg-white dark:bg-slate-900 border-b border-sky-100 dark:border-slate-700">
      {/* Gradient accent line */}
      <div className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-gradient-to-r from-sky-500 via-sky-300 to-sky-200 opacity-70 pointer-events-none" />

      {/* Logo */}
      <div className="w-[26px] h-[26px] shrink-0 rounded-[7px] bg-gradient-to-br from-sky-600 to-sky-400 shadow-[0_0_10px_rgba(14,165,233,0.35)]" />

      <h1 className="text-sm font-bold tracking-[0.2px] text-slate-900 dark:text-slate-100">
        Opticlick
      </h1>

      <span className="text-[9px] font-bold tracking-[0.8px] uppercase text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-900/40 border border-sky-200 dark:border-sky-800 rounded px-[5px] py-px">
        AI Agent
      </span>

      {/* Status dot */}
      <div className={`ml-auto w-2 h-2 rounded-full shrink-0 transition-[background,box-shadow] duration-300 ${dotClass}`} />

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="w-6 h-6 shrink-0 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      >
        {theme === 'light' ? <MoonIcon /> : <SunIcon />}
      </button>
    </header>
  );
}
