interface Props {
  prompt: string;
  onPromptChange: (v: string) => void;
  disabled: boolean;
}

export function PromptSection({ prompt, onPromptChange, disabled }: Props) {
  return (
    <div className="px-3 pt-3 pb-0 bg-white dark:bg-slate-950">
      <label className="block text-[9px] font-bold tracking-[1.2px] uppercase text-sky-600 mb-1.5 px-0.5">
        Task Prompt
      </label>
      <textarea
        className="w-full min-h-[82px] max-h-[150px] resize-y px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-[12.5px] text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 leading-[1.6] outline-none font-sans transition-[border-color,box-shadow] focus:border-sky-600 focus:ring-2 focus:ring-sky-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        disabled={disabled}
        placeholder={'Describe the task…\ne.g. "Book the cheapest flight from NYC to London next week"'}
      />
    </div>
  );
}
