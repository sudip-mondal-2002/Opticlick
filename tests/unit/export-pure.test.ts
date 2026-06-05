import { describe, it, expect } from 'vitest';
import type { ConversationTurn } from '@/utils/types';
import type { VFSFile } from '@/utils/db';
import {
  inferStartUrl,
  extractSummary,
  extractMemoryUpdates,
  groupTurnsIntoSteps,
  fileToExportEntry,
  isProducedFile,
  formatBytes,
} from '@/utils/export/helpers';
import { exportSessionAsJSON } from '@/utils/export/json';
import { exportSessionAsMarkdown } from '@/utils/export/markdown';
import { buildExportFilename } from '@/utils/export/download';
import { MAX_EMBED_BYTES, EXPORT_VERSION } from '@/utils/export/types';
import type { SessionExportBundle } from '@/utils/export/types';

const BASE_SESSION = {
  id: 42,
  title: 'Research pricing',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  startUrl: 'https://example.com',
  modelId: 'gemini-3.1-flash-lite',
  status: 'completed' as const,
};

const TURNS: ConversationTurn[] = [
  {
    sessionId: 42,
    role: 'user',
    content: '[Step 1] Task: Compare prices\n\n[CONTEXT: The task started on https://example.com. If you are on an unrelated page, navigate back.]',
    ts: 100,
  },
  {
    sessionId: 42,
    role: 'model',
    content: 'I will search for pricing.',
    toolCalls: [{ id: 'tc1', name: 'click', args: { targetId: 5 } }],
    ts: 200,
  },
  {
    sessionId: 42,
    role: 'tool',
    content: 'Clicked element 5.',
    toolCallId: 'tc1',
    toolName: 'click',
    ts: 300,
  },
  {
    sessionId: 42,
    role: 'user',
    content: '[Step 2] Task: Compare prices',
    ts: 350,
  },
  {
    sessionId: 42,
    role: 'model',
    content: 'Task is done.',
    toolCalls: [{ id: 'tc2', name: 'finish', args: { summary: 'Found 3 pricing tiers.' } }],
    ts: 400,
  },
  {
    sessionId: 42,
    role: 'tool',
    content: 'Task complete: Found 3 pricing tiers.',
    toolCallId: 'tc2',
    toolName: 'finish',
    ts: 500,
  },
  {
    sessionId: 42,
    role: 'tool',
    content: 'Memory: saved "pricing/tiers" = [basic, pro, enterprise]',
    toolCallId: 'tc3',
    toolName: 'memory_upsert',
    ts: 600,
  },
];

const SCREENSHOT: VFSFile = {
  id: 'shot-1',
  sessionId: 42,
  name: 'step_1.png',
  mimeType: 'image/png',
  data: 'aGVsbG8=',
  size: 5,
  createdAt: 150,
};

const LARGE_FILE: VFSFile = {
  id: 'big-1',
  sessionId: 42,
  name: 'report.csv',
  mimeType: 'text/csv',
  data: 'x'.repeat(100),
  size: MAX_EMBED_BYTES + 1,
  createdAt: 160,
};

function makeBundle(overrides: Partial<SessionExportBundle> = {}): SessionExportBundle {
  return {
    session: BASE_SESSION,
    turns: TURNS,
    vfsFiles: [SCREENSHOT, LARGE_FILE],
    todo: [{ id: 'find-pricing', title: 'Find pricing', status: 'done' }],
    scratchpad: [{ key: 'notes', value: 'Saw three tiers', updatedAt: 550 }],
    memoryUpdates: extractMemoryUpdates(TURNS),
    summary: extractSummary(TURNS),
    startUrl: BASE_SESSION.startUrl,
    modelId: BASE_SESSION.modelId,
    ...overrides,
  };
}

describe('inferStartUrl', () => {
  it('prefers persisted session startUrl', () => {
    expect(inferStartUrl('https://saved.com', TURNS)).toBe('https://saved.com');
  });

  it('extracts URL from CONTEXT block in turns', () => {
    expect(inferStartUrl(undefined, TURNS)).toBe('https://example.com');
  });

  it('falls back to first navigate tool call', () => {
    const turns: ConversationTurn[] = [
      {
        sessionId: 1,
        role: 'model',
        content: '',
        toolCalls: [{ id: 'n1', name: 'navigate', args: { url: 'https://nav.example' } }],
        ts: 1,
      },
    ];
    expect(inferStartUrl(undefined, turns)).toBe('https://nav.example');
  });
});

