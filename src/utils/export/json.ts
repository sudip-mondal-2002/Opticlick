import { EXPORT_VERSION, type SessionExportBundle } from './types';
import { fileToExportEntry } from './helpers';

export function exportSessionAsJSON(bundle: SessionExportBundle): string {
  const payload = {
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    session: {
      ...bundle.session,
      startUrl: bundle.startUrl ?? bundle.session.startUrl,
      modelId: bundle.modelId ?? bundle.session.modelId,
    },
    summary: bundle.summary ?? null,
    turns: bundle.turns,
    todo: bundle.todo,
    scratchpad: bundle.scratchpad,
    memoryUpdates: bundle.memoryUpdates,
    files: bundle.vfsFiles.map(fileToExportEntry),
  };

  return JSON.stringify(payload, null, 2);
}
