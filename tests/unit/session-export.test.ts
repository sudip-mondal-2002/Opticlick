import { describe, it, expect } from 'vitest';
import {
  buildSessionExportPayload,
  mapVfsFilesForExport,
  serializeSessionExportJson,
  serializeSessionExportMarkdown,
  sessionExportFilename,
  LARGE_FILE_THRESHOLD_BYTES,
  EXPORT_VERSION,
} from '@/utils/export';
import type { SessionExportInput } from '@/utils/export';
import type { ConversationTurn } from '@/utils/db';

function makeInput(overrides: Partial<SessionExportInput> = {}): SessionExportInput {
  const now = Date.now();
  return {
    session: {
      id: 1,
      title: 'Find product price',
      createdAt: now - 60_000,
      updatedAt: now,
      modelId: 'gemini-3.1-flash-lite-preview',
      startingUrl: 'https://example.com',
      status: 'completed',
      finishSummary: 'The price is $19.99.',
    },
    conversation: [
      { sessionId: 1, role: 'user', content: 'User task: Find product price', ts: now - 50_000 },
      {
        sessionId: 1,
        role: 'model',
        content: 'I will click the search box.',
        ts: now - 40_000,
        toolCalls: [{ id: 'tc1', name: 'click', args: { targetId: 3 } }],
      },
      {
        sessionId: 1,
        role: 'tool',
        content: 'Task complete: The price is $19.99.',
        ts: now - 10_000,
        toolCallId: 'tc2',
        toolName: 'finish',
      },
    ],
    vfsFiles: [
      {
        id: 'small-img',
        name: 'step_1.png',
        mimeType: 'image/png',
        size: 512,
        createdAt: now - 45_000,
        data: 'aGVsbG8=',
      },
      {
        id: 'large-img',
        name: 'step_2.png',
        mimeType: 'image/png',
        size: LARGE_FILE_THRESHOLD_BYTES + 1,
        createdAt: now - 35_000,
        data: 'bGFyZ2U=',
      },
      {
        id: 'notes-file',
        name: 'notes.txt',
        mimeType: 'text/plain',
        size: 24,
        createdAt: now - 20_000,
        data: btoa('exported notes'),
      },
    ],
    todos: [{ id: 'find-price', title: 'Find product price', status: 'done' }],
    scratchpad: [{ key: 'price', value: '$19.99', updatedAt: now - 15_000 }],
    ...overrides,
  };
}

describe('mapVfsFilesForExport', () => {
  it('embeds files at or below 1 MB and references larger files', () => {
    const files = mapVfsFilesForExport([
      { id: 'a', name: 'small.bin', mimeType: 'application/octet-stream', size: 100, createdAt: 1, data: 'abc' },
      { id: 'b', name: 'large.bin', mimeType: 'application/octet-stream', size: LARGE_FILE_THRESHOLD_BYTES + 1, createdAt: 2, data: 'xyz' },
    ]);

    expect(files[0].embedded).toBe(true);
    expect(files[0].data).toBe('abc');
    expect(files[1].embedded).toBe(false);
    expect(files[1].data).toBeUndefined();
  });
});