describe('extractSummary', () => {
  it('returns text from the last finish tool turn', () => {
    expect(extractSummary(TURNS)).toBe('Found 3 pricing tiers.');
  });

  it('returns undefined when no finish turn exists', () => {
    expect(extractSummary(TURNS.slice(0, 3))).toBeUndefined();
  });
});

describe('extractMemoryUpdates', () => {
  it('parses memory upsert and delete tool turns', () => {
    const updates = extractMemoryUpdates(TURNS);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      action: 'upsert',
      key: 'pricing/tiers',
      content: 'Memory: saved "pricing/tiers" = [basic, pro, enterprise]',
    });
  });
});

describe('groupTurnsIntoSteps', () => {
  it('groups user, model, and tool turns by step number', () => {
    const steps = groupTurnsIntoSteps(TURNS, [SCREENSHOT]);
    expect(steps).toHaveLength(2);
    expect(steps[0].stepNumber).toBe(1);
    expect(steps[0].reasoning).toBe('I will search for pricing.');
    expect(steps[0].toolResults).toHaveLength(1);
    expect(steps[0].screenshot?.name).toBe('step_1.png');
    expect(steps[1].stepNumber).toBe(2);
    expect(steps[1].reasoning).toBe('Task is done.');
  });
});

describe('fileToExportEntry', () => {
  it('embeds files at or below 1 MB', () => {
    const entry = fileToExportEntry(SCREENSHOT);
    expect(entry.embedded).toBe(true);
    expect(entry.data).toBe('aGVsbG8=');
    expect(entry.note).toBeUndefined();
  });

  it('omits data for files above 1 MB', () => {
    const entry = fileToExportEntry(LARGE_FILE);
    expect(entry.embedded).toBe(false);
    expect(entry.data).toBeNull();
    expect(entry.note).toContain('1 MB');
  });
});

describe('isProducedFile', () => {
  it('excludes reserved and screenshot files', () => {
    expect(isProducedFile(SCREENSHOT)).toBe(false);
    expect(isProducedFile({
      ...LARGE_FILE,
      name: '__todo.json',
    })).toBe(false);
    expect(isProducedFile(LARGE_FILE)).toBe(true);
  });
});

describe('exportSessionAsJSON', () => {
  it('produces structured JSON with schema version and file metadata', () => {
    const parsed = JSON.parse(exportSessionAsJSON(makeBundle()));
    expect(parsed.exportVersion).toBe(EXPORT_VERSION);
    expect(parsed.session.title).toBe('Research pricing');
    expect(parsed.summary).toBe('Found 3 pricing tiers.');
    expect(parsed.turns).toHaveLength(TURNS.length);
    expect(parsed.files).toHaveLength(2);
    expect(parsed.files.find((f: { name: string }) => f.name === 'report.csv').embedded).toBe(false);
    expect(parsed.files.find((f: { name: string }) => f.name === 'step_1.png').embedded).toBe(true);
  });
});

describe('exportSessionAsMarkdown', () => {
  it('includes summary, steps, embedded screenshot, and large-file note', () => {
    const md = exportSessionAsMarkdown(makeBundle());
    expect(md).toContain('# Research pricing');
    expect(md).toContain('## Summary');
    expect(md).toContain('Found 3 pricing tiers.');
    expect(md).toContain('### Step 1');
    expect(md).toContain('<details>');
    expect(md).toContain('data:image/png;base64,aGVsbG8=');
    expect(md).toContain('## Files Produced');
    expect(md).toContain('report.csv');
    expect(md).toContain('Exceeds 1 MB');
    expect(md).toContain('## Memory Updates');
    expect(md).toContain('pricing/tiers');
    expect(md).toContain('## Scratchpad');
  });

  it('notes in-progress sessions without a finish summary', () => {
    const md = exportSessionAsMarkdown(makeBundle({ summary: undefined }));
    expect(md).toContain('No finish summary');
  });
});

describe('buildExportFilename', () => {
  it('builds a stable slugged filename', () => {
    expect(buildExportFilename(BASE_SESSION, 'json')).toBe(
      'opticlick-42-research-pricing-2023-11-14.json',
    );
  });
});

describe('formatBytes', () => {
  it('formats human-readable sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
