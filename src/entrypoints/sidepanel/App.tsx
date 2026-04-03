import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentState, LogEntry, Session } from '@/utils/types';
import { getSessions, getConversationHistory } from '@/utils/db';
import { ThemeProvider } from './context/ThemeContext';
import { ApiKeySetup } from './components/ApiKeySetup';
import { Header } from './components/Header';
import { PromptSection } from './components/PromptSection';
import { ControlButtons } from './components/ControlButtons';
import { ActivityLog } from './components/ActivityLog';
import { StepFooter } from './components/StepFooter';
import { ApiKeyFooter } from './components/ApiKeyFooter';

interface LogItem {
  message: string;
  level: string;
}

// ── Parsed history step (from IndexedDB conversation turns) ───────────────────

interface HistoryStep {
  kind: 'think' | 'act' | 'done' | 'prompt';
  text: string;
}

function parseModelTurn(content: string): HistoryStep[] {
  try {
    const d = JSON.parse(content);
    const steps: HistoryStep[] = [];
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

// ── Relative date ──────────────────────────────────────────────────────────────

function formatRelativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function AgentTabIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function HistoryTabIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
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

// ── History session card ───────────────────────────────────────────────────────

interface SessionCardProps {
  session: Session;
  onOpen: (session: Session) => void;
}

function SessionCard({ session, onOpen }: SessionCardProps) {
  return (
    <button
      onClick={() => onOpen(session)}
      className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800/60 last:border-b-0 group"
    >
      <div className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-sky-100 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800/60 flex items-center justify-center text-sky-500">
        <HistoryTabIcon />
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

// ── History detail view ────────────────────────────────────────────────────────

const stepStyle: Record<string, { label: string; className: string }> = {
  think:  { label: '[THINK]', className: 'text-sky-500 dark:text-sky-400' },
  act:    { label: '[ACT]',   className: 'text-amber-500 dark:text-amber-400' },
  done:   { label: '[DONE]',  className: 'text-emerald-500 dark:text-emerald-400' },
  prompt: { label: '[TASK]',  className: 'text-violet-500 dark:text-violet-400' },
};

interface HistoryDetailProps {
  session: Session;
  steps: HistoryStep[];
  loading: boolean;
  onBack: () => void;
  onResume: (session: Session) => void;
}

function HistoryDetail({ session, steps, loading, onBack, onResume }: HistoryDetailProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Detail header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sky-500 hover:text-sky-600 dark:hover:text-sky-400 text-[11px] font-medium transition-colors"
        >
          <BackIcon />
          Sessions
        </button>
        <span className="text-slate-300 dark:text-slate-700">·</span>
        <span className="flex-1 min-w-0 text-[11px] text-slate-500 dark:text-slate-400 truncate">
          {session.title}
        </span>
        <button
          onClick={() => onResume(session)}
          className="shrink-0 text-[10px] font-semibold text-sky-500 hover:text-sky-600 dark:hover:text-sky-400 bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 rounded px-2 py-0.5 transition-colors"
        >
          Resume
        </button>
      </div>

      {/* Step feed */}
      <div className="flex-1 overflow-y-auto log-scroll px-3 py-3 min-h-0">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 dark:text-slate-600 text-[11px] font-mono mt-2">
            <span className="animate-blink">_</span>
            <span>Loading…</span>
          </div>
        ) : steps.length === 0 ? (
          <p className="text-[11px] text-slate-400 dark:text-slate-600 italic mt-2">
            No steps recorded for this session.
          </p>
        ) : (
          <div className="space-y-0.5">
            {steps.map((step, i) => {
              const style = stepStyle[step.kind] ?? stepStyle.think;
              return (
                <div key={i} className="flex gap-2.5 items-baseline font-mono text-[11px] leading-[1.75]">
                  <span className={`shrink-0 font-semibold ${style.className}`}>
                    {style.label}
                  </span>
                  <span className="text-slate-600 dark:text-slate-300 break-words min-w-0">
                    {step.text}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main AgentUI ───────────────────────────────────────────────────────────────

type ActiveTab = 'agent' | 'history';

function AgentUI() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyLoading, setKeyLoading] = useState(true);

  const [prompt, setPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isError, setIsError] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [step, setStep] = useState(0);
  const [showKeyEdit, setShowKeyEdit] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('agent');
  const [historySession, setHistorySession] = useState<Session | null>(null);
  const [historySteps, setHistorySteps] = useState<HistoryStep[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── API key ──────────────────────────────────────────────────────────────────

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

  // ── Agent state / logs ───────────────────────────────────────────────────────

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

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleRun = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) { appendLog('Please enter a task prompt.', 'warn'); return; }
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
    setLogs([]);
    setStep(0);
    setPrompt('');
  };

  const handleOpenHistory = async (session: Session) => {
    setHistorySession(session);
    setHistorySteps([]);
    setHistoryLoading(true);
    try {
      const turns = await getConversationHistory(session.id!);
      const steps: HistoryStep[] = [];
      for (const turn of turns) {
        if (turn.role === 'user') {
          const match = turn.content.match(/User task:\s*(.+?)(?:\n|$)/);
          if (match) steps.push({ kind: 'prompt', text: match[1].trim() });
        } else if (turn.role === 'model') {
          steps.push(...parseModelTurn(turn.content));
        }
      }
      setHistorySteps(steps);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleResumeSession = (session: Session) => {
    setCurrentSessionId(session.id!);
    setPrompt(session.title);
    setLogs([]);
    setStep(0);
    setActiveTab('agent');
    setHistorySession(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────────

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
    <div className="flex flex-col h-screen bg-white dark:bg-slate-950 overflow-hidden">

      {/* ── Header ── */}
      <Header isRunning={isRunning} isError={isError} />

      {/* ── Tab bar ── */}
      <div className="shrink-0 flex items-center bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => { setActiveTab('agent'); setHistorySession(null); }}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-[11.5px] font-semibold border-b-2 transition-colors ${
            activeTab === 'agent'
              ? 'border-sky-500 text-sky-600 dark:text-sky-400'
              : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <AgentTabIcon />
          Agent
        </button>
        <button
          onClick={() => { setActiveTab('history'); setHistorySession(null); }}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-[11.5px] font-semibold border-b-2 transition-colors ${
            activeTab === 'history'
              ? 'border-sky-500 text-sky-600 dark:text-sky-400'
              : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
        >
          <HistoryTabIcon />
          History
          {sessions.length > 0 && (
            <span className={`ml-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
              activeTab === 'history'
                ? 'bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
            }`}>
              {sessions.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Main content (flex-1, never overflows) ── */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">

        {activeTab === 'agent' ? (
          <>
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

            {/* Prompt + controls */}
            <div className="shrink-0">
              <PromptSection prompt={prompt} onPromptChange={setPrompt} disabled={isRunning} />
              <ControlButtons isRunning={isRunning} onRun={handleRun} onStop={handleStop} />
            </div>

            {/* Live log feed — fills all remaining space */}
            <div className="flex-1 min-h-0 px-3 py-3">
              <ActivityLog logs={logs} logRef={logRef} />
            </div>
          </>
        ) : (
          /* History tab */
          historySession ? (
            <HistoryDetail
              session={historySession}
              steps={historySteps}
              loading={historyLoading}
              onBack={() => setHistorySession(null)}
              onResume={handleResumeSession}
            />
          ) : (
            <div className="flex-1 overflow-y-auto log-scroll">
              {sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 dark:text-slate-600 px-8 text-center">
                  <HistoryTabIcon />
                  <p className="text-[12px]">No past sessions yet. Run the agent on a task to see history here.</p>
                </div>
              ) : (
                sessions.map((session) => (
                  <SessionCard key={session.id} session={session} onOpen={handleOpenHistory} />
                ))
              )}
            </div>
          )
        )}
      </div>

      {/* ── Step progress (only while running) ── */}
      {isRunning && step > 0 && <StepFooter step={step} />}

      {/* ── API key footer ── */}
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
