import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentState, LogEntry, Session, AttachedFile } from '@/utils/types';
import { getSessions, getConversationHistory } from '@/utils/db';
import {
  DEFAULT_MODEL,
  GEMINI_MODELS,
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  fetchOllamaModels,
  isOllamaModel,
  getProviderForModel,
} from '@/utils/models';
import type { ModelOption, CustomOpenAIConfig } from '@/utils/models';
import { ThemeProvider } from './context/ThemeContext';
import { ApiKeySetup } from './components/ApiKeySetup';
import { ApiKeyOverlay } from './components/ApiKeyOverlay';
import { Header } from './components/Header';
import { StepFooter } from './components/StepFooter';
import { ModelSelector } from './components/ModelSelector';
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

// ── Storage key map ──────────────────────────────────────────────────────────

const STORAGE_KEY_MAP: Record<'gemini' | 'anthropic' | 'openai', string> = {
  gemini: 'geminiApiKey',
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
};

// ── Main AgentUI ──────────────────────────────────────────────────────────────

function AgentUI() {
  // Per-provider API keys
  const [geminiApiKey, setGeminiApiKey] = useState<string | null>(null);
  const [anthropicApiKey, setAnthropicApiKey] = useState<string | null>(null);
  const [openaiApiKey, setOpenaiApiKey] = useState<string | null>(null);
  const [customConfigs, setCustomConfigs] = useState<CustomOpenAIConfig[]>([]);
  const [keyLoading, setKeyLoading] = useState(true);
  const [showApiKeys, setShowApiKeys] = useState(false);

  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);

  const [submittedPrompt, setSubmittedPrompt] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isError, setIsError] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [step, setStep] = useState(0);
  const [streamingThinking, setStreamingThinking] = useState('');

  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [historySteps, setHistorySteps] = useState<HistoryStep[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [chatInputKey, setChatInputKey] = useState(0);

  const feedRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── API keys ──────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const [stored, ollama] = await Promise.all([
        chrome.storage.local.get(['geminiApiKey', 'anthropicApiKey', 'openaiApiKey', 'customOpenaiConfigs', 'selectedModel']),
        fetchOllamaModels(),
      ]);
      const gKey = (stored.geminiApiKey as string) || null;
      const aKey = (stored.anthropicApiKey as string) || null;
      const oKey = (stored.openaiApiKey as string) || null;
      const configs = (stored.customOpenaiConfigs as CustomOpenAIConfig[]) || [];

      setGeminiApiKey(gKey);
      setAnthropicApiKey(aKey);
      setOpenaiApiKey(oKey);
      setCustomConfigs(configs);
      setOllamaModels(ollama);

      // Select a valid model — fall back if the current selection's provider has no key
      let model = (stored.selectedModel as string) || DEFAULT_MODEL;
      const provider = getProviderForModel(model);
      const hasKeyForProvider =
        (provider === 'gemini' && gKey) ||
        (provider === 'anthropic' && aKey) ||
        (provider === 'openai' && oKey) ||
        (provider === 'custom-openai') ||
        (provider === 'ollama');

      if (!hasKeyForProvider) {
        if (aKey) model = ANTHROPIC_MODELS[0].id;
        else if (oKey) model = OPENAI_MODELS[0].id;
        else if (gKey) model = GEMINI_MODELS[0].id;
        else {
          const firstRunning = ollama.find((m) => m.running);
          if (firstRunning) model = firstRunning.id;
        }
      }
      setSelectedModel(model);
      setKeyLoading(false);
    })();
  }, []);

  const saveProviderKey = (provider: 'gemini' | 'anthropic' | 'openai', key: string) => {
    chrome.storage.local.set({ [STORAGE_KEY_MAP[provider]]: key }).then(() => {
      if (provider === 'gemini') setGeminiApiKey(key);
      else if (provider === 'anthropic') setAnthropicApiKey(key);
      else setOpenaiApiKey(key);
    });
  };

  const clearProviderKey = (provider: 'gemini' | 'anthropic' | 'openai') => {
    chrome.storage.local.remove(STORAGE_KEY_MAP[provider]).then(() => {
      if (provider === 'gemini') setGeminiApiKey(null);
      else if (provider === 'anthropic') setAnthropicApiKey(null);
      else setOpenaiApiKey(null);
    });
  };

  const saveCustomConfig = (config: CustomOpenAIConfig) => {
    const updated = [...customConfigs, config];
    setCustomConfigs(updated);
    chrome.storage.local.set({ customOpenaiConfigs: updated });
  };

  const deleteCustomConfig = (configId: string) => {
    const updated = customConfigs.filter((c) => c.id !== configId);
    setCustomConfigs(updated);
    chrome.storage.local.set({ customOpenaiConfigs: updated });
  };

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    chrome.storage.local.set({ selectedModel: modelId });
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

  const playSound = useCallback((sound: 'finish' | 'ask') => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (sound === 'finish') {
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.setValueAtTime(780, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.45);
    } else {
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
    osc.onended = () => ctx.close();
  }, []);

  useEffect(() => {
    const handler = (msg: Record<string, unknown>) => {
      if (msg.type === 'AGENT_LOG') appendLog(msg.message as string, (msg.level as string) || 'info');
      if (msg.type === 'AGENT_THINKING_DELTA') setStreamingThinking((prev) => prev + (msg.delta as string));
      if (msg.type === 'AGENT_THINKING_DONE') {
        setStreamingThinking((prev) => {
          if (prev.trim()) appendLog(prev.trim(), 'think');
          return '';
        });
      }
      if (msg.type === 'AGENT_STATE_CHANGE') syncState();
      if (msg.type === 'ASK_USER') setPendingQuestion(msg.question as string);
      if (msg.type === 'PLAY_SOUND') playSound(msg.sound as 'finish' | 'ask');
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [appendLog, syncState, playSound]);

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
  }, [logs, historySteps, submittedPrompt, streamingThinking]);

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
      modelId: selectedModel,
    });
  };

  const handleStop = () => {
    appendLog('Stop requested.', 'act');
    chrome.runtime.sendMessage({ type: 'STOP_AGENT' });
    setIsRunning(false);
    setPendingQuestion(null);
    setReplyInput('');
  };

  const handleReply = () => {
    const trimmed = replyInput.trim();
    if (!trimmed) return;
    appendLog(`You: ${trimmed}`, 'observe');
    chrome.storage.session.set({ userReply: trimmed });
    setPendingQuestion(null);
    setReplyInput('');
  };

  const handleNewChat = () => {
    setCurrentSessionId(null);
    setHistorySteps([]);
    setLogs([]);
    setStep(0);
    setSubmittedPrompt(null);
    setStreamingThinking('');
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

  // Require API key setup when no provider has a key AND no Ollama model is selected
  const hasAnyKey = geminiApiKey || anthropicApiKey || openaiApiKey || customConfigs.length > 0;
  if (!hasAnyKey && !isOllamaModel(selectedModel)) {
    return (
      <div className="flex flex-col h-screen bg-white dark:bg-slate-950 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <ApiKeySetup
            onSave={saveProviderKey}
            onSaveCustom={(config) => {
              saveCustomConfig(config);
              // Auto-select the new custom endpoint
              handleModelChange(`custom-openai:${config.id}`);
            }}
          />
        </div>
      </div>
    );
  }

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

      {showApiKeys && (
        <ApiKeyOverlay
          geminiApiKey={geminiApiKey}
          anthropicApiKey={anthropicApiKey}
          openaiApiKey={openaiApiKey}
          customConfigs={customConfigs}
          onSaveKey={saveProviderKey}
          onClearKey={clearProviderKey}
          onSaveCustomConfig={saveCustomConfig}
          onDeleteCustomConfig={deleteCustomConfig}
          onClose={() => setShowApiKeys(false)}
        />
      )}

      <Header
        isRunning={isRunning}
        isError={isError}
        sessionCount={sessions.length}
        onShowSessions={() => setShowSessions(true)}
        onShowApiKeys={() => setShowApiKeys(true)}
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
        streamingThinking={streamingThinking}
      />

      {isRunning && step > 0 && <StepFooter step={step} />}

      {/* Agent question prompt */}
      {pendingQuestion && (
        <div className="shrink-0 border-t border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 space-y-2">
          <div className="flex items-start gap-2">
            <span className="font-mono text-[10px] font-semibold text-amber-500 shrink-0 mt-0.5">[ASK]</span>
            <span className="text-[12px] text-slate-700 dark:text-slate-200 leading-snug">{pendingQuestion}</span>
          </div>
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={replyInput}
              onChange={(e) => setReplyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
              placeholder="Type your reply…"
              className="flex-1 min-w-0 rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[12px] text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
            <button
              onClick={handleReply}
              disabled={!replyInput.trim()}
              className="shrink-0 px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-[12px] font-medium transition-colors"
            >
              Reply
            </button>
          </div>
        </div>
      )}

      <ChatInput
        key={chatInputKey}
        isRunning={isRunning}
        textareaRef={textareaRef}
        onRun={handleRun}
        onStop={handleStop}
      />

      <ModelSelector
        selectedModel={selectedModel}
        onModelChange={handleModelChange}
        ollamaModels={ollamaModels}
        customConfigs={customConfigs}
        hasGeminiKey={!!geminiApiKey}
        hasAnthropicKey={!!anthropicApiKey}
        hasOpenaiKey={!!openaiApiKey}
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
