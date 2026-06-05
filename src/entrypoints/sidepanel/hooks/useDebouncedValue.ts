import { useEffect, useState } from 'react';
import { scheduleDebounced } from '@/utils/debounce';

/** Returns a debounced copy of `value` after `delayMs` of stability. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    return scheduleDebounced(delayMs, value, setDebounced);
  }, [value, delayMs]);

  return debounced;
}
