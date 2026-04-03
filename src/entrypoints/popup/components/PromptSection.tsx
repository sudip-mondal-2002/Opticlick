interface Props {
  prompt: string;
  onPromptChange: (v: string) => void;
  disabled: boolean;
}

export function PromptSection({ prompt, onPromptChange, disabled }: Props) {
  return (
    <div className="px-4 pt-3.5 bg-sky-50 dark:bg-slate-950">
      <textarea
        className="w-full min-h-[82px] max-h-[160px] resize-y px-3 py-2.5 bg-white dark:bg-slate-900 border-[1.5px] border-sky-200 dark:border-slate-600 rounded-[10px] text-[13px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 leading-[1.55] outline-none shadow-[0_1px_3px_rgba(14,165,233,0.06)] transition-[border-color,box-shadow] focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        disabled={disabled}
        placeholder="Describe the task… e.g. 'Create a GitHub issue titled Bug: login fails'"
      />
    </div>
  );
}
