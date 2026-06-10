import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import App from '@/entrypoints/sidepanel/App';
import type { Session } from '@/utils/types';

// Mock DB helper functions
const mockSessions: Session[] = [
  { id: 100, title: 'Session 100', createdAt: 1000, updatedAt: 1000 },
  { id: 200, title: 'Session 200', createdAt: 2000, updatedAt: 2000 },
];
const mockGetSessions = vi.fn().mockResolvedValue(mockSessions);
const mockGetConversationHistory = vi.fn().mockResolvedValue([]);

vi.mock('@/utils/db', () => ({
  getSessions: () => mockGetSessions(),
  getConversationHistory: () => mockGetConversationHistory(),
}));

// Mock models helper functions
vi.mock('@/utils/models', () => ({
  DEFAULT_MODEL: 'gemini-3.1-flash',
  GEMINI_MODELS: [{ id: 'gemini-3.1-flash', name: 'Gemini' }],
  ANTHROPIC_MODELS: [],
  OPENAI_MODELS: [],
  fetchOllamaModels: vi.fn().mockResolvedValue([]),
  isOllamaModel: vi.fn().mockReturnValue(false),
  getProviderForModel: vi.fn().mockReturnValue('gemini'),
  getModelLabel: vi.fn().mockReturnValue('Gemini'),
}));

// Mock subcomponents to isolate sidepanel App logic
vi.mock('@/entrypoints/sidepanel/components/VFSBrowser', () => ({
  VFSBrowser: () => <div data-testid="vfs-browser" />
}));
vi.mock('@/entrypoints/sidepanel/components/ApiKeySetup', () => ({
  ApiKeySetup: () => <div data-testid="api-key-setup" />
}));
vi.mock('@/entrypoints/sidepanel/components/ApiKeyOverlay', () => ({
  ApiKeyOverlay: () => <div data-testid="api-key-overlay" />
}));
vi.mock('@/entrypoints/sidepanel/components/Header', () => ({
  Header: ({ onShowSessions }: { onShowSessions: () => void }) => (
    <div data-testid="header">
      <button data-testid="btn-show-sessions" onClick={onShowSessions}>Sessions</button>
    </div>
  )
}));
vi.mock('@/entrypoints/sidepanel/components/StepFooter', () => ({
  StepFooter: () => <div data-testid="step-footer" />
}));
vi.mock('@/entrypoints/sidepanel/components/ModelSelector', () => ({
  ModelSelector: () => <div data-testid="model-selector" />
}));
vi.mock('@/entrypoints/sidepanel/components/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />
}));
vi.mock('@/entrypoints/sidepanel/components/ChatFeed', () => ({
  ChatFeed: () => <div data-testid="chat-feed" />
}));
vi.mock('@/entrypoints/sidepanel/components/SessionsOverlay', () => ({
  SessionsOverlay: ({ onResume, sessions }: { onResume: (s: Session) => void; sessions: Session[] }) => (
    <div data-testid="sessions-overlay">
      {sessions.map((s) => (
        <button key={s.id} data-testid={`resume-session-${s.id}`} onClick={() => onResume(s)}>
          Resume {s.title}
        </button>
      ))}
    </div>
  )
}));
vi.mock('@/entrypoints/sidepanel/components/TemplatesOverlay', () => ({
  TemplatesOverlay: () => <div data-testid="templates-overlay" />
}));

describe('Sidepanel App Sessions', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // Stub Chrome API
    const storageLocal: Record<string, unknown> = {
      geminiApiKey: 'mock-gemini-key',
      selectedModel: 'gemini-3.1-flash',
    };
    const storageSession: Record<string, unknown> = {
      agentState: { status: 'stopped', sessionId: null, step: 0 },
      agentLog: [],
    };
    const listeners = new Set<Parameters<typeof chrome.runtime.onMessage.addListener>[0]>();

    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async (keys: string[]) => {
            const res: Record<string, unknown> = {};
            keys.forEach((k) => { res[k] = storageLocal[k]; });
            return res;
          }),
          set: vi.fn(async (data: Record<string, unknown>) => {
            Object.assign(storageLocal, data);
          }),
        },
        session: {
          get: vi.fn(async (key: string | string[]) => {
            if (typeof key === 'string') {
              return { [key]: storageSession[key] };
            }
            const res: Record<string, unknown> = {};
            key.forEach((k) => { res[k] = storageSession[k]; });
            return res;
          }),
          set: vi.fn(async (data: Record<string, unknown>) => {
            Object.assign(storageSession, data);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const toRemove = Array.isArray(keys) ? keys : [keys];
            toRemove.forEach((k) => { delete storageSession[k]; });
          }),
        },
      },
      runtime: {
        onMessage: {
          addListener: vi.fn((cb: Parameters<typeof chrome.runtime.onMessage.addListener>[0]) => {
            listeners.add(cb);
          }),
          removeListener: vi.fn((cb: Parameters<typeof chrome.runtime.onMessage.addListener>[0]) => {
            listeners.delete(cb);
          }),
        },
      },
    };

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
      root = null;
    }
    container.remove();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('renders and selects the latest session on startup when currentSessionId is undefined', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.body.textContent).toContain('Continuing: Session 100');
  });

  it('hides the continuing session pill and does not reset to the latest session when clicking New Chat', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.body.textContent).toContain('Continuing: Session 100');

    // Find and click the "New Chat" button
    const buttons = Array.from(document.querySelectorAll('button'));
    const newChatBtn = buttons.find((b) => b.textContent === 'New Chat');
    expect(newChatBtn).toBeDefined();

    await act(async () => {
      newChatBtn!.click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.body.textContent).not.toContain('Continuing:');
  });

  it('updates currentSessionId and displays continuing pill when resuming a session', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Click "Sessions" button to show overlay
    const buttons = Array.from(document.querySelectorAll('button'));
    const sessionsBtn = buttons.find((b) => b.textContent === 'Sessions');
    expect(sessionsBtn).toBeDefined();

    await act(async () => {
      sessionsBtn!.click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // In mocked overlay, we render buttons like "Resume Session 200"
    const resumeBtn = document.querySelector('[data-testid="resume-session-200"]') as HTMLButtonElement;
    expect(resumeBtn).toBeDefined();

    await act(async () => {
      resumeBtn.click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.body.textContent).toContain('Continuing: Session 200');
  });
});
