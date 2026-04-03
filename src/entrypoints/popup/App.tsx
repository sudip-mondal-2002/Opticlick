import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentState, LogEntry } from '@/utils/types';
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
  }, []);

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
    })();
  }, [syncState, appendLog]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const handleRun = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) { appendLog('Please enter a task prompt.', 'warn'); return; }
    appendLog(`Starting agent: "${trimmed.slice(0, 60)}${trimmed.length > 60 ? '…' : ''}"`, 'ok');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { appendLog('No active tab found.', 'error'); return; }
    setIsRunning(true);
    setStep(0);
    chrome.runtime.sendMessage({ type: 'START_AGENT', tabId: tab.id, prompt: trimmed });
  };

  const handleStop = () => {
    appendLog('Stop requested.', 'warn');
    chrome.runtime.sendMessage({ type: 'STOP_AGENT' });
    setIsRunning(false);
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

  return (
    <div className="flex flex-col bg-sky-50 dark:bg-slate-950">
      <Header isRunning={isRunning} isError={isError} />
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
