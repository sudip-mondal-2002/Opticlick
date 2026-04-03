import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentState, LogEntry, Session, AttachedFile } from '@/utils/types';
import { getSessions, getConversationHistory } from '@/utils/db';
import { ThemeProvider } from './context/ThemeContext';
import { ApiKeySetup } from './components/ApiKeySetup';
import { Header } from './components/Header';
import { StepFooter } from './components/StepFooter';
import { ApiKeyFooter } from './components/ApiKeyFooter';
import { ChatInput } from './components/ChatInput';
import { ChatFeed } from './components/ChatFeed';
import { SessionsOverlay } from './components/SessionsOverlay';
import type { LogItem, HistoryStep } from './components/ChatFeed';

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

// ── Main AgentUI ──────────────────────────────────────────────────────────────

function AgentUI() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyLoading, setKeyLoading] = useState(true);
  const [showKeyEdit, setShowKeyEdit] = useState(false);

  const [submittedPrompt, setSubmittedPrompt] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isError, setIsError] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [step, setStep] = useState(0);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [historySteps, setHistorySteps] = useState<HistoryStep[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [chatInputKey, setChatInputKey] = useState(0);

  const feedRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    setSessions(await getSessions());
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

  // Auto-scroll feed to bottom
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [logs, historySteps, submittedPrompt]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleRun = async (prompt: string, attachments: AttachedFile[]) => {
    setSubmittedPrompt(prompt);
    appendLog(`Starting: "${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}"`, 'observe');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { appendLog('No active tab found.', 'error'); return; }
    setIsRunning(true);
    setStep(0);
    chrome.runtime.sendMessage({
      type: 'START_AGENT',
      tabId: tab.id,
      prompt,
      sessionId: currentSessionId ?? undefined,
      attachments: attachments.length ? attachments : undefined,
    });
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
    setSubmittedPrompt(null);
    setChatInputKey((k) => k + 1);
    textareaRef.current?.focus();
  };

  const handleResumeSession = async (session: Session) => {
    if (session.id == null) return;
    setCurrentSessionId(session.id);
    setLogs([]);
    setStep(0);
    setSubmittedPrompt(null);
    const turns = await getConversationHistory(session.id);
    const steps: HistoryStep[] = [];
    for (const turn of turns) {
      if (turn.role === 'user') {
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

      {showSessions && (
        <SessionsOverlay
          sessions={sessions}
          onClose={() => setShowSessions(false)}
          onResume={(s) => { handleResumeSession(s); setShowSessions(false); }}
        />
      )}

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

      <ChatFeed
        feedRef={feedRef}
        historySteps={historySteps}
        submittedPrompt={submittedPrompt}
        logs={logs}
      />

      {isRunning && step > 0 && <StepFooter step={step} />}

      <ChatInput
        key={chatInputKey}
        isRunning={isRunning}
        textareaRef={textareaRef}
        onRun={handleRun}
        onStop={handleStop}
      />

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
