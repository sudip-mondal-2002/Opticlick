interface Props {
  isRunning: boolean;
  onRun: () => void;
  onStop: () => void;
}

export function ControlButtons({ isRunning, onRun, onStop }: Props) {
  return (
    <div className="flex gap-2 px-4 py-3 bg-sky-50 dark:bg-slate-950">
      <button
        className="flex-1 py-2.5 text-[13px] font-semibold tracking-[0.1px] rounded-[9px] text-white bg-gradient-to-r from-sky-700 via-sky-500 to-sky-400 shadow-[0_2px_12px_rgba(14,165,233,0.35)] transition-[opacity,box-shadow,transform] hover:shadow-[0_4px_18px_rgba(14,165,233,0.5)] hover:opacity-95 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
        disabled={isRunning}
        onClick={onRun}
      >
        &#9654;&nbsp; Run Agent
      </button>

      <button
        className="flex-1 py-2.5 text-[13px] font-semibold tracking-[0.1px] rounded-[9px] text-rose-500 dark:text-rose-400 bg-white dark:bg-slate-900 border-[1.5px] border-rose-200 dark:border-rose-900 shadow-[0_1px_3px_rgba(244,63,94,0.08)] transition-[background,opacity,transform] hover:bg-rose-50 dark:hover:bg-rose-950/40 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={!isRunning}
        onClick={onStop}
      >
        &#9632;&nbsp; Stop
      </button>
    </div>
  );
}
