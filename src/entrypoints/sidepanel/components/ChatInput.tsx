import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { AttachedFile, PromptTemplate } from '@/utils/types';

interface Props {
  isRunning: boolean;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onRun: (prompt: string, attachments: AttachedFile[]) => void;
  onStop: () => void;
  injectedPrompt?: string | null;
  onClearInjectedPrompt?: () => void;
  templates?: PromptTemplate[];
  onSaveTemplate?: (name: string, prompt: string) => void;
}

function PaperclipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.14v14l11-7-11-7z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function readFileAsBase64(file: File): Promise<{ data: string; previewUrl?: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const data = dataUrl.split(',')[1];
      const previewUrl = file.type.startsWith('image/') ? dataUrl : undefined;
      resolve({ data, previewUrl });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

type AttachmentItem = AttachedFile & { previewUrl?: string };

export function ChatInput({
  isRunning,
  isPaused,
  onPause,
  onResume,
  textareaRef,
  onRun,
  onStop,
  injectedPrompt,
  onClearInjectedPrompt,
  templates = [],
  onSaveTemplate,
}: Props) {
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle injected prompt from templates
  useEffect(() => {
    if (injectedPrompt) {
      setPrompt(injectedPrompt);
      textareaRef.current?.focus();
      onClearInjectedPrompt?.();
    }
  }, [injectedPrompt, onClearInjectedPrompt, textareaRef]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const results = await Promise.all(
      Array.from(files).map(async (f) => {
        const { data, previewUrl } = await readFileAsBase64(f);
        return { name: f.name, mimeType: f.type || 'application/octet-stream', data, previewUrl };
      }),
    );
    setAttachments((prev) => [...prev, ...results]);
  }, []);

  const handleRun = () => {
    const trimmed = prompt.trim();
    if (!trimmed || isRunning || isPaused) return;
    const pending = attachments.map(({ name, mimeType, data }) => ({ name, mimeType, data }));
    setPrompt('');
    setAttachments([]);
    setShowSlashMenu(false);
    onRun(trimmed, pending);
  };

  const handleSaveTemplate = () => {
    const trimmedName = saveName.trim();
    if (!trimmedName || !prompt.trim() || !onSaveTemplate) return;
    onSaveTemplate(trimmedName, prompt);
    setSaveName('');
    setShowSaveForm(false);
  };

  // Handle slash menu filtering and selection
  const slashQuery = prompt.slice(1).split(' ')[0].toLowerCase();
  const slashMatches = useMemo(() => {
    if (!showSlashMenu) return [];
    return templates.filter((t) =>
      t.name.toLowerCase().includes(slashQuery),
    );
  }, [showSlashMenu, slashQuery, templates]);

  const handleSelectTemplate = (template: PromptTemplate) => {
    setPrompt(template.prompt);
    setShowSlashMenu(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle slash menu navigation
    if (showSlashMenu && slashMatches.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i === 0 ? slashMatches.length - 1 : i - 1));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i === slashMatches.length - 1 ? 0 : i + 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSelectTemplate(slashMatches[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

    // Handle normal enter to submit
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRun();
    }
  };

  useEffect(() => {
    // Check for slash menu trigger
    if (prompt === '/' || (prompt.startsWith('/ ') && prompt.length > 2)) {
      setShowSlashMenu(true);
      setSelectedIndex(0);
    } else if (prompt.length <= 1 || !prompt.startsWith('/')) {
      setShowSlashMenu(false);
    }
  }, [prompt]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (imageFiles.length > 0) {
      e.preventDefault();
      await addFiles(imageFiles);
    }
  }, [addFiles]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      addFiles(e.target.files);
      e.target.value = '';
    }
  };

  const removeAttachment = (index: number) =>
    setAttachments((prev) => prev.filter((_, i) => i !== index));

  return (
    <div className="shrink-0 px-3 pt-2 pb-3 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800">
      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attachments.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-[7px] text-[11px] text-slate-600 dark:text-slate-300 max-w-[160px]"
            >
              {file.previewUrl ? (
                <img src={file.previewUrl} alt="" className="w-5 h-5 rounded object-cover shrink-0" />
              ) : (
                <PaperclipIcon />
              )}
              <span className="truncate">{file.name}</span>
              <button
                onClick={() => removeAttachment(i)}
                className="shrink-0 text-slate-400 hover:text-rose-500 transition-colors leading-none ml-0.5"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Save template form */}
      {showSaveForm && (
        <div className="mb-2 p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[8px] space-y-2">
          <input
            autoFocus
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Template name…"
            className="w-full px-2.5 py-1.5 text-[12px] border border-slate-200 dark:border-slate-700 rounded-[6px] bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSaveTemplate();
              }
            }}
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowSaveForm(false); setSaveName(''); }}
              className="px-2.5 py-1 text-[11px] font-medium rounded-[6px] border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveTemplate}
              disabled={!saveName.trim()}
              className="px-2.5 py-1 text-[11px] font-medium rounded-[6px] bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-40 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Textarea container with slash menu */}
      <div ref={containerRef} className="relative">
        <textarea
          ref={textareaRef}
          rows={3}
          className="w-full min-h-[64px] max-h-[140px] resize-none px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-[12.5px] text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 leading-[1.5] outline-none font-sans transition-[border-color,box-shadow] focus:border-sky-600 focus:ring-2 focus:ring-sky-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={isRunning || isPaused}
          placeholder="Describe a task… (Enter to run, Shift+Enter for newline, / for templates)"
        />

        {/* Slash menu dropdown */}
        {showSlashMenu && slashMatches.length > 0 && (
          <div className="absolute left-0 right-0 bottom-full mb-1 z-50 rounded-[6px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-[0_4px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.4)] overflow-hidden max-h-[200px] overflow-y-auto">
            {slashMatches.map((template, i) => (
              <button
                key={template.id}
                onClick={() => handleSelectTemplate(template)}
                className={`w-full text-left px-3 py-2 text-[12px] border-b border-slate-100 dark:border-slate-800 last:border-b-0 transition-colors ${
                  i === selectedIndex
                    ? 'bg-sky-100 dark:bg-sky-950/40 text-slate-800 dark:text-slate-100'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <p className="font-medium leading-snug line-clamp-1">{template.name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-500 line-clamp-1 mt-0.5">
                  {template.prompt}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Toolbar row */}
      <div className="flex items-center justify-between mt-2 gap-1.5">
        <div className="flex items-center gap-1.5">
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-[7px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-all hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={isRunning || isPaused}
            onClick={() => fileInputRef.current?.click()}
            title="Attach file"
          >
            <PaperclipIcon />
            Attach
          </button>
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-[7px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-all hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={isRunning || isPaused || !prompt.trim()}
            onClick={() => setShowSaveForm(true)}
            title="Save as template"
          >
            <BookmarkIcon />
            Save
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {isRunning ? (
            <button
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-[7px] text-amber-600 dark:text-amber-400 bg-slate-100 dark:bg-slate-900 border border-amber-200 dark:border-amber-900/60 transition-all hover:bg-amber-50 dark:hover:bg-amber-950/30 active:scale-[0.97]"
              onClick={onPause}
              title="Pause agent"
            >
              {/* Pause Icon */}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
              Pause
            </button>
          ) : isPaused ? (
            <button
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-[7px] text-sky-600 dark:text-sky-400 bg-slate-100 dark:bg-slate-900 border border-sky-200 dark:border-sky-900/60 transition-all hover:bg-sky-50 dark:hover:bg-sky-950/30 active:scale-[0.97]"
              onClick={onResume}
              title="Resume agent"
            >
              <PlayIcon />
              Resume
            </button>
          ) : null}

          {(isRunning || isPaused) ? (
            <button
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-[7px] text-rose-500 dark:text-rose-400 bg-slate-100 dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 transition-all hover:bg-rose-50 dark:hover:bg-rose-950/30 active:scale-[0.97]"
              onClick={onStop}
              title="Stop agent"
            >
              <StopIcon />
              Stop
            </button>
          ) : (
            <>
              <button
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-[7px] text-rose-500 dark:text-rose-400 bg-slate-100 dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 transition-all hover:bg-rose-50 dark:hover:bg-rose-950/30 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
                disabled
                title="Stop agent"
              >
                <StopIcon />
                Stop
              </button>
              <button
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-[7px] text-white bg-gradient-to-r from-sky-700 via-sky-500 to-sky-400 shadow-[0_2px_8px_rgba(14,165,233,0.3)] transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                disabled={!prompt.trim()}
                onClick={handleRun}
                title="Run agent"
              >
                <PlayIcon />
                Run
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
