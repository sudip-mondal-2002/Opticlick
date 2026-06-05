<<<<<<< Updated upstream
export {
  createSession,
  getSession,
  getSession as getSessionById,
  getSessions,
  touchSession,
  updateSession,
  updateSessionMetadata,
  appendToSessionSearchText,
} from './sessions';
export type { CreateSessionOptions, SessionMetadataPatch } from './sessions';
=======
export { createSession, getSessions, getSessionById, touchSession, updateSessionFields } from './sessions';
>>>>>>> Stashed changes
export { appendConversationTurn, getConversationHistory } from './conversations';
export type { ConversationTurn } from './conversations';
export { saveVFSFile, getVFSFile, listVFSFiles, deleteVFSFile, writeVFSFile, clearVFSFiles } from './vfs';
export type { VFSFile } from './vfs';
export { upsertMemory, getAllMemories, deleteMemory } from './memory';
export type { MemoryEntry } from './memory';
