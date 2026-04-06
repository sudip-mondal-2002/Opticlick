/**
 * Prompt assembly helpers — convert stored session data into LangChain messages.
 *
 * Exports:
 *   buildHistory     — ConversationTurn[] → BaseMessage[]
 *   buildUserMessage — assemble the multipart human turn (text + images)
 */

import { HumanMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { VFSFile, MemoryEntry, ConversationTurn } from './db';
import type { ScratchpadEntry } from './scratchpad';
import type { TodoItem, CoordinateEntry } from './types';
import { formatTodoForPrompt } from './todo';
import { formatMemoryForPrompt } from './memory';
import { formatScratchpadForPrompt } from './scratchpad';
import type { InlineImage } from './llm';

// ── History ───────────────────────────────────────────────────────────────────

/** Convert stored conversation turns into LangChain BaseMessages. */
export function buildHistory(history: ConversationTurn[]): BaseMessage[] {
  return history.map((turn) => {
    if (turn.role === 'tool') {
      return new ToolMessage({
        tool_call_id: turn.toolCallId ?? '',
        content: turn.content,
        name: turn.toolName,
      });
    }
    if (turn.role === 'model' && turn.toolCalls?.length) {
      return new AIMessage({
        content: turn.content,
        tool_calls: turn.toolCalls.map((tc) => ({
          id: tc.id, name: tc.name, args: tc.args, type: 'tool_call' as const,
        })),
      });
    }
    if (turn.role === 'model') return new AIMessage(turn.content);
    return new HumanMessage(turn.content);
  });
}

// ── Context blocks ────────────────────────────────────────────────────────────

function vfsContextBlock(files: VFSFile[]): string {
  if (files.length === 0) return '\n\n**Virtual Filesystem (VFS)** — currently empty';
  const rows = files
    .map((f) => `\`${f.id}\` | \`${f.name}\` | \`${f.mimeType}\` | ${f.size}B | ${new Date(f.createdAt).toISOString()}`)
    .join('\n');
  return `\n\n**Virtual Filesystem (VFS)** — current contents:\n\n${rows}`;
}

function todoContextBlock(todo: TodoItem[]): string {
  if (todo.length > 0) return `\n\n**Todo List**\n\n${formatTodoForPrompt(todo)}`;
  return '\n\n**Todo List** — not created yet. Call `todo_create` this turn.';
}

function annotatedElementsBlock(coordinateMap: CoordinateEntry[]): string {
  if (coordinateMap.length === 0) return '';
  const rows = coordinateMap
    .map((e) => {
      const type = e.inputType ? `${e.tag}(${e.inputType})` : e.tag;
      return `\`[${e.id}]\` \`${type}\` — "${e.text}"`;
    })
    .join('\n');
  return `\n\n**Annotated Elements**\n\n${rows}`;
}

// ── User message ──────────────────────────────────────────────────────────────

/**
 * Assemble the multipart human turn: task text, VFS/todo/memory/scratchpad
 * context, optional reference images, and the annotated screenshot.
 *
 * @param ollamaFormat When true, images use the OpenAI-compatible
 *   `{ type: 'image_url', image_url: { url: '...' } }` format required by
 *   @langchain/ollama. When false (default), uses Gemini-native `{ type: 'image', url: '...' }`.
 */
export function buildUserMessage(
  userPrompt: string,
  vfsFiles: VFSFile[],
  currentTodo: TodoItem[],
  inlineImages: InlineImage[],
  base64Image: string,
  memoryEntries: MemoryEntry[] = [],
  scratchpadEntries: ScratchpadEntry[] = [],
  ollamaFormat = false,
  coordinateMap: CoordinateEntry[] = [],
): HumanMessage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: Array<any> = [
    {
      type: 'text',
      text: `User task: ${userPrompt}${vfsContextBlock(vfsFiles)}${todoContextBlock(currentTodo)}${formatMemoryForPrompt(memoryEntries)}${formatScratchpadForPrompt(scratchpadEntries)}`,
    },
  ];

  const imageBlock = (dataUrl: string) =>
    ollamaFormat
      ? { type: 'image_url', image_url: { url: dataUrl } }
      : { type: 'image', url: dataUrl };

  if (inlineImages.length > 0) {
    content.push({ type: 'text', text: `\n\n── User-provided reference images (${inlineImages.length}) ──` });
    for (const img of inlineImages) {
      content.push({ type: 'text', text: `[${img.name}]` });
      content.push(imageBlock(`data:${img.mimeType};base64,${img.data}`));
    }
  }

  content.push({
    type: 'text',
    text: `\n\nAnalyze the annotated screenshot and call the appropriate tools.${annotatedElementsBlock(coordinateMap)}`,
  });
  content.push(imageBlock(`data:image/png;base64,${base64Image}`));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new HumanMessage({ content: content as any });
}
