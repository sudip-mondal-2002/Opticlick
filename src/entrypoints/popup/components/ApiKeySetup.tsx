interface Props {
  keyInput: string;
  onKeyInputChange: (v: string) => void;
  onSave: () => void;
}

export function ApiKeySetup({ keyInput, onKeyInputChange, onSave }: Props) {
  return (
    <div className="flex flex-col items-center px-6 pt-7 pb-6 bg-white dark:bg-slate-900 min-h-[280px]">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-600 to-sky-400 shadow-[0_0_18px_rgba(14,165,233,0.35)] mb-3.5 shrink-0" />

      <h2 className="text-[15px] font-bold text-slate-900 dark:text-slate-100 mb-2">
        Opticlick Engine
      </h2>

      <p className="text-xs text-slate-500 dark:text-slate-400 text-center leading-relaxed mb-5">
        Enter your{' '}
        <strong className="font-semibold text-slate-700 dark:text-slate-300">
          Gemini API key
        </strong>{' '}
        to get started. Get one free at{' '}
        <span className="text-sky-600 dark:text-sky-400 font-medium">
          aistudio.google.com
        </span>
      </p>

      <input
        className="w-full px-3 py-2.5 mb-2.5 border-[1.5px] border-sky-200 dark:border-slate-600 rounded-lg text-[13px] font-mono bg-sky-50/60 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-[border-color,box-shadow] focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
        type="password"
        placeholder="AIza…"
        value={keyInput}
        onChange={(e) => onKeyInputChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSave()}
        autoFocus
      />

      <button
        className="w-full py-2.5 bg-gradient-to-r from-sky-700 to-sky-500 text-white text-[13px] font-semibold rounded-lg shadow-[0_2px_10px_rgba(14,165,233,0.3)] transition-opacity hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={!keyInput.trim()}
        onClick={onSave}
      >
        Save &amp; Continue
      </button>
    </div>
  );
}
