/**
 * Integration tests for src/utils/agent-log.ts
 *
 * Uses fake-browser-setup (WXT fakeBrowser) for chrome.storage.session.
 * chrome.runtime.sendMessage is stubbed directly on the globalThis.chrome object
 * because the sidepanel is not present during tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { log } from '@/utils/agent-log';
import type { LogEntry } from '@/utils/types';

// Stub chrome.runtime.sendMessage before each test.
// agent-log.ts calls sendMessage(...).catch(...) — we need it to be a function.
function stubSendMessage(impl?: () => Promise<unknown>) {
  const g = globalThis as Record<string, unknown>;
  const chrome = g.chrome as Record<string, Record<string, unknown>>;
  chrome.runtime.sendMessage = vi.fn(impl ?? (() => Promise.resolve(undefined)));
}

beforeEach(() => {
  stubSendMessage();
});

describe('log', () => {
  it('appends a LogEntry to agentLog in session storage', async () => {
    await log('hello world', 'info');
    const result = await chrome.storage.session.get('agentLog');
    const agentLog = result.agentLog as LogEntry[];
    expect(agentLog).toHaveLength(1);
    expect(agentLog[0].message).toBe('hello world');
    expect(agentLog[0].level).toBe('info');
    expect(typeof agentLog[0].ts).toBe('number');
  });

  it('defaults level to "info" when omitted', async () => {
    await log('no level given');
    const result = await chrome.storage.session.get('agentLog');
    const agentLog = result.agentLog as LogEntry[];
    expect(agentLog[0].level).toBe('info');
  });

  it('records "warn" level correctly', async () => {
    await log('something off', 'warn');
    const result = await chrome.storage.session.get('agentLog');
    const agentLog = result.agentLog as LogEntry[];
    expect(agentLog[0].level).toBe('warn');
  });

  it('records "error" level correctly', async () => {
    await log('something broke', 'error');
    const result = await chrome.storage.session.get('agentLog');
    const agentLog = result.agentLog as LogEntry[];
    expect(agentLog[0].level).toBe('error');
  });

  it('accumulates multiple log entries in order', async () => {
    await log('first', 'info');
    await log('second', 'warn');
    await log('third', 'error');
    const result = await chrome.storage.session.get('agentLog');
    const agentLog = result.agentLog as LogEntry[];
    expect(agentLog).toHaveLength(3);
    expect(agentLog[0].message).toBe('first');
    expect(agentLog[1].message).toBe('second');
    expect(agentLog[2].message).toBe('third');
  });

  it('trims log to at most 100 entries when more are added', async () => {
    for (let i = 0; i < 110; i++) {
      await log(`message ${i}`, 'info');
    }
    const result = await chrome.storage.session.get('agentLog');
    const agentLog = result.agentLog as LogEntry[];
    expect(agentLog.length).toBeLessThanOrEqual(100);
  });

  it('keeps the most recent entries after trimming', async () => {
    for (let i = 0; i < 105; i++) {
      await log(`msg-${i}`, 'info');
    }
    const result = await chrome.storage.session.get('agentLog');
    const agentLog = result.agentLog as LogEntry[];
    // Last entry should be the most recent one written
    expect(agentLog[agentLog.length - 1].message).toBe('msg-104');
  });

  it('calls chrome.runtime.sendMessage with the correct payload', async () => {
    await log('broadcast me', 'warn');
    const sendMessage = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'AGENT_LOG', message: 'broadcast me', level: 'warn' }),
    );
  });

  it('silently ignores "Could not establish connection" errors from sendMessage', async () => {
    stubSendMessage(() =>
      Promise.reject(Object.assign(new Error('Could not establish connection'), {})),
    );
    await expect(log('silent fail', 'info')).resolves.toBeUndefined();
  });

  it('does not throw when sendMessage rejects with other errors', async () => {
    stubSendMessage(() => Promise.reject(new Error('some other error')));
    // Should not throw — errors are caught internally and logged to console.error
    await expect(log('other error', 'info')).resolves.toBeUndefined();
  });
});
