import type { ReactNode } from 'react';

export interface TextSegment {
  text: string;
  match: boolean;
}

/** Split text into match / non-match segments (case-insensitive). */
export function splitByMatch(text: string, query: string): TextSegment[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];

  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const segments: TextSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const idx = lowerText.indexOf(lowerQ, cursor);
    if (idx === -1) {
      segments.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (idx > cursor) {
      segments.push({ text: text.slice(cursor, idx), match: false });
    }
    segments.push({ text: text.slice(idx, idx + q.length), match: true });
    cursor = idx + q.length;
  }

  return segments.length ? segments : [{ text, match: false }];
}

interface HighlightedTextProps {
  text: string;
  query: string;
  className?: string;
  markClassName?: string;
}

/** Render text with matching substrings wrapped in <mark>. */
export function HighlightedText({
  text,
  query,
  className,
  markClassName = 'bg-amber-100 dark:bg-amber-900/50 text-inherit rounded-sm',
}: HighlightedTextProps): ReactNode {
  const segments = splitByMatch(text, query);
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark key={i} className={markClassName}>
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}
