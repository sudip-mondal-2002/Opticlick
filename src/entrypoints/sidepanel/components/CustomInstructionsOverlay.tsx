import { useState, useEffect } from 'react';
import {
  getCustomSystemPrompt,
  setCustomSystemPrompt,
  type CustomSystemPrompt,
} from '@/utils/custom-system-prompt';
import { buildSystemMessage } from '@/utils/llm';

const MAX_CHARS = 4000;

// ── Icon helpers ──────────────────────────────────────────────────────────────

function SliderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// ── Preview modal ─────────────────────────────────────────────────────────────

interface PreviewModalProps {
  onClose: () => void;
}

function PreviewModal({ onClose }: PreviewModalProps) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    buildSystemMessage().then(setText);
  }, []);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-slate-950/80 backdrop-blur-sm">
      <div className="absolute inset-4 flex flex-col bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">
        {/* Modal header */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
          <EyeIcon />
          <span className="flex-1 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
            Preview — Combined System Prompt
          </span>
          <button
            onClick={onClose}
            className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-medium transition-colors"
          >
            Close
          </button>
        </div>

        {/* Note */}
        <div className="shrink-0 px-4 py-2 bg-sky-50 dark:bg-sky-950/30 border-b border-sky-100 dark:border-sky-900/40 text-[10px] text-sky-600 dark:text-sky-400">
          This is the exact text that will be sent to the LLM as its system instructions.
          Security rails (§9–§10) are always at the end.
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4">
          {text === null ? (
            <div className="text-[11px] text-slate-400 animate-pulse">Assembling prompt…</div>
          ) : (
            <pre className="text-[10px] leading-relaxed text-slate-600 dark:text-slate-300 font-mono whitespace-pre-wrap break-words">
              {text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
}

function Toggle({ checked, onChange, id }: ToggleProps) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
        checked ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-700'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function CustomInstructionsOverlay({ onClose }: Props) {
  const [config, setConfig] = useState<CustomSystemPrompt>({
    enabled: false,
    content: '',
    insertPosition: 'prepend',
  });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Load from storage on mount
  useEffect(() => {
    getCustomSystemPrompt().then((stored) => {
      setConfig(stored);
      setLoading(false);
    });
  }, []);

  const charCount = config.content.length;
  const isOverLimit = charCount > MAX_CHARS;
  const isEffective = config.enabled && config.content.trim().length > 0;

  const handleSave = async () => {
    if (isOverLimit) return;
    await setCustomSystemPrompt(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleContentChange = (v: string) => {
    // Allow typing beyond limit so user can see the counter turn red, but cap paste
    setConfig((prev) => ({ ...prev, content: v }));
    setSaved(false);
  };

  if (loading) return null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-slate-950">
      {showPreview && <PreviewModal onClose={() => setShowPreview(false)} />}

      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800">
        <SliderIcon />
        <span className="flex-1 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
          Custom Instructions
        </span>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-[11px] font-medium transition-colors"
        >
          Close
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Enable / disable toggle */}
        <div className="flex items-center justify-between px-3 py-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
          <div className="space-y-0.5">
            <div className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
              Enable custom instructions
            </div>
            <div className="text-[10px] text-slate-400 dark:text-slate-500">
              {isEffective
                ? 'Active — instructions are being sent to the agent'
                : config.enabled
                ? 'Toggle is on but no content is saved yet'
                : 'Disabled — only built-in instructions will be used'}
            </div>
          </div>
          <Toggle
            id="custom-instructions-toggle"
            checked={config.enabled}
            onChange={(v) => { setConfig((prev) => ({ ...prev, enabled: v })); setSaved(false); }}
          />
        </div>

        {/* Insert position */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
            <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              Insert position
            </div>
            <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
              Security rails (§9–§10) always appear last regardless of this setting.
            </div>
          </div>
          <div className="px-3 py-3 space-y-2">
            {(['prepend', 'append'] as const).map((pos) => (
              <label
                key={pos}
                htmlFor={`position-${pos}`}
                className="flex items-start gap-2.5 cursor-pointer group"
              >
                <input
                  id={`position-${pos}`}
                  type="radio"
                  name="insertPosition"
                  value={pos}
                  checked={config.insertPosition === pos}
                  onChange={() => { setConfig((prev) => ({ ...prev, insertPosition: pos })); setSaved(false); }}
                  className="mt-0.5 accent-sky-500"
                />
                <div>
                  <div className="text-[11px] font-medium text-slate-700 dark:text-slate-200 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                    {pos === 'prepend' ? 'Before built-in instructions' : 'After built-in instructions'}
                  </div>
                  <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-[2px]">
                    {pos === 'prepend'
                      ? 'Your instructions → Core agent rules → Security rails'
                      : 'Core agent rules → Your instructions → Security rails'}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Textarea */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
            <div className="flex-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              Your instructions
            </div>
            <span
              className={`text-[10px] font-mono tabular-nums transition-colors ${
                isOverLimit
                  ? 'text-rose-500 font-semibold'
                  : charCount > MAX_CHARS * 0.9
                  ? 'text-amber-500'
                  : 'text-slate-400'
              }`}
            >
              {charCount} / {MAX_CHARS}
            </span>
          </div>
          <div className="p-3">
            <textarea
              id="custom-instructions-textarea"
              rows={10}
              value={config.content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder={`Examples:\n• "Only interact with GitHub and Linear."\n• "My default coding language is Python 3.12."\n• "Always write summaries in a formal, concise tone."`}
              className={`w-full resize-none text-[11px] font-mono leading-relaxed bg-transparent text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none transition-colors ${
                isOverLimit ? 'text-rose-500' : ''
              }`}
            />
          </div>
        </div>

        {isOverLimit && (
          <p className="text-[10px] text-rose-500 font-medium">
            Exceeds {MAX_CHARS}-character limit. Please shorten your instructions before saving.
          </p>
        )}

        {/* Preview link */}
        <button
          onClick={() => setShowPreview(true)}
          className="flex items-center gap-1.5 text-[11px] text-sky-500 hover:text-sky-600 dark:hover:text-sky-400 font-medium transition-colors"
          id="preview-combined-prompt-btn"
        >
          <EyeIcon />
          Preview combined prompt
        </button>

        <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
          Custom instructions are stored locally and only sent to the LLM as part of its system
          context. The built-in security and safety sections always appear last and cannot be
          overridden.
        </p>
      </div>

      {/* Footer */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-[11px] font-semibold rounded-[6px] border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          Cancel
        </button>
        <button
          id="save-custom-instructions-btn"
          onClick={handleSave}
          disabled={isOverLimit}
          className={`flex-1 py-1.5 text-[11px] font-semibold rounded-[6px] transition-all duration-200 ${
            saved
              ? 'bg-emerald-500 text-white'
              : isOverLimit
              ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
              : 'bg-sky-600 hover:bg-sky-500 text-white'
          }`}
        >
          {saved ? '✓ Saved' : 'Save instructions'}
        </button>
      </div>
    </div>
  );
}
