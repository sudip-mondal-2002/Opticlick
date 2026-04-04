/**
 * Integration tests for typeTextCDP.
 *
 * These tests verify CDP command wiring only — the sendCommand mock records
 * calls but never executes them. The actual page-side clearing logic lives in
 * clearFocusedField() which is tested separately in tests/dom/cdp-clearFocusedField.test.ts
 * against a real jsdom DOM.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { typeTextCDP, _resetAttachedDebuggers } from '@/utils/cdp';
import { getMockDebugger } from '../setup/chrome-mocks';

beforeEach(() => {
  _resetAttachedDebuggers();
  vi.clearAllMocks();
});

describe('typeTextCDP', () => {
  // ── Debugger attachment ────────────────────────────────────────────────────

  it('attaches the debugger before any commands', async () => {
    await typeTextCDP(1, 'hello');
    expect(getMockDebugger().attach).toHaveBeenCalledWith({ tabId: 1 }, '1.3');
    expect(getMockDebugger().attach).toHaveBeenCalledBefore(
      getMockDebugger().sendCommand,
    );
  });

  it('does not re-attach if already attached', async () => {
    await typeTextCDP(1, 'a');
    await typeTextCDP(1, 'b');
    expect(getMockDebugger().attach).toHaveBeenCalledOnce();
  });

  // ── clearField: false (default) ────────────────────────────────────────────

  it('sends only Input.insertText when clearField is omitted', async () => {
    await typeTextCDP(1, 'hello');
    const names = getMockDebugger().sendCommand.mock.calls.map((c: unknown[]) => c[1]);
    expect(names).toEqual(['Input.insertText']);
  });

  it('sends only Input.insertText when clearField is false', async () => {
    await typeTextCDP(1, 'hello', false);
    const names = getMockDebugger().sendCommand.mock.calls.map((c: unknown[]) => c[1]);
    expect(names).toEqual(['Input.insertText']);
  });

  it('inserts the correct text', async () => {
    await typeTextCDP(1, 'world', false);
    const call = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'Input.insertText',
    );
    expect((call![2] as { text: string }).text).toBe('world');
  });

  // ── clearField: true ───────────────────────────────────────────────────────

  it('sends Runtime.evaluate THEN Input.insertText when clearField is true', async () => {
    await typeTextCDP(1, 'new', true);
    const names = getMockDebugger().sendCommand.mock.calls.map((c: unknown[]) => c[1]);
    expect(names).toEqual(['Runtime.evaluate', 'Input.insertText']);
  });

  it('Runtime.evaluate uses awaitPromise: false', async () => {
    await typeTextCDP(1, 'x', true);
    const evalCall = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'Runtime.evaluate',
    );
    expect((evalCall![2] as { awaitPromise: boolean }).awaitPromise).toBe(false);
  });

  it('Runtime.evaluate expression is the serialised clearFocusedField function', async () => {
    await typeTextCDP(1, 'x', true);
    const evalCall = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'Runtime.evaluate',
    );
    const expr: string = (evalCall![2] as { expression: string }).expression;
    // Must be an IIFE wrapping clearFocusedField
    expect(expr).toMatch(/^\(/);
    expect(expr).toMatch(/\)\(\)$/);
    expect(expr).toContain('clearFocusedField');
  });

  it('inserts the correct text after clearing', async () => {
    await typeTextCDP(1, 'replaced', true);
    const insertCall = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'Input.insertText',
    );
    expect((insertCall![2] as { text: string }).text).toBe('replaced');
  });

  it('sends no key events regardless of clearField', async () => {
    await typeTextCDP(1, 'hello', true);
    const keyCalls = getMockDebugger().sendCommand.mock.calls.filter(
      (c: unknown[]) => c[1] === 'Input.dispatchKeyEvent',
    );
    expect(keyCalls).toHaveLength(0);
  });
});
