interface Props {
  step: number;
  maxSteps?: number;
}

export function StepFooter({ step, maxSteps = 20 }: Props) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-2 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
      <div className="w-[5px] h-[5px] rounded-full bg-gradient-to-br from-sky-500 to-sky-300 shadow-[0_0_5px_rgba(14,165,233,0.5)] animate-pip-pulse" />
      <span className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 tracking-[0.3px]">
        Step {step} of {maxSteps}
      </span>
    </div>
  );
}
