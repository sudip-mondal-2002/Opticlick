import { useState } from 'react';
import type { RefObject } from 'react';

interface LogItem {
  message: string;
  level: string;
}

interface Props {
  logs: LogItem[];
  logRef: RefObject<HTMLDivElement | null>;
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
  screenshot: { label: '[SNAP]',    className: 'text-violet-400' },
  error:      { label: '[ERR]',     className: 'text-rose-400' },
  info:       { label: '[THINK]',   className: 'text-sky-400' },
  ok:         { label: '[OBSERVE]', className: 'text-emerald-400' },
  warn:       { label: '[ACT]',     className: 'text-amber-400' },
};

function ScreenshotModal({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      onClick={onClose}
    >
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
        <button
          onClick={onClose}
          className="text-slate-600 hover:text-slate-300 font-mono text-[11px] transition-colors"
        >
          [esc]
        </button>
      </div>

      <div
        className="flex-1 overflow-auto p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt="Page snapshot"
          className="w-full rounded border border-slate-700/60"
        />
      </div>

      <div className="shrink-0 py-1.5 text-center">
        <span className="font-mono text-[9px] text-slate-700">click outside to close</span>
      </div>
    </div>
  );
}

export function ActivityLog({ logs, logRef }: Props) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const handleScreenshotClick = async () => {
    const { lastScreenshot } = await chrome.storage.session.get('lastScreenshot') as {
      lastScreenshot?: string;
    };
    if (lastScreenshot) {
      setPreviewSrc(`data:image/png;base64,${lastScreenshot}`);
    }
  };

  return (
    <>
      {previewSrc && (
        <ScreenshotModal src={previewSrc} onClose={() => setPreviewSrc(null)} />
      )}

      {/* Fills the full height of its flex-1 parent */}
      <div className="h-full flex flex-col rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700/70 shadow-[0_4px_24px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.4)]">

        {/* macOS-style titlebar */}
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700/70">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57] shrink-0" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e] shrink-0" />
          <div className="w-3 h-3 rounded-full bg-[#28c840] shrink-0" />
          <span className="ml-2 font-mono text-[10.5px] text-slate-400 dark:text-slate-500 tracking-tight select-none">
            opticlick-engine&nbsp;·&nbsp;agent log
          </span>
        </div>

        {/* Log body — expands to fill remaining height, scrolls inside */}
        <div
          ref={logRef}
          className="log-scroll flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 px-3 py-2.5 font-mono text-[11px] leading-[1.8]"
        >
          {logs.length === 0 ? (
            <div className="flex items-center gap-1 text-slate-400 dark:text-slate-600 italic">
              <span>Waiting for agent</span>
              <span className="animate-blink">_</span>
            </div>
          ) : (
            logs.map((entry, i) => {
              const { ts, body } = parseLine(entry.message);
              const tag = tagMap[entry.level] ?? tagMap.info;
              const isSnap = entry.level === 'screenshot';

              return (
                <div
                  key={i}
                  className={`flex gap-2.5 items-baseline mb-0.5 ${isSnap ? 'cursor-pointer group' : ''}`}
                  onClick={isSnap ? handleScreenshotClick : undefined}
                  title={isSnap ? 'Click to preview screenshot' : undefined}
                >
                  {ts && (
                    <span className="shrink-0 text-slate-400 dark:text-[#444460] min-w-[68px] tabular-nums">
                      {ts}
                    </span>
                  )}
                  <span className={`shrink-0 font-medium ${tag.className}`}>
                    {tag.label}
                  </span>
                  <span className={`break-all transition-colors ${
                    isSnap
                      ? 'text-violet-300 group-hover:text-violet-200 underline decoration-violet-700 underline-offset-2'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}>
                    {body}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
