import { describe, it, expect, beforeEach } from 'vitest';
import { typeTextCDP, _resetAttachedDebuggers } from '@/utils/cdp';
import { getMockDebugger } from '../setup/chrome-mocks';

beforeEach(() => {
  _resetAttachedDebuggers();
});

describe('typeTextCDP', () => {
  it('attaches the debugger before typing', async () => {
    await typeTextCDP(1, 'hello');
    expect(getMockDebugger().attach).toHaveBeenCalledWith({ tabId: 1 }, '1.3');
  });

  it('sends Input.insertText with the provided text', async () => {
    await typeTextCDP(1, 'hello');
    const insertCall = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'Input.insertText',
    );
    expect(insertCall).toBeDefined();
    expect((insertCall![2] as { text: string }).text).toBe('hello');
  });

  it('does NOT send Ctrl+A when clearField is false', async () => {
    await typeTextCDP(1, 'hello', false);
    const ctrlACalls = getMockDebugger().sendCommand.mock.calls.filter(
      (c: unknown[]) =>
        c[1] === 'Input.dispatchKeyEvent' &&
        (c[2] as { key: string }).key === 'a',
    );
    expect(ctrlACalls).toHaveLength(0);
  });

  it('does NOT send Ctrl+A when clearField is omitted', async () => {
    await typeTextCDP(1, 'hello');
    const ctrlACalls = getMockDebugger().sendCommand.mock.calls.filter(
      (c: unknown[]) =>
        c[1] === 'Input.dispatchKeyEvent' &&
        (c[2] as { key: string }).key === 'a',
    );
    expect(ctrlACalls).toHaveLength(0);
  });

  it('sends Ctrl+A (rawKeyDown + keyUp) before inserting when clearField is true', async () => {
    await typeTextCDP(1, 'build', true);
    const keyCalls = getMockDebugger().sendCommand.mock.calls.filter(
      (c: unknown[]) => c[1] === 'Input.dispatchKeyEvent',
    );
    expect(keyCalls).toHaveLength(2);
    expect((keyCalls[0][2] as { type: string; key: string; modifiers: number }).type).toBe('rawKeyDown');
    expect((keyCalls[0][2] as { key: string }).key).toBe('a');
    expect((keyCalls[0][2] as { modifiers: number }).modifiers).toBe(2); // Ctrl
    expect((keyCalls[1][2] as { type: string }).type).toBe('keyUp');
    expect((keyCalls[1][2] as { key: string }).key).toBe('a');
  });

  it('sends Ctrl+A BEFORE Input.insertText when clearField is true', async () => {
    await typeTextCDP(1, 'build', true);
    const allCalls = getMockDebugger().sendCommand.mock.calls;
    const ctrlAIdx = allCalls.findIndex(
      (c: unknown[]) =>
        c[1] === 'Input.dispatchKeyEvent' &&
        (c[2] as { key: string }).key === 'a',
    );
    const insertIdx = allCalls.findIndex(
      (c: unknown[]) => c[1] === 'Input.insertText',
    );
    expect(ctrlAIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(ctrlAIdx);
  });

  it('sends only Input.insertText (no keyDown events) when clearField is false', async () => {
    await typeTextCDP(1, 'android', false);
    const keyCalls = getMockDebugger().sendCommand.mock.calls.filter(
      (c: unknown[]) => c[1] === 'Input.dispatchKeyEvent',
    );
    expect(keyCalls).toHaveLength(0);
    const insertCalls = getMockDebugger().sendCommand.mock.calls.filter(
      (c: unknown[]) => c[1] === 'Input.insertText',
    );
    expect(insertCalls).toHaveLength(1);
  });

  it('does not re-attach debugger if already attached', async () => {
    await typeTextCDP(1, 'first');
    await typeTextCDP(1, 'second');
    expect(getMockDebugger().attach).toHaveBeenCalledOnce();
  });
});
