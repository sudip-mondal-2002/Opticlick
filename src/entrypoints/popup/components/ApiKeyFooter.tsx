interface Props {
  maskedKey: string;
  showEdit: boolean;
  keyInput: string;
  onKeyInputChange: (v: string) => void;
  onShowEdit: () => void;
  onSave: () => void;
  onClear: () => void;
  onCancel: () => void;
}

const actionBtn = 'shrink-0 px-2 py-1 text-[10px] font-semibold rounded-[5px] border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

function KeyIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6M15.5 7.5l3 3" />
    </svg>
  );
}

export function ApiKeyFooter({
  maskedKey,
  showEdit,
  keyInput,
  onKeyInputChange,
  onShowEdit,
  onSave,
  onClear,
  onCancel,
}: Props) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800">
      {showEdit ? (
        <>
          <input
            className="flex-1 min-w-0 px-2 py-1 text-[11px] font-mono border border-slate-200 dark:border-slate-700 rounded-[6px] bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 outline-none transition-[border-color] focus:border-sky-600"
            type="password"
            placeholder="New API key…"
            value={keyInput}
            onChange={(e) => onKeyInputChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSave()}
            autoFocus
          />
          <button
            className={`${actionBtn} bg-sky-600 text-white border-sky-600 hover:bg-sky-500`}
            onClick={onSave}
            disabled={!keyInput.trim()}
          >
            Save
          </button>
          <button
            className={`${actionBtn} text-rose-500 dark:text-rose-400 border-rose-200 dark:border-rose-900 bg-slate-50 dark:bg-slate-900 hover:bg-rose-50 dark:hover:bg-rose-950/40`}
            onClick={onClear}
          >
            Remove
          </button>
          <button
            className={`${actionBtn} text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800`}
            onClick={onCancel}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 min-w-0 text-[10px] font-mono text-slate-400 dark:text-slate-600 truncate">
            {maskedKey}
          </span>
          <button
            className={`${actionBtn} flex items-center gap-1 text-sky-500 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-sky-300 dark:hover:border-sky-800`}
            onClick={onShowEdit}
          >
            <KeyIcon />
            Change key
          </button>
        </>
      )}
    </div>
  );
}
