import { useState, useRef, useEffect } from 'react';
import { GEMINI_MODELS, ANTHROPIC_MODELS, OPENAI_MODELS, getModelLabel } from '@/utils/models';
import type { ModelOption, CustomOpenAIConfig } from '@/utils/models';

interface Props {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  ollamaModels: ModelOption[];
  customConfigs: CustomOpenAIConfig[];
  hasGeminiKey: boolean;
  hasAnthropicKey: boolean;
  hasOpenaiKey: boolean;
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-3 py-1 text-[9px] font-semibold tracking-wider uppercase text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800">
      {label}
    </div>
  );
}

// ── Selection color per provider ─────────────────────────────────────────────

function selectedClass(provider: string): string {
  switch (provider) {
    case 'anthropic': return 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-200';
    case 'openai': return 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-200';
    case 'custom-openai': return 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-200';
    case 'ollama': return 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-200';
    default: return 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-200';
  }
}

export function ModelSelector({ selectedModel, onModelChange, ollamaModels, customConfigs, hasGeminiKey, hasAnthropicKey, hasOpenaiKey }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentLabel = getModelLabel(selectedModel, ollamaModels, customConfigs);

  const handleSelect = (modelId: string) => {
    onModelChange(modelId);
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setOpenAbove(window.innerHeight - rect.bottom < 280);
  }, [isOpen]);

  // Build custom model options from configs
  const customModelOptions: ModelOption[] = customConfigs.map((c) => ({
    id: `custom-openai:${c.id}`,
    label: c.name,
    description: `${c.modelName} @ ${new URL(c.baseUrl).hostname}`,
    provider: 'custom-openai' as const,
  }));

  return (
    <div ref={containerRef} className="relative px-3 py-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] font-medium rounded-[6px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 transition-colors gap-2"
      >
        <span className="text-left truncate flex-1 min-w-0">
          <span className="uppercase tracking-[0.5px] text-slate-500 dark:text-slate-500">Model: </span>
          <span className="font-semibold text-slate-800 dark:text-slate-100">{currentLabel}</span>
        </span>
        <div className={`shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          <ChevronIcon />
        </div>
      </button>

      {isOpen && (
        <div
          className={`absolute left-3 right-3 z-50 rounded-[6px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-[0_4px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.4)] overflow-hidden ${
            openAbove ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          <div className="max-h-[320px] overflow-y-auto">
            {/* Gemini */}
            <SectionHeader label="Gemini" />
            {GEMINI_MODELS.map((model) => (
              <ModelItem key={model.id} model={model} selected={selectedModel === model.id} disabled={!hasGeminiKey} disabledReason="API key required" onSelect={handleSelect} />
            ))}

            {/* Claude */}
            <SectionHeader label="Claude" />
            {ANTHROPIC_MODELS.map((model) => (
              <ModelItem key={model.id} model={model} selected={selectedModel === model.id} disabled={!hasAnthropicKey} disabledReason="API key required" onSelect={handleSelect} />
            ))}

            {/* OpenAI */}
            <SectionHeader label="OpenAI" />
            {OPENAI_MODELS.map((model) => (
              <ModelItem key={model.id} model={model} selected={selectedModel === model.id} disabled={!hasOpenaiKey} disabledReason="API key required" onSelect={handleSelect} />
            ))}

            {/* Custom endpoints */}
            {customModelOptions.length > 0 && (
              <>
                <SectionHeader label="Custom" />
                {customModelOptions.map((model) => (
                  <ModelItem key={model.id} model={model} selected={selectedModel === model.id} disabled={false} onSelect={handleSelect} />
                ))}
              </>
            )}

            {/* Ollama */}
            {ollamaModels.length > 0 && (
              <>
                <SectionHeader label="Ollama (Local)" />
                {ollamaModels.map((model) => {
                  const isRunning = model.running === true;
                  return (
                    <button
                      key={model.id}
                      onClick={() => isRunning && handleSelect(model.id)}
                      disabled={!isRunning}
                      className={`w-full px-3 py-2 text-left text-[10px] transition-colors border-b border-slate-100 dark:border-slate-800 last:border-b-0 ${
                        !isRunning
                          ? 'opacity-40 cursor-not-allowed'
                          : selectedModel === model.id
                            ? selectedClass('ollama')
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-semibold leading-tight">
                        {isRunning && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                        )}
                        <span className={isRunning ? '' : 'ml-3'}>{model.label}</span>
                      </div>
                      <div className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                        {isRunning ? model.description : 'not loaded'}
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reusable model item ──────────────────────────────────────────────────────

function ModelItem({ model, selected, disabled, disabledReason, onSelect }: {
  model: ModelOption;
  selected: boolean;
  disabled: boolean;
  disabledReason?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => !disabled && onSelect(model.id)}
      disabled={disabled}
      className={`w-full px-3 py-2 text-left text-[10px] transition-colors border-b border-slate-100 dark:border-slate-800 last:border-b-0 ${
        disabled
          ? 'opacity-40 cursor-not-allowed'
          : selected
            ? selectedClass(model.provider)
            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
      }`}
    >
      <div className="font-semibold leading-tight">{model.label}</div>
      <div className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
        {disabled && disabledReason ? disabledReason : model.description}
      </div>
    </button>
  );
}
