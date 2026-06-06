import { describe, it, expect } from 'vitest';
import { createSession, saveVFSFile } from '@/utils/db';
import { loadScratchpadFromVFS, saveScratchpadToVFS, type ScratchpadEntry } from '@/utils/scratchpad';

const SAMPLE_ENTRIES: ScratchpadEntry[] = [
  { key: 'key1', value: 'value1', updatedAt: 1000 },
  { key: 'key2', value: 'value2', updatedAt: 2000 },
];

describe('saveScratchpadToVFS + loadScratchpadFromVFS', () => {
  it('round-trips: save then load returns identical entries', async () => {
    const sid = await createSession('Scratchpad RT');
    await saveScratchpadToVFS(sid, SAMPLE_ENTRIES);
    const loaded = await loadScratchpadFromVFS(sid);
    expect(loaded).toEqual(SAMPLE_ENTRIES);
  });

  it('loadScratchpadFromVFS returns empty array when no scratchpad file exists', async () => {
    const sid = await createSession('Empty Scratchpad');
    const result = await loadScratchpadFromVFS(sid);
    expect(result).toEqual([]);
  });

  it('loadScratchpadFromVFS returns empty array when stored file contains invalid JSON', async () => {
    const sid = await createSession('Bad Scratchpad JSON');
    const invalidBase64 = btoa('invalid json {{{');
    await saveVFSFile(sid, '__scratchpad.json', invalidBase64, 'application/json');
    const result = await loadScratchpadFromVFS(sid);
    expect(result).toEqual([]);
  });

  it('second saveScratchpadToVFS overwrites the first', async () => {
    const sid = await createSession('Overwrite Scratchpad');
    await saveScratchpadToVFS(sid, SAMPLE_ENTRIES);
    const updated: ScratchpadEntry[] = [{ key: 'key3', value: 'val3', updatedAt: 3000 }];
    await saveScratchpadToVFS(sid, updated);
    const loaded = await loadScratchpadFromVFS(sid);
    expect(loaded).toEqual(updated);
  });

  it('Unicode values survive the base64 round-trip', async () => {
    const sid = await createSession('Unicode Scratchpad');
    const unicodeEntries: ScratchpadEntry[] = [
      { key: 'lang', value: 'Cliquez sur le bouton ✓ 日本語', updatedAt: 1000 },
    ];
    await saveScratchpadToVFS(sid, unicodeEntries);
    const loaded = await loadScratchpadFromVFS(sid);
    expect(loaded![0].value).toBe('Cliquez sur le bouton ✓ 日本語');
  });
});
