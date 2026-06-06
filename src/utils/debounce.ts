/** Schedule a debounced callback; returns a cancel function. */
export function scheduleDebounced<T>(
  delayMs: number,
  value: T,
  onUpdate: (value: T) => void,
): () => void {
  const timer = setTimeout(() => onUpdate(value), delayMs);
  return () => clearTimeout(timer);
}
