import { describe, it, expect, vi, afterEach } from 'vitest';
import { scheduleDebounced } from '@/utils/debounce';

afterEach(() => {
  vi.useRealTimers();
});

describe('scheduleDebounced', () => {
  it('invokes callback after delay', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    scheduleDebounced(200, 'hello', fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledWith('hello');
  });

  it('cancel prevents callback', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const cancel = scheduleDebounced(200, 'hello', fn);
    cancel();
    vi.advanceTimersByTime(300);
    expect(fn).not.toHaveBeenCalled();
  });
});
