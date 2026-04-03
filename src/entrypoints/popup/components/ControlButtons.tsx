interface Props {
  isRunning: boolean;
  onRun: () => void;
  onStop: () => void;
}

function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.14v14l11-7-11-7z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

export function ControlButtons({ isRunning, onRun, onStop }: Props) {
  return (
    <div className="flex gap-2 px-3 pt-2.5 pb-0 bg-white dark:bg-slate-950">
      <button
        className="flex-1 flex items-center justify-center gap-2 py-2.5 text-[12.5px] font-semibold tracking-[0.1px] rounded-[9px] text-white bg-gradient-to-r from-sky-700 via-sky-500 to-sky-400 shadow-[0_2px_12px_rgba(14,165,233,0.3)] transition-all hover:shadow-[0_4px_18px_rgba(14,165,233,0.5)] hover:brightness-105 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
        disabled={isRunning}
        onClick={onRun}
      >
        <PlayIcon />
        Run Agent
      </button>

      <button
        className="flex items-center justify-center gap-2 px-4 py-2.5 text-[12.5px] font-semibold tracking-[0.1px] rounded-[9px] text-rose-500 dark:text-rose-400 bg-slate-100 dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 transition-all hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:border-rose-300 dark:hover:border-rose-800 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={!isRunning}
        onClick={onStop}
      >
        <StopIcon />
        Stop
      </button>
    </div>
  );
}
