import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchHardwareClick, _resetAttachedDebuggers } from '@/utils/cdp';
import { getMockDebugger } from '../setup/chrome-mocks';

beforeEach(() => {
  _resetAttachedDebuggers();
});

describe('dispatchHardwareClick', () => {
  it('calls chrome.debugger.attach before dispatching events', async () => {
    await dispatchHardwareClick(1, 100, 200);
    expect(getMockDebugger().attach).toHaveBeenCalledWith({ tabId: 1 }, '1.3');
  });

  it('sends exactly 3 Input.dispatchMouseEvent commands', async () => {
    await dispatchHardwareClick(1, 50, 75);
    const mouseCalls = getMockDebugger().sendCommand.mock.calls.filter(
      (c: unknown[]) => c[1] === 'Input.dispatchMouseEvent',
    );
    expect(mouseCalls).toHaveLength(3);
  });

  it('all three events carry button:"left" and clickCount:1', async () => {
    await dispatchHardwareClick(1, 50, 75);
    const mouseCalls = getMockDebugger().sendCommand.mock.calls
      .filter((c: unknown[]) => c[1] === 'Input.dispatchMouseEvent')
      .map((c: unknown[]) => c[2] as { button: string; clickCount: number });
    for (const args of mouseCalls) {
      expect(args.button).toBe('left');
      expect(args.clickCount).toBe(1);
    }
  });

  it('sends events in order: mouseMoved, mousePressed, mouseReleased', async () => {
    await dispatchHardwareClick(1, 50, 75);
    const types = getMockDebugger().sendCommand.mock.calls
      .filter((c: unknown[]) => c[1] === 'Input.dispatchMouseEvent')
      .map((c: unknown[]) => (c[2] as { type: string }).type);
    expect(types).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
  });

  it('mouseMoved has buttons: 0', async () => {
    await dispatchHardwareClick(1, 50, 75);
    const moved = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) =>
        c[1] === 'Input.dispatchMouseEvent' &&
        (c[2] as { type: string }).type === 'mouseMoved',
    )![2] as { buttons: number };
    expect(moved.buttons).toBe(0);
  });

  it('mousePressed has buttons: 1', async () => {
    await dispatchHardwareClick(1, 50, 75);
    const pressed = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) =>
        c[1] === 'Input.dispatchMouseEvent' &&
        (c[2] as { type: string }).type === 'mousePressed',
    )![2] as { buttons: number };
    expect(pressed.buttons).toBe(1);
  });

  it('mouseReleased has buttons: 0', async () => {
    await dispatchHardwareClick(1, 50, 75);
    const released = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) =>
        c[1] === 'Input.dispatchMouseEvent' &&
        (c[2] as { type: string }).type === 'mouseReleased',
    )![2] as { buttons: number };
    expect(released.buttons).toBe(0);
  });

  it('passes x/y coordinates to all three events', async () => {
    await dispatchHardwareClick(1, 123, 456);
    const mouseCalls = getMockDebugger().sendCommand.mock.calls
      .filter((c: unknown[]) => c[1] === 'Input.dispatchMouseEvent')
      .map((c: unknown[]) => c[2] as { x: number; y: number });
    for (const args of mouseCalls) {
      expect(args.x).toBe(123);
      expect(args.y).toBe(456);
    }
  });

  it('passes modifiers bitmask to all three events', async () => {
    await dispatchHardwareClick(1, 0, 0, 2); // ctrl
    const mouseCalls = getMockDebugger().sendCommand.mock.calls
      .filter((c: unknown[]) => c[1] === 'Input.dispatchMouseEvent')
      .map((c: unknown[]) => c[2] as { modifiers: number });
    for (const args of mouseCalls) {
      expect(args.modifiers).toBe(2);
    }
  });

  it('default modifiers is 0 on all three events', async () => {
    await dispatchHardwareClick(1, 0, 0);
    const mouseCalls = getMockDebugger().sendCommand.mock.calls
      .filter((c: unknown[]) => c[1] === 'Input.dispatchMouseEvent')
      .map((c: unknown[]) => c[2] as { modifiers: number });
    expect(mouseCalls).toHaveLength(3);
    for (const args of mouseCalls) {
      expect(args.modifiers).toBe(0);
    }
  });

  it('does not re-attach debugger if already attached (deduplication)', async () => {
    await dispatchHardwareClick(1, 10, 20);
    await dispatchHardwareClick(1, 30, 40);
    expect(getMockDebugger().attach).toHaveBeenCalledOnce();
  });
});
