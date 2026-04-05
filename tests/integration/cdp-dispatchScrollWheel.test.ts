import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchScrollWheel, _resetAttachedDebuggers } from '@/utils/cdp';
import { getMockDebugger } from '../setup/chrome-mocks';

beforeEach(() => {
  _resetAttachedDebuggers();
});

// ─────────────────────────────────────────────────────────────────────────────
// dispatchScrollWheel — CDP mouseWheel dispatch
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatchScrollWheel', () => {
  // ── Debugger lifecycle ───────────────────────────────────────────────────

  it('calls chrome.debugger.attach before dispatching', async () => {
    await dispatchScrollWheel(1, 600, 400, 0, 500);
    expect(getMockDebugger().attach).toHaveBeenCalledWith({ tabId: 1 }, '1.3');
  });

  it('does not re-attach debugger if already attached (deduplication)', async () => {
    await dispatchScrollWheel(1, 600, 400, 0, 500);
    await dispatchScrollWheel(1, 600, 400, 0, -500);
    expect(getMockDebugger().attach).toHaveBeenCalledOnce();
  });

  it('uses the correct tabId when attaching', async () => {
    await dispatchScrollWheel(42, 600, 400, 0, 500);
    expect(getMockDebugger().attach).toHaveBeenCalledWith({ tabId: 42 }, '1.3');
  });

  // ── Event structure ──────────────────────────────────────────────────────

  it('sends exactly one Input.dispatchMouseEvent command', async () => {
    await dispatchScrollWheel(1, 600, 400, 0, 500);
    const mouseCalls = getMockDebugger().sendCommand.mock.calls.filter(
      (c: unknown[]) => c[1] === 'Input.dispatchMouseEvent',
    );
    expect(mouseCalls).toHaveLength(1);
  });

  it('sends a "mouseWheel" event type', async () => {
    await dispatchScrollWheel(1, 600, 400, 0, 500);
    const call = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'Input.dispatchMouseEvent',
    )!;
    expect((call[2] as { type: string }).type).toBe('mouseWheel');
  });

  // ── Coordinates ──────────────────────────────────────────────────────────

  it('passes x and y coordinates to the event', async () => {
    await dispatchScrollWheel(1, 123, 456, 0, 500);
    const call = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'Input.dispatchMouseEvent',
    )!;
    const params = call[2] as { x: number; y: number };
    expect(params.x).toBe(123);
    expect(params.y).toBe(456);
  });

  it('uses default page-center coordinates (600, 400) when passed directly', async () => {
    await dispatchScrollWheel(1, 600, 400, 0, 500);
    const call = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'Input.dispatchMouseEvent',
    )!;
    const params = call[2] as { x: number; y: number };
    expect(params.x).toBe(600);
    expect(params.y).toBe(400);
  });

  // ── Delta values ─────────────────────────────────────────────────────────

  it('passes deltaX and deltaY verbatim', async () => {
    await dispatchScrollWheel(1, 600, 400, 100, -200);
    const call = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'Input.dispatchMouseEvent',
    )!;
    const params = call[2] as { deltaX: number; deltaY: number };
    expect(params.deltaX).toBe(100);
    expect(params.deltaY).toBe(-200);
  });

  it('scroll down: positive deltaY is forwarded as-is', async () => {
    await dispatchScrollWheel(1, 600, 400, 0, 500);
    const call = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'Input.dispatchMouseEvent',
    )!;
    expect((call[2] as { deltaY: number }).deltaY).toBeGreaterThan(0);
  });

  it('scroll up: negative deltaY is forwarded as-is', async () => {
    await dispatchScrollWheel(1, 600, 400, 0, -500);
    const call = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'Input.dispatchMouseEvent',
    )!;
    expect((call[2] as { deltaY: number }).deltaY).toBeLessThan(0);
  });

  it('scroll right: positive deltaX, zero deltaY', async () => {
    await dispatchScrollWheel(1, 600, 400, 500, 0);
    const call = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'Input.dispatchMouseEvent',
    )!;
    const params = call[2] as { deltaX: number; deltaY: number };
    expect(params.deltaX).toBeGreaterThan(0);
    expect(params.deltaY).toBe(0);
  });

  it('scroll left: negative deltaX, zero deltaY', async () => {
    await dispatchScrollWheel(1, 600, 400, -500, 0);
    const call = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'Input.dispatchMouseEvent',
    )!;
    const params = call[2] as { deltaX: number; deltaY: number };
    expect(params.deltaX).toBeLessThan(0);
    expect(params.deltaY).toBe(0);
  });

  it('zero deltas are forwarded (no-op scroll is valid input)', async () => {
    await dispatchScrollWheel(1, 600, 400, 0, 0);
    const call = getMockDebugger().sendCommand.mock.calls.find(
      (c: unknown[]) => c[1] === 'Input.dispatchMouseEvent',
    )!;
    const params = call[2] as { deltaX: number; deltaY: number };
    expect(params.deltaX).toBe(0);
    expect(params.deltaY).toBe(0);
  });

  // ── Error propagation ────────────────────────────────────────────────────

  it('propagates CDP sendCommand errors to the caller', async () => {
    getMockDebugger().sendCommand.mockRejectedValueOnce(new Error('CDP error'));
    await expect(dispatchScrollWheel(1, 600, 400, 0, 500)).rejects.toThrow('CDP error');
  });

  it('propagates debugger attach errors to the caller', async () => {
    getMockDebugger().attach.mockRejectedValueOnce(new Error('attach failed'));
    await expect(dispatchScrollWheel(1, 600, 400, 0, 500)).rejects.toThrow('attach failed');
  });
});
