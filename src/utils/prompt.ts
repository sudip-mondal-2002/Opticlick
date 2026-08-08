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
import { selectRelevantElements, selectRelevantPageText } from './text-agent-context';

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
  const header = '| file_id | file_name | file_type | file_size | created_at |';
  const separator = '| ---- | ---- | ---- | ---- | ---- |';
  const rows = files
    .map((f) => `| \`${f.id}\` | \`${f.name}\` | \`${f.mimeType}\` | ${f.size}B | ${new Date(f.createdAt).toISOString()} |`)
    .join('\n');
  return `\n\n**Virtual Filesystem (VFS)** — current contents:\n\n${header}\n${separator}\n${rows}`;
}

function todoContextBlock(todo: TodoItem[]): string {
  if (todo.length === 0) return '\n\n**Todo List** — not created yet. Call `todo_create` this turn.';
  return `\n\n**Todo List**\n\n${formatTodoForPrompt(todo)}`;
}

function annotatedElementsBlock(coordinateMap: CoordinateEntry[], limit = coordinateMap.length): string {
  if (coordinateMap.length === 0) return '';
  const rows = coordinateMap.slice(0, limit)
    .map((e) => {
      const type = e.inputType ? `${e.tag}(${e.inputType})` : e.tag;
      const text = e.text.length > 48 ? `${e.text.slice(0, 45)}...` : e.text;
      return `\`[${e.id}]\` \`${type}\` — "${text}"`;
    })
    .join('\n');
  return `\n\n---\n\n**Annotated Elements**\n\n${rows}`;
}

function extractContextFromPrompt(prompt: string): { taskPrompt: string; contextUrl?: string } {
  const contextMatch = prompt.match(/\[CONTEXT: The task started on (.+?)\. If you are on an unrelated page, navigate back\.\]/);
  if (contextMatch) {
    const contextUrl = contextMatch[1];
    const taskPrompt = prompt.replace(/\s*\[CONTEXT: The task started on .+?. If you are on an unrelated page, navigate back\.\]/, '').trim();
    return { taskPrompt, contextUrl };
  }
  return { taskPrompt: prompt };
}

// ── User message ──────────────────────────────────────────────────────────────

/**
 * Assemble the multipart human turn: task text, VFS/todo/memory/scratchpad
 * context, optional reference images, and the annotated screenshot.
 *
 * @param useImageUrlFormat When true, images use the OpenAI-compatible
 *   `{ type: 'image_url', image_url: { url: '...' } }` format used by
 *   Anthropic, OpenAI, and Ollama via LangChain. When false (default),
 *   uses Gemini-native `{ type: 'image', url: '...' }`.
 */
export function buildUserMessage(
  userPrompt: string,
  vfsFiles: VFSFile[],
  currentTodo: TodoItem[],
  inlineImages: InlineImage[],
  base64Image: string,
  memoryEntries: MemoryEntry[] = [],
  scratchpadEntries: ScratchpadEntry[] = [],
  useImageUrlFormat = false,
  coordinateMap: CoordinateEntry[] = [],
  includeScreenshot = true,
  pageText = '',
): HumanMessage {
  const { taskPrompt, contextUrl } = extractContextFromPrompt(userPrompt);

  if (!includeScreenshot) {
    const pageCount = (pageText.match(/^Current URL:/gm) ?? []).length;
    const evidenceSource = pageCount > 1
      ? pageText
          .replace(/^Current URL:/gm, 'Visited URL:')
          .replace(/^Page title:/gm, 'Visited title:')
      : pageText;
    // A terminal multi-page research call receives a slightly wider ledger so
    // no requested fact is dropped. It is still far smaller than replaying
    // chat/tool history and is used by only one model call.
    const evidence = selectRelevantPageText(evidenceSource, taskPrompt, pageCount > 1 ? 900 : 300);
    // Evidence often reveals the next entity in a multi-hop task (for
    // example, a creator's name). Include those terms while ranking links so
    // the useful hop survives the five-element token budget.
    const elements = selectRelevantElements(coordinateMap, `${taskPrompt} ${evidence}`);
    const compactText = `Goal:${taskPrompt}\nPage:${evidence || '-'}${annotatedElementsBlock(elements, 4)}\nAct once; finish if complete.`;
    return new HumanMessage({ content: [{ type: 'text', text: compactText }] as any });
  }

  // Build markdown-like text content with proper sections and separators
  let textContent = '';

  // Context section
  if (contextUrl) {
    textContent += `### CONTEXT\nThe task started on ${contextUrl}. If you are on an unrelated page, navigate back.\n\n---`;
  }

  // VFS section
  textContent += vfsContextBlock(vfsFiles);
  textContent += '\n\n---';

  // Todo section
  textContent += todoContextBlock(currentTodo);
  textContent += '\n\n---';

  // Memory section
  const memoryBlock = formatMemoryForPrompt(memoryEntries);
  textContent += memoryBlock;
  textContent += '\n\n---';

  // Scratchpad section
  const scratchpadBlock = formatScratchpadForPrompt(scratchpadEntries);
  textContent += scratchpadBlock;
  textContent += '\n\n---\n\n# User task\n' + taskPrompt;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: Array<any> = [
    {
      type: 'text',
      text: textContent,
    },
  ];

  const imageBlock = (dataUrl: string) =>
    useImageUrlFormat
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
    text: includeScreenshot
      ? `\n\nAnalyze the annotated screenshot and call the appropriate tools.${annotatedElementsBlock(coordinateMap)}`
      : `\n\nUse the current page text and annotated page-element list below. Extract requested facts directly from the page text; do not repeatedly inspect links. If the task is satisfied, call finish immediately.\n\n**Current Page Text**\n\n${pageText || '(no page text available)'}${annotatedElementsBlock(coordinateMap)}`,
  });
  if (includeScreenshot) content.push(imageBlock(`data:image/png;base64,${base64Image}`));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new HumanMessage({ content: content as any });
}
