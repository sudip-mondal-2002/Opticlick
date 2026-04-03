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
    <div className="flex items-center gap-1.5 px-4 py-2 bg-sky-50/80 dark:bg-slate-950 border-t border-sky-100 dark:border-slate-800">
      {showEdit ? (
        <>
          <input
            className="flex-1 min-w-0 px-2 py-1 text-[11px] font-mono border-[1.5px] border-sky-200 dark:border-slate-600 rounded-[6px] bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 outline-none transition-[border-color] focus:border-sky-500"
            type="password"
            placeholder="New API key…"
            value={keyInput}
            onChange={(e) => onKeyInputChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSave()}
            autoFocus
          />
          <button
            className={`${actionBtn} bg-sky-600 text-white border-sky-600 hover:bg-sky-700`}
            onClick={onSave}
            disabled={!keyInput.trim()}
          >
            Save
          </button>
          <button
            className={`${actionBtn} text-rose-500 dark:text-rose-400 border-rose-200 dark:border-rose-900 bg-white dark:bg-slate-900 hover:bg-rose-50 dark:hover:bg-rose-950/40`}
            onClick={onClear}
          >
            Remove
          </button>
          <button
            className={`${actionBtn} text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-900 hover:bg-sky-50 dark:hover:bg-sky-900/30`}
            onClick={onCancel}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 min-w-0 text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate">
            {maskedKey}
          </span>
          <button
            className={`${actionBtn} text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-900 hover:bg-sky-50 dark:hover:bg-sky-900/30`}
            onClick={onShowEdit}
          >
            Change key
          </button>
        </>
      )}
    </div>
  );
}
