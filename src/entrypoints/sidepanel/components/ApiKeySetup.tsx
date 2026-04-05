import { useState } from 'react';

interface Props {
  onSave: (key: string) => void;
}

export function ApiKeySetup({ onSave }: Props) {
  const [input, setInput] = useState('');

  const handleSave = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSave(trimmed);
  };

  return (
    <div className="flex flex-col items-center px-6 pt-8 pb-6 bg-white dark:bg-slate-950 min-h-[300px]">

      {/* Logo with glow */}
      <div className="relative flex items-center justify-center mb-5">
        <div className="absolute w-16 h-16 rounded-full bg-sky-500/20 blur-xl pointer-events-none" />
        <div className="relative w-11 h-11 rounded-xl bg-gradient-to-br from-sky-600 to-sky-400 shadow-[0_0_24px_rgba(14,165,233,0.45)]" />
      </div>

      {/* Title */}
      <h2 className="text-[15px] font-bold text-slate-800 dark:text-slate-100 mb-1">
        Opticlick Engine
      </h2>

      {/* Engine badge */}
      <span className="font-mono text-[9px] tracking-[1.5px] uppercase text-sky-500 border border-sky-800 bg-sky-950/50 px-2 py-[3px] rounded mb-4">
        AI Web Agent
      </span>

      <p className="text-[11.5px] text-slate-500 dark:text-slate-400 text-center leading-relaxed mb-5 max-w-[220px]">
        Enter your{' '}
        <strong className="font-semibold text-slate-700 dark:text-slate-200">Gemini API key</strong>{' '}
        to get started. Get one free at{' '}
        <span className="text-sky-400 font-medium underline decoration-sky-800 cursor-pointer">
          aistudio.google.com
        </span>
      </p>

      <input
        className="w-full px-3 py-2.5 mb-3 border border-slate-200 dark:border-slate-700 rounded-lg text-[12.5px] font-mono bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none transition-[border-color,box-shadow] focus:border-sky-600 focus:ring-2 focus:ring-sky-600/20"
        type="password"
        placeholder="AIza…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        autoFocus
      />

      <button
        className="w-full py-2.5 bg-gradient-to-r from-sky-700 to-sky-500 text-white text-[13px] font-semibold rounded-lg shadow-[0_2px_14px_rgba(14,165,233,0.4)] transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={!input.trim()}
        onClick={handleSave}
      >
        Save &amp; Continue
      </button>
    </div>
  );
}
