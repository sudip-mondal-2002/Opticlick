import { useState } from 'react';
import type { CustomOpenAIConfig } from '@/utils/models';

type ProviderChoice = 'gemini' | 'anthropic' | 'openai' | 'custom';

interface Props {
  onSave: (provider: 'gemini' | 'anthropic' | 'openai', key: string) => void;
  onSaveCustom: (config: CustomOpenAIConfig) => void;
}

const CLOUD_PROVIDERS: { value: 'gemini' | 'anthropic' | 'openai'; label: string; placeholder: string; hint: string }[] = [
  { value: 'gemini',    label: 'Gemini', placeholder: 'AIza...',    hint: 'aistudio.google.com'   },
  { value: 'anthropic', label: 'Claude', placeholder: 'sk-ant-...', hint: 'console.anthropic.com' },
  { value: 'openai',    label: 'OpenAI', placeholder: 'sk-...',     hint: 'platform.openai.com'   },
];

export function ApiKeySetup({ onSave, onSaveCustom }: Props) {
  const [provider, setProvider] = useState<ProviderChoice>('gemini');
  const [input, setInput] = useState('');

  // Custom endpoint fields
  const [customName, setCustomName]       = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customModel, setCustomModel]     = useState('');
  const [customApiKey, setCustomApiKey]   = useState('');

  const currentCloud = CLOUD_PROVIDERS.find((p) => p.value === provider);

  const handleSave = () => {
    if (provider === 'custom') {
      if (!customBaseUrl.trim() || !customModel.trim()) return;
      onSaveCustom({
        id: crypto.randomUUID(),
        name: customName.trim() || customBaseUrl.trim(),
        baseUrl: customBaseUrl.trim(),
        apiKey: customApiKey.trim() || undefined,
        modelName: customModel.trim(),
      });
    } else {
      const trimmed = input.trim();
      if (!trimmed) return;
      onSave(provider, trimmed);
    }
  };

  const isCustomSaveDisabled = !customBaseUrl.trim() || !customModel.trim();
  const isSaveDisabled = provider === 'custom' ? isCustomSaveDisabled : !input.trim();

  const switchProvider = (p: ProviderChoice) => {
    setProvider(p);
    setInput('');
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

      <p className="text-[11.5px] text-slate-500 dark:text-slate-400 text-center leading-relaxed mb-4 max-w-[240px]">
        Enter an API key for any supported provider to get started.
      </p>

      {/* Provider tabs — 2×2 grid */}
      <div className="w-full grid grid-cols-2 gap-1 mb-3">
        {[...CLOUD_PROVIDERS, { value: 'custom' as const, label: 'Custom URL' }].map((p) => (
          <button
            key={p.value}
            onClick={() => switchProvider(p.value)}
            className={`py-1.5 text-[11px] font-semibold rounded-[6px] border transition-colors ${
              provider === p.value
                ? p.value === 'custom'
                  ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-300'
                  : 'border-sky-500 bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Cloud provider: single API key input */}
      {provider !== 'custom' && currentCloud && (
        <>
          <input
            className="w-full px-3 py-2.5 mb-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[12.5px] font-mono bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none transition-[border-color,box-shadow] focus:border-sky-600 focus:ring-2 focus:ring-sky-600/20"
            type="password"
            placeholder={currentCloud.placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            autoFocus
          />
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-3 self-start">
            Get a key at{' '}
            <span className="text-sky-400 font-medium">{currentCloud.hint}</span>
          </p>
        </>
      )}

      {/* Custom endpoint form */}
      {provider === 'custom' && (
        <div className="w-full space-y-2 mb-3">
          <input
            className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-[12px] bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
            placeholder="Base URL  (e.g. http://localhost:8000/v1)"
            value={customBaseUrl}
            onChange={(e) => setCustomBaseUrl(e.target.value)}
            autoFocus
          />
          <input
            className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-[12px] bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
            placeholder="Model name  (e.g. meta-llama/Llama-3-70b)"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
          />
          <input
            className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-[12px] font-mono bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
            type="password"
            placeholder="API key  (optional)"
            value={customApiKey}
            onChange={(e) => setCustomApiKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <input
            className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-[12px] bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
            placeholder="Display name  (optional)"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
          />
          <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
            Compatible with vLLM, Ollama (OpenAI mode), LM Studio, Groq, Together, and any OpenAI-compatible API.
          </p>
        </div>
      )}

      <button
        className={`w-full py-2.5 text-white text-[13px] font-semibold rounded-lg transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${
          provider === 'custom'
            ? 'bg-gradient-to-r from-purple-700 to-purple-500 shadow-[0_2px_14px_rgba(147,51,234,0.4)]'
            : 'bg-gradient-to-r from-sky-700 to-sky-500 shadow-[0_2px_14px_rgba(14,165,233,0.4)]'
        }`}
        disabled={isSaveDisabled}
        onClick={handleSave}
      >
        Save &amp; Continue
      </button>

      <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center mt-4 leading-relaxed">
        Or use a local model with{' '}
        <span className="font-semibold text-slate-500 dark:text-slate-400">Ollama</span>{' '}
        at localhost:11434
      </p>
    </div>
  );
}
