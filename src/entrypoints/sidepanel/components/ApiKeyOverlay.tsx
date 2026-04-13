import { useState } from 'react';
import type { CustomOpenAIConfig } from '@/utils/models';

interface Props {
  geminiApiKey: string | null;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  customConfigs: CustomOpenAIConfig[];
  onSaveKey: (provider: 'gemini' | 'anthropic' | 'openai', key: string) => void;
  onClearKey: (provider: 'gemini' | 'anthropic' | 'openai') => void;
  onSaveCustomConfig: (config: CustomOpenAIConfig) => void;
  onDeleteCustomConfig: (configId: string) => void;
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

// ── Reusable provider key card ───────────────────────────────────────────────

interface ProviderKeyCardProps {
  providerName: string;
  providerUrl: string;
  logoSrc: string;
  apiKey: string | null;
  placeholder: string;
  onSave: (key: string) => void;
  onClear: () => void;
}

function ProviderKeyCard({ providerName, providerUrl, logoSrc, apiKey, placeholder, onSave, onClear }: ProviderKeyCardProps) {
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
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
        <div className="w-6 h-6 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
          <img src={logoSrc} width={16} height={16} alt={providerName} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{providerName}</div>
          <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-[1px]">{providerUrl}</div>
        </div>
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
              placeholder={placeholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              autoFocus={!apiKey}
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
  );
}

// ── Custom endpoint section ──────────────────────────────────────────────────

interface CustomEndpointSectionProps {
  configs: CustomOpenAIConfig[];
  onSave: (config: CustomOpenAIConfig) => void;
  onDelete: (configId: string) => void;
}

function CustomEndpointSection({ configs, onSave, onDelete }: CustomEndpointSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('');

  const handleSave = () => {
    if (!name.trim() || !baseUrl.trim() || !modelName.trim()) return;
    onSave({
      id: crypto.randomUUID(),
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim() || undefined,
      modelName: modelName.trim(),
    });
    setName('');
    setBaseUrl('');
    setApiKey('');
    setModelName('');
    setShowForm(false);
  };

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2.5 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
        <div className="w-6 h-6 rounded-md bg-purple-100 dark:bg-purple-900/40 border border-purple-200 dark:border-purple-800 flex items-center justify-center shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-500">
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Custom Endpoints</div>
          <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-[1px]">OpenAI-compatible APIs</div>
        </div>
        <span className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5">
          {configs.length} endpoint{configs.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="px-3 py-3 space-y-2.5">
        {/* Existing configs */}
        {configs.map((config) => (
          <div key={config.id} className="flex items-center gap-2 px-2.5 py-2 rounded-[6px] bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate">{config.name}</div>
              <div className="text-[9px] text-slate-400 dark:text-slate-500 truncate">{config.modelName} @ {config.baseUrl}</div>
            </div>
            <button
              onClick={() => onDelete(config.id)}
              className="shrink-0 p-1 text-slate-400 hover:text-rose-500 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}

        {/* Add form */}
        {showForm ? (
          <div className="space-y-2 pt-1">
            <input
              className="w-full px-2.5 py-1.5 text-[11px] border border-slate-200 dark:border-slate-700 rounded-[6px] bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20"
              placeholder="Display name (e.g. Together AI)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <input
              className="w-full px-2.5 py-1.5 text-[11px] font-mono border border-slate-200 dark:border-slate-700 rounded-[6px] bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20"
              placeholder="Base URL (e.g. https://api.together.xyz/v1)"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <input
              className="w-full px-2.5 py-1.5 text-[11px] font-mono border border-slate-200 dark:border-slate-700 rounded-[6px] bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20"
              placeholder="Model name (e.g. meta-llama/Llama-3-70b)"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />
            <input
              className="w-full px-2.5 py-1.5 text-[11px] font-mono border border-slate-200 dark:border-slate-700 rounded-[6px] bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20"
              type="password"
              placeholder="API key (optional)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={!name.trim() || !baseUrl.trim() || !modelName.trim()}
                className="flex-1 py-1.5 text-[11px] font-semibold rounded-[6px] bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                Add endpoint
              </button>
              <button
                onClick={() => { setShowForm(false); setName(''); setBaseUrl(''); setApiKey(''); setModelName(''); }}
                className="px-3 py-1.5 text-[11px] font-semibold rounded-[6px] border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full py-1.5 text-[11px] font-semibold rounded-[6px] border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-purple-400 hover:text-purple-500 dark:hover:border-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            + Add endpoint
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main overlay ─────────────────────────────────────────────────────────────

export function ApiKeyOverlay({
  geminiApiKey,
  anthropicApiKey,
  openaiApiKey,
  customConfigs,
  onSaveKey,
  onClearKey,
  onSaveCustomConfig,
  onDeleteCustomConfig,
  onClose,
}: Props) {
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
        <ProviderKeyCard
          providerName="Gemini API"
          providerUrl="aistudio.google.com"
          logoSrc="/logos/gemini-color.svg"
          apiKey={geminiApiKey}
          placeholder="AIza..."
          onSave={(key) => onSaveKey('gemini', key)}
          onClear={() => onClearKey('gemini')}
        />

        <ProviderKeyCard
          providerName="Claude API"
          providerUrl="console.anthropic.com"
          logoSrc="/logos/claude-color.svg"
          apiKey={anthropicApiKey}
          placeholder="sk-ant-..."
          onSave={(key) => onSaveKey('anthropic', key)}
          onClear={() => onClearKey('anthropic')}
        />

        <ProviderKeyCard
          providerName="OpenAI API"
          providerUrl="platform.openai.com"
          logoSrc="/logos/openai-color.svg"
          apiKey={openaiApiKey}
          placeholder="sk-..."
          onSave={(key) => onSaveKey('openai', key)}
          onClear={() => onClearKey('openai')}
        />

        <CustomEndpointSection
          configs={customConfigs}
          onSave={onSaveCustomConfig}
          onDelete={onDeleteCustomConfig}
        />

        <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center leading-relaxed px-2">
          Keys are stored locally in your browser and never sent anywhere except the respective API endpoint.
        </p>
      </div>
    </div>
  );
}
