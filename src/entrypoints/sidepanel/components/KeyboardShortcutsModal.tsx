interface ShortcutRow {
  shortcut: string;
  action: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { shortcut: 'Enter', action: 'Run task' },
  { shortcut: 'Shift+Enter', action: 'New line' },
  { shortcut: 'Ctrl/Cmd+.', action: 'Stop' },
  { shortcut: 'Ctrl/Cmd+,', action: 'Settings' },
  { shortcut: 'Ctrl/Cmd+H', action: 'History' },
  { shortcut: 'Ctrl/Cmd+T', action: 'Templates' },
  { shortcut: 'Ctrl/Cmd+L', action: 'New Chat' },
  { shortcut: 'Ctrl/Cmd+K', action: 'Focus Input' },
  { shortcut: 'Esc', action: 'Close Overlay' },
  { shortcut: 'Ctrl/Cmd+/', action: 'Help' },
];

interface Props {
  onClose: () => void;
}

export function KeyboardShortcutsModal({ onClose }: Props) {
  return (
    <div
      className="absolute inset-0 z-40 flex flex-col bg-white dark:bg-slate-950"
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-shortcuts-title"
    >
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800">
        <h2
          id="keyboard-shortcuts-title"
          className="flex-1 text-[12px] font-semibold text-slate-700 dark:text-slate-200"
        >
          Keyboard Shortcuts
        </h2>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-[11px] font-medium transition-colors"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Shortcut</th>
                <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Action</th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map((row) => (
                <tr
                  key={row.shortcut}
                  className="border-b border-slate-100 dark:border-slate-800 last:border-b-0"
                >
                  <td className="px-3 py-2.5 text-[11px] font-mono text-slate-700 dark:text-slate-200 whitespace-nowrap">
                    {row.shortcut}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                    {row.action}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
