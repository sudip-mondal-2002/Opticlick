import { useState, useRef, useCallback } from 'react';
import type { AttachedFile } from '@/utils/types';

interface Props {
  isRunning: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onRun: (prompt: string, attachments: AttachedFile[]) => void;
  onStop: () => void;
}

function PaperclipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48" />
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

export function ChatInput({ isRunning, textareaRef, onRun, onStop }: Props) {
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if (!trimmed || isRunning) return;
    const pending = attachments.map(({ name, mimeType, data }) => ({ name, mimeType, data }));
    setPrompt('');
    setAttachments([]);
    onRun(trimmed, pending);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRun();
    }
  };

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

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        rows={3}
        className="w-full min-h-[64px] max-h-[140px] resize-none px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-[12.5px] text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 leading-[1.5] outline-none font-sans transition-[border-color,box-shadow] focus:border-sky-600 focus:ring-2 focus:ring-sky-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        disabled={isRunning}
        placeholder="Describe a task… (Enter to run, Shift+Enter for newline)"
      />

      {/* Toolbar row */}
      <div className="flex items-center justify-between mt-2">
        <button
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-[7px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-all hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
          disabled={isRunning}
          onClick={() => fileInputRef.current?.click()}
          title="Attach file"
        >
          <PaperclipIcon />
          Attach
        </button>

        <div className="flex items-center gap-1.5">
          <button
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-[7px] text-rose-500 dark:text-rose-400 bg-slate-100 dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 transition-all hover:bg-rose-50 dark:hover:bg-rose-950/30 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={!isRunning}
            onClick={onStop}
            title="Stop agent"
          >
            <StopIcon />
            Stop
          </button>
          <button
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-[7px] text-white bg-gradient-to-r from-sky-700 via-sky-500 to-sky-400 shadow-[0_2px_8px_rgba(14,165,233,0.3)] transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            disabled={isRunning || !prompt.trim()}
            onClick={handleRun}
            title="Run agent"
          >
            <PlayIcon />
            Run
          </button>
        </div>
      </div>
    </div>
  );
}
