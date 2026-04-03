interface Props {
  step: number;
  maxSteps?: number;
}

export function StepFooter({ step, maxSteps = 500 }: Props) {
  const pct = Math.min((step / maxSteps) * 100, 100);

  return (
    <div className="bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700/60">
      {/* Progress bar */}
      <div className="w-full h-[2px] bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full bg-gradient-to-r from-sky-600 to-sky-400 rounded-r-full transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Step label */}
      <div className="flex items-center justify-center gap-1.5 py-2">
        <div className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pip-pulse shadow-[0_0_5px_rgba(14,165,233,0.6)]" />
        <span className="text-[10px] font-semibold text-sky-500 tracking-[0.3px]">
          Running
        </span>
        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600 ml-1">
          step {step}/{maxSteps}
        </span>
      </div>
    </div>
  );
}
