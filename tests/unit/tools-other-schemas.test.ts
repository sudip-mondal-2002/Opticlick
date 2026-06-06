import { describe, it, expect } from 'vitest';
import { finishTool, waitTool, askUserTool } from '@/utils/tools/control';
import { clickTool, typeTool, navigateTool, scrollTool, pressKeyTool, dragAndDropTool } from '@/utils/tools/ui';
import { fetchDOMTool } from '@/utils/tools/dom';
import { vfsSaveScreenshotTool, vfsWriteTool, vfsDeleteTool, vfsDownloadTool } from '@/utils/tools/vfs';
import { memoryUpsertTool, memoryDeleteTool } from '@/utils/tools/memory';
import { noteWriteTool, noteDeleteTool } from '@/utils/tools/scratchpad';

describe('Agent tool definitions and execution functions', () => {
  describe('Control tools', () => {
    it('finishTool returns ok', async () => {
      expect(finishTool.name).toBe('finish');
      expect(await finishTool.invoke({ summary: 'task done' })).toBe('ok');
    });

    it('waitTool returns ok', async () => {
      expect(waitTool.name).toBe('wait');
      expect(await waitTool.invoke({ ms: 500 })).toBe('ok');
    });

    it('askUserTool returns ok', async () => {
      expect(askUserTool.name).toBe('ask_user');
      expect(await askUserTool.invoke({ question: 'proceed?' })).toBe('ok');
    });
  });

  describe('UI tools', () => {
    it('clickTool returns ok', async () => {
      expect(clickTool.name).toBe('click');
      expect(await clickTool.invoke({ targetId: 1, modifier: 'ctrl' })).toBe('ok');
    });

    it('typeTool returns ok', async () => {
      expect(typeTool.name).toBe('type');
      expect(await typeTool.invoke({ text: 'hello', clearField: true })).toBe('ok');
    });

    it('navigateTool returns ok', async () => {
      expect(navigateTool.name).toBe('navigate');
      expect(await navigateTool.invoke({ url: 'https://example.com' })).toBe('ok');
    });

    it('scrollTool returns ok', async () => {
      expect(scrollTool.name).toBe('scroll');
      expect(await scrollTool.invoke({ direction: 'down', scrollTargetId: 2 })).toBe('ok');
    });

    it('pressKeyTool returns ok', async () => {
      expect(pressKeyTool.name).toBe('press_key');
      expect(await pressKeyTool.invoke({ key: 'Enter' })).toBe('ok');
    });

    it('dragAndDropTool returns ok', async () => {
      expect(dragAndDropTool.name).toBe('drag_and_drop');
      expect(await dragAndDropTool.invoke({ sourceId: 1, targetId: 2 })).toBe('ok');
    });
  });

  describe('DOM inspection tool', () => {
    it('fetchDOMTool returns ok', async () => {
      expect(fetchDOMTool.name).toBe('fetch_dom');
      expect(await fetchDOMTool.invoke({ targetId: 1 })).toBe('ok');
    });
  });

  describe('VFS tools', () => {
    it('vfsSaveScreenshotTool returns ok', async () => {
      expect(vfsSaveScreenshotTool.name).toBe('vfs_save_screenshot');
      expect(await vfsSaveScreenshotTool.invoke({ name: 'shot.png' })).toBe('ok');
    });

    it('vfsWriteTool returns ok', async () => {
      expect(vfsWriteTool.name).toBe('vfs_write');
      expect(await vfsWriteTool.invoke({ name: 'out.txt', content: 'hello' })).toBe('ok');
    });

    it('vfsDeleteTool returns ok', async () => {
      expect(vfsDeleteTool.name).toBe('vfs_delete');
      expect(await vfsDeleteTool.invoke({ fileId: 'id-123' })).toBe('ok');
    });

    it('vfsDownloadTool returns ok', async () => {
      expect(vfsDownloadTool.name).toBe('vfs_download');
      expect(await vfsDownloadTool.invoke({ url: 'https://foo.com/file' })).toBe('ok');
    });
  });

  describe('Memory tools', () => {
    it('memoryUpsertTool returns ok', async () => {
      expect(memoryUpsertTool.name).toBe('memory_upsert');
      expect(await memoryUpsertTool.invoke({ key: 'k', values: ['v'], category: 'other' })).toBe('ok');
    });

    it('memoryDeleteTool returns ok', async () => {
      expect(memoryDeleteTool.name).toBe('memory_delete');
      expect(await memoryDeleteTool.invoke({ key: 'k' })).toBe('ok');
    });
  });

  describe('Scratchpad tools', () => {
    it('noteWriteTool returns ok', async () => {
      expect(noteWriteTool.name).toBe('note_write');
      expect(await noteWriteTool.invoke({ key: 'k', value: 'v' })).toBe('ok');
    });

    it('noteDeleteTool returns ok', async () => {
      expect(noteDeleteTool.name).toBe('note_delete');
      expect(await noteDeleteTool.invoke({ key: 'k' })).toBe('ok');
    });
  });
});
