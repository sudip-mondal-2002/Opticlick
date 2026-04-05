import { useState } from 'react';

interface Props {
  apiKey: string | null;
  onSave: (key: string) => void;
  onClear: () => void;
  onClose: () => void;
}

function KeyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6M15.5 7.5l3 3" />
    </svg>
  );
}


export function ApiKeyOverlay({ apiKey, onSave, onClear, onClose }: Props) {
  const [editing, setEditing] = useState(!apiKey);
  const [input, setInput] = useState('');

  const handleSave = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setInput('');
    setEditing(false);
  };

  const handleClear = () => {
    onClear();
    setEditing(true);
    setInput('');
  };

  const handleCancel = () => {
    setInput('');
    setEditing(false);
  };

  const maskedKey = apiKey ? apiKey.slice(0, 8) + '••••••••••••' : null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-slate-950">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800">
        <KeyIcon />
        <span className="flex-1 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
          API Keys
        </span>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-[11px] font-medium transition-colors"
        >
          Close
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Gemini card */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          {/* Card header */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
            <div className="w-6 h-6 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
              <img src="/logos/gemini-color.svg" width={16} height={16} alt="Gemini" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Gemini API</div>
              <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-[1px]">aistudio.google.com</div>
            </div>
            {/* Status badge */}
            {apiKey ? (
              <span className="flex items-center gap-1 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded px-1.5 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Connected
              </span>
            ) : (
              <span className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5">
                Not set
              </span>
            )}
          </div>

          {/* Card body */}
          <div className="px-3 py-3 space-y-2.5">
            {editing ? (
              <>
                <input
                  className="w-full px-2.5 py-2 text-[12px] font-mono border border-slate-200 dark:border-slate-700 rounded-[6px] bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none transition-[border-color,box-shadow] focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                  type="password"
                  placeholder="AIza…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={!input.trim()}
                    className="flex-1 py-1.5 text-[11px] font-semibold rounded-[6px] bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                  >
                    Save key
                  </button>
                  {apiKey && (
                    <button
                      onClick={handleCancel}
                      className="px-3 py-1.5 text-[11px] font-semibold rounded-[6px] border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="font-mono text-[11px] text-slate-400 dark:text-slate-500 truncate">
                  {maskedKey}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(true)}
                    className="flex-1 py-1.5 text-[11px] font-semibold rounded-[6px] border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    Change key
                  </button>
                  <button
                    onClick={handleClear}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-[6px] border border-rose-200 dark:border-rose-900 text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center leading-relaxed px-2">
          Keys are stored locally in your browser and never sent anywhere except the respective API endpoint.
        </p>
      </div>
    </div>
  );
}
