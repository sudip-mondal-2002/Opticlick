import { useState } from 'react';
import type { RefObject } from 'react';
import ReactMarkdown from 'react-markdown';

export interface LogItem {
  message: string;
  level: string;
}

export interface HistoryStep {
  kind: 'think' | 'act' | 'done' | 'prompt' | 'observe' | 'screenshot';
  text: string;
}

function parseLine(message: string): { ts: string; body: string } {
  const match = message.match(/^\[([^\]]+)\]\s*(.*)/s);
  if (!match) return { ts: '', body: message };
  return { ts: match[1], body: match[2] };
}

const tagMap: Record<string, { label: string; className: string }> = {
  think:      { label: '[THINK]',   className: 'text-sky-400' },
  act:        { label: '[ACT]',     className: 'text-amber-400' },
  observe:    { label: '[OBSERVE]', className: 'text-emerald-400' },
  screenshot: { label: '[SNAP]',    className: 'text-violet-600 dark:text-violet-400' },
  error:      { label: '[ERR]',     className: 'text-rose-400' },
  info:       { label: '[THINK]',   className: 'text-sky-400' },
  ok:         { label: '[OBSERVE]', className: 'text-emerald-400' },
  warn:       { label: '[ACT]',     className: 'text-amber-400' },
};

const historyStepStyle: Record<string, { label: string; className: string }> = {
  think:      { label: '[THINK]',   className: 'text-sky-400/60' },
  act:        { label: '[ACT]',     className: 'text-amber-400/60' },
  done:       { label: '[DONE]',    className: 'text-emerald-400/60' },
  prompt:     { label: '[TASK]',    className: 'text-violet-400/60' },
  observe:    { label: '[OBSERVE]', className: 'text-emerald-400/60' },
  screenshot: { label: '[SNAP]',    className: 'text-violet-400/60' },
};

function ScreenshotModal({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" onClick={onClose}>
      <div
        className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-700 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-2 font-mono text-[10px] text-slate-500">page snapshot</span>
        </div>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-300 font-mono text-[11px] transition-colors">
          [esc]
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="Page snapshot" className="w-full rounded border border-slate-700/60" />
      </div>
      <div className="shrink-0 py-1.5 text-center">
        <span className="font-mono text-[9px] text-slate-700">click outside to close</span>
      </div>
    </div>
  );
}

interface Props {
  feedRef: RefObject<HTMLDivElement | null>;
  historySteps: HistoryStep[];
  submittedPrompt: string | null;
  logs: LogItem[];
}

export function ChatFeed({ feedRef, historySteps, submittedPrompt, logs }: Props) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const handleScreenshotClick = async () => {
    const { lastScreenshot } = await chrome.storage.session.get('lastScreenshot') as { lastScreenshot?: string };
    if (lastScreenshot) setPreviewSrc(`data:image/png;base64,${lastScreenshot}`);
  };

  return (
    <>
      {previewSrc && <ScreenshotModal src={previewSrc} onClose={() => setPreviewSrc(null)} />}

      <div ref={feedRef} className="flex-1 overflow-y-auto log-scroll px-3 py-3 min-h-0 space-y-3">

        {/* History section */}
        {historySteps.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
              <span className="text-[9px] font-semibold tracking-[1px] uppercase text-slate-400 dark:text-slate-600">
                Past session
              </span>
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
            </div>
            <div className="font-mono text-[11px] leading-[1.75] space-y-0.5 opacity-70">
              {historySteps.map((step, i) => {
                const style = historyStepStyle[step.kind] ?? historyStepStyle.think;
                return (
                  <div key={i} className="flex gap-2.5 items-baseline">
                    <span className={`shrink-0 font-semibold ${style.className}`}>{style.label}</span>
                    <span className="text-slate-500 dark:text-slate-400 break-words min-w-0">{step.text}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
              <span className="text-[9px] font-semibold tracking-[1px] uppercase text-slate-400 dark:text-slate-600">
                New prompt
              </span>
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
            </div>
          </div>
        )}

        {/* User prompt bubble */}
        {submittedPrompt && (
          <div className="flex justify-end">
            <div className="max-w-[85%] px-3 py-2 bg-sky-600 text-white rounded-[12px] rounded-tr-[4px] text-[12.5px] leading-[1.6] shadow-sm">
              {submittedPrompt}
            </div>
          </div>
        )}

        {/* Live logs */}
        {logs.length > 0 && (
          <div className="font-mono text-[11px] leading-[1.8] space-y-0.5">
            {logs.map((entry, i) => {
              const { ts, body } = parseLine(entry.message);
              const tag = tagMap[entry.level] ?? tagMap.info;
              const isSnap = entry.level === 'screenshot';
              return (
                <div
                  key={i}
                  className={`flex gap-2.5 items-start ${isSnap ? 'cursor-pointer group' : ''}`}
                  onClick={isSnap ? handleScreenshotClick : undefined}
                  title={isSnap ? 'Click to preview screenshot' : undefined}
                >
                  {ts && (
                    <span className="shrink-0 text-slate-400 dark:text-[#444460] min-w-[68px] tabular-nums pt-0.5">
                      {ts}
                    </span>
                  )}
                  <span className={`shrink-0 font-medium pt-0.5 ${tag.className}`}>{tag.label}</span>
                  {isSnap ? (
                    <span className="break-words transition-colors text-violet-600 dark:text-violet-300 group-hover:text-violet-700 dark:group-hover:text-violet-200 underline decoration-violet-400 dark:decoration-violet-700 underline-offset-2">
                      {body}
                    </span>
                  ) : (
                    <div className="log-md break-words min-w-0 text-slate-600 dark:text-slate-300">
                      <ReactMarkdown>{body}</ReactMarkdown>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {historySteps.length === 0 && !submittedPrompt && logs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full min-h-[120px] gap-2 text-slate-400 dark:text-slate-600 text-center">
            <span className="font-mono text-[11px] flex items-center gap-1">
              Waiting for agent<span className="animate-blink">_</span>
            </span>
            <span className="text-[10px]">Type a task below and press Run</span>
          </div>
        )}
      </div>
    </>
  );
}

