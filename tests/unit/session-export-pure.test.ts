import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSessionExportData, exportSessionAsJson, exportSessionAsMarkdown } from '@/utils/session-export';
import { getSession, getConversationHistory, listVFSFiles } from '@/utils/db';
import { getAgentState } from '@/utils/agent-state';

vi.mock('@/utils/db', () => ({
  getSession: vi.fn(),
  getConversationHistory: vi.fn(),
  listVFSFiles: vi.fn(),
}));

vi.mock('@/utils/agent-state', () => ({
  getAgentState: vi.fn(),
}));

describe('session-export', () => {
  const mockSession = {
    id: 1,
    title: 'Test Session',
    createdAt: 1000,
    updatedAt: 2000,
    modelId: 'test-model',
  };

  const mockTurns = [
    { role: 'user', content: 'hello', ts: 1000 },
    { role: 'model', content: 'world', ts: 1001, toolCalls: [] }
  ];

  const mockFiles = [
    { id: '1', name: 'test.txt', mimeType: 'text/plain', size: 100, createdAt: 1002, data: btoa('hello world') }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(mockSession as any);
    vi.mocked(getConversationHistory).mockResolvedValue(mockTurns as any);
    vi.mocked(listVFSFiles).mockResolvedValue(mockFiles as any);
    vi.mocked(getAgentState).mockResolvedValue({ sessionId: 1, status: 'done', step: 1 } as any);
  });

  describe('getSessionExportData', () => {
    it('throws if session is not found', async () => {
      vi.mocked(getSession).mockResolvedValue(null as any);
      await expect(getSessionExportData(999)).rejects.toThrow('Session with ID 999 not found');
    });

    it('returns structured data correctly for completed session via agent state', async () => {
      const data = await getSessionExportData(1);
      expect(data.session.status).toBe('completed');
      expect(data.session.outcomeSummary).toBe(''); // empty string because no finish tool call
      expect(data.conversation).toHaveLength(2);
      expect(data.files).toHaveLength(1);
      expect(data.files[0].isEmbedded).toBe(true);
      expect(data.memoryUpdates).toHaveLength(0);
    });

    it('detects completed status and outcome from finish tool call', async () => {
      vi.mocked(getConversationHistory).mockResolvedValue([
        ...mockTurns,
        {
          role: 'model',
          ts: 1005,
          toolCalls: [{ name: 'finish', args: { summary: 'Task done' } }]
        }
      ] as any);

      const data = await getSessionExportData(1);
      expect(data.session.status).toBe('completed');
      expect(data.session.outcomeSummary).toBe('Task done');
    });

    it('detects in_progress status via agent state', async () => {
      vi.mocked(getAgentState).mockResolvedValue({ sessionId: 1, status: 'running', step: 1 } as any);
      const data = await getSessionExportData(1);
      expect(data.session.status).toBe('in_progress');
    });

    it('handles large files by omitting their data', async () => {
      vi.mocked(listVFSFiles).mockResolvedValue([
        { id: '2', name: 'big.mp4', mimeType: 'video/mp4', size: 2 * 1024 * 1024, createdAt: 1000, data: 'dummy_b64' }
      ] as any);
      
      const data = await getSessionExportData(1);
      expect(data.files[0].isEmbedded).toBe(false);
      expect(data.files[0].data).toBeNull();
      expect(data.files[0].message).toContain('exceeds 1 MB');
    });

    it('extracts memory updates', async () => {
      vi.mocked(getConversationHistory).mockResolvedValue([
        {
          role: 'model',
          ts: 1005,
          toolCalls: [
            { name: 'memory_upsert', args: { key: 'user_name', values: ['Alice'], category: 'info' } },
            { name: 'memory_delete', args: { key: 'old_data' } }
          ]
        }
      ] as any);

      const data = await getSessionExportData(1);
      expect(data.memoryUpdates).toHaveLength(2);
      expect(data.memoryUpdates[0].action).toBe('upsert');
      expect(data.memoryUpdates[0].key).toBe('user_name');
      expect(data.memoryUpdates[1].action).toBe('delete');
      expect(data.memoryUpdates[1].key).toBe('old_data');
    });
  });

  describe('exportSessionAsJson', () => {
    it('returns a JSON string containing session data', async () => {
      const jsonStr = await exportSessionAsJson(1);
      const parsed = JSON.parse(jsonStr);
      expect(parsed.session.id).toBe(1);
      expect(parsed.files[0].name).toBe('test.txt');
    });
  });

  describe('exportSessionAsMarkdown', () => {
    it('returns a formatted markdown string', async () => {
      // Mock step screenshot to test screenshot embedding logic
      vi.mocked(getConversationHistory).mockResolvedValue([
        { role: 'user', content: '[Step 1] Initializing', ts: 1000 },
        { role: 'model', content: JSON.stringify({ reasoning: 'Looking at screen' }), ts: 1001, toolCalls: [] }
      ] as any);
      
      vi.mocked(listVFSFiles).mockResolvedValue([
        { id: '1', name: 'step_1.png', mimeType: 'image/png', size: 500, createdAt: 1002, data: btoa('fake_img') }
      ] as any);

      const mdStr = await exportSessionAsMarkdown(1);
      expect(mdStr).toContain('# Session Report: Test Session');
      expect(mdStr).toContain('## Session Metadata');
      expect(mdStr).toContain('**Session ID** | 1');
      expect(mdStr).toContain('**Model** | test-model');
      expect(mdStr).toContain('## Conversation History');
      expect(mdStr).toContain('**USER**');
      expect(mdStr).toContain('[Step 1] Initializing');
      expect(mdStr).toContain('**MODEL**');
      expect(mdStr).toContain('**Reasoning**:');
      expect(mdStr).toContain('Looking at screen');
      expect(mdStr).toContain('**Step Screenshot**:');
      expect(mdStr).toContain('![Screenshot step_1.png]');
    });
  });
});
