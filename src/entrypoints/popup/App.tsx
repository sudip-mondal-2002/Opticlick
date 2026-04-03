import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentState, LogEntry } from '@/utils/types';

interface LogItem {
  message: string;
  level: string;
}

export default function App() {
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
    const running = agentState.status === 'running';
    setIsRunning(running);
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

  const statusClass = isRunning ? 'running' : isError ? 'error' : '';

  // No key set → setup screen
  if (!apiKey) {
    return (
      <div className="key-setup">
        <div className="key-setup-logo" />
        <h2 className="key-setup-title">Opticlick Engine</h2>
        <p className="key-setup-desc">
          Enter your <strong>Gemini API key</strong> to get started.
          Get one free at <span className="key-setup-link">aistudio.google.com</span>
        </p>
        <input
          className="key-input"
          type="password"
          placeholder="AIza…"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveKey()}
          autoFocus
        />
        <button className="key-save-btn" disabled={!keyInput.trim()} onClick={saveKey}>
          Save &amp; Continue
        </button>
      </div>
    );
  }

  // Key set → main agent UI
  const maskedKey = apiKey.slice(0, 8) + '••••••••••••';

  return (
    <>
      <header>
        <div className="logo" />
        <h1>Opticlick</h1>
        <span className="ai-badge">AI Agent</span>
        <div className={`status-dot ${statusClass}`} />
      </header>

      <div className="prompt-section">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isRunning}
          placeholder="Describe the task… e.g. 'Create a GitHub issue titled Bug: login fails'"
        />
      </div>

      <div className="controls">
        <button className="btn-run" disabled={isRunning} onClick={handleRun}>
          &#9654;&nbsp; Run Agent
        </button>
        <button className="btn-stop" disabled={!isRunning} onClick={handleStop}>
          &#9632;&nbsp; Stop
        </button>
      </div>

      <div className="log-section">
        <div className="log-label">Activity Log</div>
        <div className="log-output" ref={logRef}>
          {logs.map((entry, i) => (
            <div key={i} className={`entry ${entry.level}`}>{entry.message}</div>
          ))}
        </div>
      </div>

      {isRunning && step > 0 && (
        <div className="step-footer">
          <div className="step-pip" />
          <span className="step-text">Step {step} of 20</span>
        </div>
      )}

      {/* API key footer */}
      <div className="api-key-footer">
        {showKeyEdit ? (
          <>
            <input
              className="key-input-inline"
              type="password"
              placeholder="New API key…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
              autoFocus
            />
            <button className="key-action-btn save" onClick={saveKey} disabled={!keyInput.trim()}>Save</button>
            <button className="key-action-btn danger" onClick={clearKey}>Remove</button>
            <button className="key-action-btn" onClick={() => { setShowKeyEdit(false); setKeyInput(''); }}>Cancel</button>
          </>
        ) : (
          <>
            <span className="key-masked">{maskedKey}</span>
            <button className="key-action-btn" onClick={() => setShowKeyEdit(true)}>Change key</button>
          </>
        )}
      </div>
    </>
  );
}
