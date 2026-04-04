import { describe, it, expect, vi, afterEach } from 'vitest';
import { sleep } from '@/utils/sleep';

afterEach(() => {
  vi.useRealTimers();
});

describe('sleep', () => {
  it('resolves with undefined after the given milliseconds', async () => {
    vi.useFakeTimers();
    const p = sleep(500);
    vi.advanceTimersByTime(500);
    await expect(p).resolves.toBeUndefined();
  });

  it('does not resolve before the delay elapses', async () => {
    vi.useFakeTimers();
    let resolved = false;
    sleep(500).then(() => {
      resolved = true;
    });
    vi.advanceTimersByTime(499);
    await Promise.resolve(); // flush microtasks
    expect(resolved).toBe(false);
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('resolves immediately for 0ms delay', async () => {
    vi.useFakeTimers();
    const p = sleep(0);
    vi.advanceTimersByTime(0);
    await expect(p).resolves.toBeUndefined();
  });

  it('returns a Promise', () => {
    vi.useFakeTimers();
    const result = sleep(100);
    expect(result).toBeInstanceOf(Promise);
    vi.advanceTimersByTime(100);
  });
});