describe('buildSessionExportPayload', () => {
  it('builds a completed session payload with model and task outcome', () => {
    const payload = buildSessionExportPayload(makeInput());

    expect(payload.exportVersion).toBe(EXPORT_VERSION);
    expect(payload.status).toBe('completed');
    expect(payload.model.modelId).toBe('gemini-3.1-flash-lite-preview');
    expect(payload.model.provider).toBe('gemini');
    expect(payload.taskOutcome.summary).toBe('The price is $19.99.');
    expect(payload.initialPrompt).toBe('Find product price');
    expect(payload.conversation).toHaveLength(3);
    expect(payload.todos[0].status).toBe('done');
    expect(payload.scratchpad[0].value).toBe('$19.99');
  });

  it('marks in-progress sessions and includes runtime logs', () => {
    const payload = buildSessionExportPayload(makeInput({
      session: {
        ...makeInput().session,
        status: 'in_progress',
        finishSummary: undefined,
      },
      agentState: {
        status: 'running',
        sessionId: 1,
        step: 4,
        prompt: 'Find product price',
      },
      runtimeLogs: [{ message: 'Screenshot captured', level: 'screenshot', ts: Date.now() }],
      conversation: makeInput().conversation.slice(0, 2),
    }));

    expect(payload.status).toBe('in_progress');
    expect(payload.currentStep).toBe(4);
    expect(payload.runtimeLogs).toHaveLength(1);
    expect(payload.taskOutcome.summary).toBeUndefined();
  });

  it('extracts memory updates from model tool calls', () => {
    const memoryTurn: ConversationTurn = {
      sessionId: 1,
      role: 'model',
      content: 'Saving account info.',
      ts: Date.now(),
      toolCalls: [{
        id: 'mem1',
        name: 'memory_upsert',
        args: { key: 'shop/username', values: ['buyer1'], category: 'account', sourceUrl: 'https://shop.example' },
      }],
    };

    const payload = buildSessionExportPayload(makeInput({
      conversation: [...makeInput().conversation, memoryTurn],
    }));

    expect(payload.memoryUpdates.some((m) => m.action === 'memory_upsert' && m.key === 'shop/username')).toBe(true);
  });
});

describe('serializeSessionExportJson', () => {
  it('produces structured JSON with file metadata', () => {
    const payload = buildSessionExportPayload(makeInput());
    const json = serializeSessionExportJson(payload);
    const parsed = JSON.parse(json) as ReturnType<typeof buildSessionExportPayload>;

    expect(parsed.exportVersion).toBe(EXPORT_VERSION);
    expect(parsed.vfsFiles).toHaveLength(3);
    expect(parsed.vfsFiles.find((f) => f.id === 'small-img')?.embedded).toBe(true);
    expect(parsed.vfsFiles.find((f) => f.id === 'large-img')?.embedded).toBe(false);
    expect(parsed.vfsFiles.find((f) => f.id === 'large-img')?.data).toBeUndefined();
  });
});

describe('serializeSessionExportMarkdown', () => {
  it('renders a readable report with conversation, screenshots, and files', () => {
    const payload = buildSessionExportPayload(makeInput());
    const markdown = serializeSessionExportMarkdown({ ...payload, format: 'markdown' });

    expect(markdown).toContain('# Opticlick Session Export');
    expect(markdown).toContain('## Summary');
    expect(markdown).toContain('Find product price');
    expect(markdown).toContain('## Task Outcome');
    expect(markdown).toContain('The price is $19.99.');
    expect(markdown).toContain('## Conversation');
    expect(markdown).toContain('## Screenshots');
    expect(markdown).toContain('data:image/png;base64,aGVsbG8=');
    expect(markdown).toContain('File not embedded (exceeds 1 MB)');
    expect(markdown).toContain('vfs://large-img');
    expect(markdown).toContain('## Generated Files');
    expect(markdown).toContain('exported notes');
  });

  it('includes runtime logs for in-progress exports', () => {
    const payload = buildSessionExportPayload(makeInput({
      session: { ...makeInput().session, status: 'in_progress', finishSummary: undefined },
      agentState: { status: 'running', sessionId: 1, step: 2 },
      runtimeLogs: [{ message: 'Agent started', level: 'observe', ts: Date.now() }],
    }));

    const markdown = serializeSessionExportMarkdown({ ...payload, format: 'markdown' });
    expect(markdown).toContain('## Runtime Log (in-progress export)');
    expect(markdown).toContain('Agent started');
    expect(markdown).toContain('Current step:** 2');
  });
});

describe('sessionExportFilename', () => {
  it('slugifies the session title and uses the correct extension', () => {
    expect(sessionExportFilename('Find Product Price!', 'json')).toMatch(/^opticlick-find-product-price-\d{4}-\d{2}-\d{2}\.json$/);
    expect(sessionExportFilename('Find Product Price!', 'markdown')).toMatch(/^opticlick-find-product-price-\d{4}-\d{2}-\d{2}\.md$/);
  });
});
