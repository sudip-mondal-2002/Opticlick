/** Shared context passed to every UI action handler. */
export interface ActionCtx {
  tabId: number;
  sessionId: number;
  step: number;
  userPrompt: string;
  toolCallId: string;
  toolName: string;
}
