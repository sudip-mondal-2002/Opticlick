import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentState, LogEntry, Session } from '@/utils/types';
import { getSessions } from '@/utils/db';
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

function formatRelativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function HistoryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

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

  // ── Session management ─────────────────────────────────────────────
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const refreshSessions = useCallback(async () => {
    const list = await getSessions();
    setSessions(list);
  }, []);

  // ── API key persistence ────────────────────────────────────────────

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

  // ── Agent state ────────────────────────────────────────────────────

  const appendLog = useCallback((message: string, level = 'info') => {
    const ts = new Date().toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    setLogs((prev) => [...prev, { message: `[${ts}] ${message}`, level }]);
  }, []);

  const syncState = useCallback(async () => {
    const { agentState } = (await chrome.storage.session.get('agentState')) as {
      agentState?: AgentState;
    };
    if (!agentState) return;
    setIsRunning(agentState.status === 'running');
    setIsError(agentState.status === 'error');
    if (agentState.step > 0) setStep(agentState.step);
    // Track the active session (created by background on first run)
    if (agentState.sessionId != null) {
      setCurrentSessionId(agentState.sessionId);
    }
    // Refresh session list when a run finishes
    if (['done', 'stopped', 'error'].includes(agentState.status)) {
      refreshSessions();
    }
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
      if (Array.isArray(agentLog)) agentLog.slice(-20).forEach(({ message, level }) => appendLog(message, level));
      await refreshSessions();
    })();
  }, [syncState, appendLog, refreshSessions]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const handleRun = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) { appendLog('Please enter a task prompt.', 'warn'); return; }
    appendLog(`Starting agent: "${trimmed.slice(0, 60)}${trimmed.length > 60 ? '…' : ''}"`, 'observe');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { appendLog('No active tab found.', 'error'); return; }
    setIsRunning(true);
    setStep(0);
    chrome.runtime.sendMessage({
      type: 'START_AGENT',
      tabId: tab.id,
      prompt: trimmed,
      sessionId: currentSessionId ?? undefined,
    });
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
    setShowHistory(false);
  };

  const handleSelectSession = (session: Session) => {
    setCurrentSessionId(session.id!);
    setPrompt(session.title);
    setLogs([]);
    setStep(0);
    setShowHistory(false);
  };

  // ── Render ─────────────────────────────────────────────────────────

  if (keyLoading) return null;

  if (!apiKey) {
    return (
      <ApiKeySetup
        keyInput={keyInput}
        onKeyInputChange={setKeyInput}
        onSave={saveKey}
      />
    );
  }

  const maskedKey = apiKey.slice(0, 8) + '••••••••••••';
  const activeSession = sessions.find((s) => s.id === currentSessionId);

  return (
    <div className="flex flex-col bg-white dark:bg-slate-950">
      <Header isRunning={isRunning} isError={isError} />

      {/* Session bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[11px]">
        {activeSession ? (
          <>
            <span className="text-slate-500 dark:text-slate-400 truncate flex-1 min-w-0">
              Continuing: <span className="text-slate-700 dark:text-slate-200 font-medium">{activeSession.title}</span>
            </span>
            <button
              onClick={handleNewChat}
              className="shrink-0 text-sky-500 hover:text-sky-600 dark:hover:text-sky-400 font-medium transition-colors"
            >
              New Chat
            </button>
          </>
        ) : (
          <>
            <span className="text-slate-400 dark:text-slate-500 flex-1">New Chat</span>
            {sessions.length > 0 && (
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="shrink-0 flex items-center gap-1 text-sky-500 hover:text-sky-600 dark:hover:text-sky-400 font-medium transition-colors"
              >
                <HistoryIcon />
                History ({sessions.length})
              </button>
            )}
          </>
        )}
      </div>

      {/* Session history panel */}
      {showHistory && (
        <div className="border-b border-slate-200 dark:border-slate-800 max-h-36 overflow-y-auto">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => handleSelectSession(session)}
              className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
            >
              <span className="truncate flex-1 text-[11.5px] text-slate-700 dark:text-slate-300">
                {session.title}
              </span>
              <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                {formatRelativeDate(session.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      )}

      <PromptSection prompt={prompt} onPromptChange={setPrompt} disabled={isRunning} />
      <ControlButtons isRunning={isRunning} onRun={handleRun} onStop={handleStop} />
      <ActivityLog logs={logs} logRef={logRef} />
      {isRunning && step > 0 && <StepFooter step={step} />}
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
