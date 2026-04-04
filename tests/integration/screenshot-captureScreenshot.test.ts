import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface FakeTab { id: number; windowId: number; active?: boolean }

// Enough base64 chars to pass the MIN_VALID_B64_LENGTH (6 000) check.
const VALID_B64 = 'A'.repeat(7_000);
const BLANK_B64 = 'A'.repeat(100); // too short → treated as blank/throttled

function installTabsMock(
  tabs: FakeTab[],
  captureVisibleResult = `data:image/png;base64,${VALID_B64}`,
) {
  const g = globalThis as Record<string, unknown>;
  const chrome = (g.chrome ?? {}) as Record<string, unknown>;

  const tabsMock = {
    get: vi.fn(async (tabId: number) => {
      const t = tabs.find((x) => x.id === tabId);
      if (!t) throw new Error(`No tab ${tabId}`);
      return t;
    }),
    query: vi.fn(async ({ active, windowId }: { active?: boolean; windowId?: number }) =>
      tabs.filter(
        (t) =>
          (active === undefined || t.active === active) &&
          (windowId === undefined || t.windowId === windowId),
      ),
    ),
    update: vi.fn(async (tabId: number, props: { active?: boolean }) => {
      const winId = tabs.find((x) => x.id === tabId)?.windowId;
      for (const t of tabs) {
        if (t.windowId === winId) t.active = t.id === tabId ? (props.active ?? t.active) : false;
      }
      return tabs.find((t) => t.id === tabId);
    }),
    captureVisibleTab: vi.fn(async () => captureVisibleResult),
  };

  g.chrome = { ...chrome, tabs: tabsMock };
  return tabsMock;
}

