import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentState, LogEntry, Session } from '@/utils/types';
import { getSessions, getConversationHistory } from '@/utils/db';
import { ThemeProvider } from './context/ThemeContext';
import { ApiKeySetup } from './components/ApiKeySetup';
import { Header } from './components/Header';
import { StepFooter } from './components/StepFooter';
import { ApiKeyFooter } from './components/ApiKeyFooter';

interface LogItem {
  message: string;
  level: string;
}

interface HistoryStep {
  kind: 'think' | 'act' | 'done' | 'prompt' | 'observe' | 'screenshot';
  text: string;
}

// ── Parse model turn from IndexedDB ──────────────────────────────────────────

function parseModelTurn(content: string): HistoryStep[] {
  try {
    const d = JSON.parse(content);
    const steps: HistoryStep[] = [];
    steps.push({ kind: 'screenshot', text: 'Screenshot captured' });
    if (d.reasoning) {
      const summary = d.reasoning.replace(/\s+/g, ' ').trim();
      steps.push({ kind: 'think', text: summary.length > 240 ? summary.slice(0, 237) + '…' : summary });
    }
    if (d.done) {
      steps.push({ kind: 'done', text: 'Task complete.' });
    } else {
      const parts: string[] = [];
      if (d.navigateUrl) parts.push(`Navigate → ${d.navigateUrl}`);
      else if (d.scroll) parts.push(`Scroll ${d.scroll}${d.scrollTargetId != null ? ` in #${d.scrollTargetId}` : ''}`);
      else if (d.pressKey) parts.push(`Press "${d.pressKey}"`);
      else if (d.targetId != null) {
        parts.push(`Click #${d.targetId}`);
        if (d.typeText) parts.push(`type "${d.typeText.slice(0, 40)}${d.typeText.length > 40 ? '…' : ''}"`);
      }
      if (parts.length) steps.push({ kind: 'act', text: parts.join(' then ') });
    }
    return steps;
  } catch {
    return [];
  }
}

// ── Relative date ─────────────────────────────────────────────────────────────

function formatRelativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Log line parsing & styles ─────────────────────────────────────────────────

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

// ── Screenshot modal ──────────────────────────────────────────────────────────

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

// ── Icons ─────────────────────────────────────────────────────────────────────

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


function ChevronIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

// ── Sessions overlay ──────────────────────────────────────────────────────────

interface SessionsOverlayProps {
  sessions: Session[];
  onClose: () => void;
  onResume: (session: Session) => void;
}

function SessionCard({ session, onOpen }: { session: Session; onOpen: (s: Session) => void }) {
  return (
    <button
      onClick={() => onOpen(session)}
      className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800/60 last:border-b-0 group"
    >
      <div className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-sky-100 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800/60 flex items-center justify-center text-sky-500">
        <HistoryIcon />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-slate-700 dark:text-slate-200 leading-snug line-clamp-2">
          {session.title}
        </p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
          {formatRelativeDate(session.updatedAt)}
        </p>
      </div>
      <span className="shrink-0 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-400 mt-1 transition-colors">
        <ChevronIcon />
      </span>
    </button>
  );
}

function SessionsOverlay({ sessions, onClose, onResume }: SessionsOverlayProps) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-slate-950">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800">
        <span className="flex-1 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
          Past Sessions
        </span>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-[11px] font-medium transition-colors"
        >
          Close
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-slate-400 dark:text-slate-600 px-8 text-center">
          <HistoryIcon />
          <p className="text-[12px]">No past sessions yet.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto log-scroll">
          {sessions.map((session) => (
            <SessionCard key={session.id} session={session} onOpen={(s) => { onResume(s); onClose(); }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main AgentUI ───────────────────────────────────────────────────────────────

function AgentUI() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyLoading, setKeyLoading] = useState(true);

  const [prompt, setPrompt] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isError, setIsError] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [step, setStep] = useState(0);
  const [showKeyEdit, setShowKeyEdit] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [historySteps, setHistorySteps] = useState<HistoryStep[]>([]);

  const [showSessions, setShowSessions] = useState(false);

  // ── API key ────────────────────────────────────────────────────────────────

  useEffect(() => {
    chrome.storage.local.get('geminiApiKey').then(({ geminiApiKey }) => {
      setApiKey((geminiApiKey as string) || null);
      setKeyLoading(false);
    });
  }, []);

  const saveKey = () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    chrome.storage.local.set({ geminiApiKey: trimmed }).then(() => {
      setApiKey(trimmed);
      setKeyInput('');
      setShowKeyEdit(false);
    });
  };

  const clearKey = () => {
    chrome.storage.local.remove('geminiApiKey').then(() => {
      setApiKey(null);
      setShowKeyEdit(false);
    });
  };

  // ── Agent state / logs ─────────────────────────────────────────────────────

  const refreshSessions = useCallback(async () => {
    const list = await getSessions();
    setSessions(list);
  }, []);

  const appendLog = useCallback((message: string, level = 'info') => {
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs((prev) => [...prev, { message: `[${ts}] ${message}`, level }]);
  }, []);

  const syncState = useCallback(async () => {
    const { agentState } = (await chrome.storage.session.get('agentState')) as { agentState?: AgentState };
    if (!agentState) return;
    setIsRunning(agentState.status === 'running');
    setIsError(agentState.status === 'error');
    if (agentState.step > 0) setStep(agentState.step);
    if (agentState.sessionId != null) setCurrentSessionId(agentState.sessionId);
    if (['done', 'stopped', 'error'].includes(agentState.status)) refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    const handler = (msg: Record<string, unknown>) => {
      if (msg.type === 'AGENT_LOG') appendLog(msg.message as string, (msg.level as string) || 'info');
      if (msg.type === 'AGENT_STATE_CHANGE') syncState();
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [appendLog, syncState]);

  useEffect(() => {
    (async () => {
      await syncState();
      const { agentLog } = (await chrome.storage.session.get('agentLog')) as { agentLog?: LogEntry[] };
      if (Array.isArray(agentLog)) agentLog.slice(-50).forEach(({ message, level }) => appendLog(message, level));
      await refreshSessions();
    })();
  }, [syncState, appendLog, refreshSessions]);

  // Auto-scroll feed to bottom as logs arrive
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [logs, historySteps, submittedPrompt]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleRun = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) { appendLog('Please enter a task prompt.', 'warn'); return; }
    setSubmittedPrompt(trimmed);
    setPrompt('');
    appendLog(`Starting: "${trimmed.slice(0, 60)}${trimmed.length > 60 ? '…' : ''}"`, 'observe');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { appendLog('No active tab found.', 'error'); return; }
    setIsRunning(true);
    setStep(0);
    chrome.runtime.sendMessage({ type: 'START_AGENT', tabId: tab.id, prompt: trimmed, sessionId: currentSessionId ?? undefined });
  };

  const handleStop = () => {
    appendLog('Stop requested.', 'act');
    chrome.runtime.sendMessage({ type: 'STOP_AGENT' });
    setIsRunning(false);
  };

  const handleNewChat = () => {
    setCurrentSessionId(null);
    setHistorySteps([]);
    setLogs([]);
    setStep(0);
    setPrompt('');
    setSubmittedPrompt(null);
    textareaRef.current?.focus();
  };

  const handleResumeSession = async (session: Session) => {
    setCurrentSessionId(session.id!);

    setLogs([]);
    setStep(0);
    setSubmittedPrompt(null);
    // Load history steps for the feed
    const turns = await getConversationHistory(session.id!);
    const steps: HistoryStep[] = [];
    for (const turn of turns) {
      if (turn.role === 'user') {
        // "[Step N] Some action. Task: ..." or "[ACTION FAILED - Step N] ..."
        const stepMatch = turn.content.match(/^\[(?:ACTION FAILED - )?Step \d+\]\s*(.+?)(?:\.\s*Task:.*)?$/s);
        if (stepMatch) {
          steps.push({ kind: 'observe', text: stepMatch[1].trim() });
        } else {
          const taskMatch = turn.content.match(/User task:\s*(.+?)(?:\n|$)/);
          if (taskMatch) steps.push({ kind: 'prompt', text: taskMatch[1].trim() });
        }
      } else if (turn.role === 'model') {
        steps.push(...parseModelTurn(turn.content));
      }
    }
    setHistorySteps(steps);
  };

  const handleScreenshotClick = async () => {
    const { lastScreenshot } = await chrome.storage.session.get('lastScreenshot') as { lastScreenshot?: string };
    if (lastScreenshot) setPreviewSrc(`data:image/png;base64,${lastScreenshot}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isRunning) {
      e.preventDefault();
      handleRun();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (keyLoading) return null;

  if (!apiKey) {
    return (
      <div className="flex flex-col h-screen bg-white dark:bg-slate-950 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <ApiKeySetup keyInput={keyInput} onKeyInputChange={setKeyInput} onSave={saveKey} />
        </div>
      </div>
    );
  }

  const maskedKey = apiKey.slice(0, 8) + '••••••••••••';
  const activeSession = sessions.find((s) => s.id === currentSessionId);

  return (
    <div className="relative flex flex-col h-screen bg-white dark:bg-slate-950 overflow-hidden">

      {/* Screenshot modal */}
      {previewSrc && <ScreenshotModal src={previewSrc} onClose={() => setPreviewSrc(null)} />}

      {/* Sessions overlay */}
      {showSessions && (
        <SessionsOverlay
          sessions={sessions}
          onClose={() => setShowSessions(false)}
          onResume={(s) => { handleResumeSession(s); setShowSessions(false); }}
        />
      )}

      {/* Header */}
      <Header
        isRunning={isRunning}
        isError={isError}
        sessionCount={sessions.length}
        onShowSessions={() => setShowSessions(true)}
      />

      {/* Session continuation pill */}
      {activeSession && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-sky-50 dark:bg-sky-950/30 border-b border-sky-100 dark:border-sky-900/60 text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
          <span className="text-slate-500 dark:text-slate-400 truncate flex-1 min-w-0">
            Continuing: <span className="text-slate-700 dark:text-slate-200 font-medium">{activeSession.title}</span>
          </span>
          <button
            onClick={handleNewChat}
            className="shrink-0 text-sky-500 hover:text-sky-600 dark:hover:text-sky-400 font-medium transition-colors"
          >
            New Chat
          </button>
        </div>
      )}

      {/* ── Unified chat feed ── */}
      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto log-scroll px-3 py-3 min-h-0 space-y-3"
      >

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
                  className={`flex gap-2.5 items-baseline ${isSnap ? 'cursor-pointer group' : ''}`}
                  onClick={isSnap ? handleScreenshotClick : undefined}
                  title={isSnap ? 'Click to preview screenshot' : undefined}
                >
                  {ts && (
                    <span className="shrink-0 text-slate-400 dark:text-[#444460] min-w-[68px] tabular-nums">
                      {ts}
                    </span>
                  )}
                  <span className={`shrink-0 font-medium ${tag.className}`}>{tag.label}</span>
                  <span className={`break-all transition-colors ${
                    isSnap
                      ? 'text-violet-600 dark:text-violet-300 group-hover:text-violet-700 dark:group-hover:text-violet-200 underline decoration-violet-400 dark:decoration-violet-700 underline-offset-2'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}>
                    {body}
                  </span>
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

      {/* Step progress */}
      {isRunning && step > 0 && <StepFooter step={step} />}

      {/* ── Bottom input bar ── */}
      <div className="shrink-0 px-3 pt-2 pb-3 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            rows={2}
            className="flex-1 min-h-[44px] max-h-[120px] resize-none px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-[10px] text-[12.5px] text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 leading-[1.5] outline-none font-sans transition-[border-color,box-shadow] focus:border-sky-600 focus:ring-2 focus:ring-sky-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning}
            placeholder={'Describe a task… (Enter to run, Shift+Enter for newline)'}
          />
          <div className="flex flex-col gap-1.5 shrink-0">
            <button
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold rounded-[8px] text-white bg-gradient-to-r from-sky-700 via-sky-500 to-sky-400 shadow-[0_2px_8px_rgba(14,165,233,0.3)] transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
              disabled={isRunning || !prompt.trim()}
              onClick={handleRun}
              title="Run agent"
            >
              <PlayIcon />
              Run
            </button>
            <button
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold rounded-[8px] text-rose-500 dark:text-rose-400 bg-slate-100 dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 transition-all hover:bg-rose-50 dark:hover:bg-rose-950/30 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={!isRunning}
              onClick={handleStop}
              title="Stop agent"
            >
              <StopIcon />
              Stop
            </button>
          </div>
        </div>
      </div>

      {/* API key footer */}
      <ApiKeyFooter
        maskedKey={maskedKey}
        showEdit={showKeyEdit}
        keyInput={keyInput}
        onKeyInputChange={setKeyInput}
        onShowEdit={() => setShowKeyEdit(true)}
        onSave={saveKey}
        onClear={clearKey}
        onCancel={() => { setShowKeyEdit(false); setKeyInput(''); }}
      />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AgentUI />
    </ThemeProvider>
  );
}
