import type { Session } from './types';
import type { ConversationTurn } from './db/conversations';
import { getConversationHistory, updateSessionMetadata } from './db';
import { buildSearchText, parseStartUrlFromContent } from './session-search-text';

function sessionNeedsBackfill(session: Session): boolean {
  return session.id != null && (!session.searchText || !session.startUrl);
}

function extractMetadataFromHistory(
  session: Session,
  turns: ConversationTurn[],
): { startUrl?: string; searchText?: string } {
  const patch: { startUrl?: string; searchText?: string } = {};
  const searchParts: string[] = [session.title];
  let hasUserOrModelTurns = false;

  for (const turn of turns) {
    if (turn.role !== 'user' && turn.role !== 'model') continue;
    hasUserOrModelTurns = true;
    searchParts.push(turn.content);
    if (!session.startUrl && !patch.startUrl) {
      const url = parseStartUrlFromContent(turn.content);
      if (url) patch.startUrl = url;
    }
  }

  if (hasUserOrModelTurns) {
    const fullSearchText = buildSearchText(...searchParts);
    const titleOnlyText = buildSearchText(session.title);
    if (!session.searchText || session.searchText === titleOnlyText) {
      patch.searchText = fullSearchText;
    }
  }

  return patch;
}

/** Backfill missing startUrl/searchText for legacy sessions from conversation history. */
export async function backfillSessionMetadata(sessions: Session[]): Promise<number> {
  const targets = sessions.filter(sessionNeedsBackfill);
  let updated = 0;

  for (const session of targets) {
    if (session.id == null) continue;
    const history = await getConversationHistory(session.id);
    const patch = extractMetadataFromHistory(session, history);
    if (!patch.startUrl && !patch.searchText) continue;
    await updateSessionMetadata(session.id, patch);
    updated++;
  }

  return updated;
}