function getDebuggerMock() {
  const g = globalThis as Record<string, unknown>;
  return (g.chrome as Record<string, unknown>).debugger as {
    attach: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('captureScreenshot', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // ── CDP fast path (no flicker) ─────────────────────────────────────────────

  it('uses CDP Page.captureScreenshot when the tab is not active (no tab switch)', async () => {
    const tabs = [
      { id: 1, windowId: 10, active: false }, // target (Tab A)
      { id: 2, windowId: 10, active: true },  // user's visible tab (Tab B)
    ];
    const tabsMock = installTabsMock(tabs);
    const debugger_ = getDebuggerMock();
    debugger_.sendCommand.mockResolvedValue({ data: VALID_B64 });

    const { captureScreenshot } = await import('@/utils/screenshot');
    const result = await captureScreenshot(1);

    // Returns the CDP data directly.
    expect(result).toBe(VALID_B64);
    // No tab switching — user sees no flicker.
    expect(tabsMock.update).not.toHaveBeenCalled();
    expect(tabsMock.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('returns raw base64 (no data-URI prefix) when CDP path succeeds', async () => {
    installTabsMock([{ id: 1, windowId: 10, active: true }]);
    const debugger_ = getDebuggerMock();
    debugger_.sendCommand.mockResolvedValue({ data: VALID_B64 });

    const { captureScreenshot } = await import('@/utils/screenshot');
    const result = await captureScreenshot(1);

    expect(result).toBe(VALID_B64);
    expect(result).not.toContain('data:image/png;base64,');
  });

  // ── Fallback path (tab switch) ─────────────────────────────────────────────

  it('falls back to captureVisibleTab when CDP returns a blank/throttled frame', async () => {
    const tabs = [
      { id: 1, windowId: 10, active: false },
      { id: 2, windowId: 10, active: true },
    ];
    const tabsMock = installTabsMock(tabs, `data:image/png;base64,${VALID_B64}`);
    const debugger_ = getDebuggerMock();
    // CDP returns a tiny payload → treated as blank.
    debugger_.sendCommand.mockResolvedValue({ data: BLANK_B64 });

    const { captureScreenshot } = await import('@/utils/screenshot');
    const result = await captureScreenshot(1);

    expect(tabsMock.captureVisibleTab).toHaveBeenCalled();
    expect(result).toBe(VALID_B64);
  });

  it('falls back to captureVisibleTab when CDP Page.captureScreenshot throws', async () => {
    const tabs = [
      { id: 1, windowId: 10, active: false },
      { id: 2, windowId: 10, active: true },
    ];
    const tabsMock = installTabsMock(tabs, `data:image/png;base64,${VALID_B64}`);
    const debugger_ = getDebuggerMock();
    debugger_.sendCommand.mockRejectedValue(new Error('Cannot attach to chrome:// page'));

    const { captureScreenshot } = await import('@/utils/screenshot');
    await captureScreenshot(1);

    expect(tabsMock.captureVisibleTab).toHaveBeenCalled();
  });

  it('temporarily activates target tab during fallback, then restores previous tab', async () => {
    const tabs = [
      { id: 1, windowId: 10, active: false },
      { id: 2, windowId: 10, active: true },
    ];
    const tabsMock = installTabsMock(tabs, `data:image/png;base64,${VALID_B64}`);
    const debugger_ = getDebuggerMock();
    debugger_.sendCommand.mockResolvedValue({ data: BLANK_B64 });

    const { captureScreenshot } = await import('@/utils/screenshot');
    await captureScreenshot(1);

    expect(tabsMock.update).toHaveBeenCalledWith(1, { active: true });
    expect(tabsMock.update).toHaveBeenCalledWith(2, { active: true });
  });

  it('restores original tab in fallback even when captureVisibleTab throws on every attempt', async () => {
    const tabs = [
      { id: 1, windowId: 10, active: false },
      { id: 2, windowId: 10, active: true },
    ];
    const tabsMock = installTabsMock(tabs);
    const debugger_ = getDebuggerMock();
    // CDP returns blank on every attempt, forcing the captureVisibleTab fallback each time.
    debugger_.sendCommand.mockResolvedValue({ data: BLANK_B64 });
    // captureVisibleTab fails on every attempt → all retries exhaust.
    tabsMock.captureVisibleTab.mockRejectedValue(new Error('image readback failed'));

    const { captureScreenshot } = await import('@/utils/screenshot');
    await expect(captureScreenshot(1)).rejects.toThrow('image readback failed');

    // Tab B must be restored after every attempt despite the errors.
    expect(tabsMock.update).toHaveBeenCalledWith(2, { active: true });
  });

  it('retries and succeeds when captureVisibleTab fails on the first attempt', async () => {
    const tabs = [
      { id: 1, windowId: 10, active: false },
      { id: 2, windowId: 10, active: true },
    ];
    const tabsMock = installTabsMock(tabs, `data:image/png;base64,${VALID_B64}`);
    const debugger_ = getDebuggerMock();
    debugger_.sendCommand.mockResolvedValue({ data: BLANK_B64 });
    // First call throws; second call succeeds.
    tabsMock.captureVisibleTab
      .mockRejectedValueOnce(new Error('image readback failed'))
      .mockResolvedValue(`data:image/png;base64,${VALID_B64}`);

    const { captureScreenshot } = await import('@/utils/screenshot');
    const result = await captureScreenshot(1);
    expect(result).toBe(VALID_B64);
    expect(tabsMock.captureVisibleTab).toHaveBeenCalledTimes(2);
  });

  it('does not switch tabs during fallback when the target is already active', async () => {
    const tabs = [{ id: 1, windowId: 10, active: true }];
    const tabsMock = installTabsMock(tabs, `data:image/png;base64,${VALID_B64}`);
    const debugger_ = getDebuggerMock();
    debugger_.sendCommand.mockResolvedValue({ data: BLANK_B64 });

    const { captureScreenshot } = await import('@/utils/screenshot');
    await captureScreenshot(1);

    expect(tabsMock.update).not.toHaveBeenCalled();
  });

  it('passes the correct windowId to captureVisibleTab in fallback', async () => {
    const tabs = [{ id: 5, windowId: 99, active: true }];
    const tabsMock = installTabsMock(tabs, `data:image/png;base64,${VALID_B64}`);
    const debugger_ = getDebuggerMock();
    debugger_.sendCommand.mockResolvedValue({ data: BLANK_B64 });

    const { captureScreenshot } = await import('@/utils/screenshot');
    await captureScreenshot(5);

    expect(tabsMock.captureVisibleTab).toHaveBeenCalledWith(99, expect.objectContaining({ format: 'png' }));
  });
});
