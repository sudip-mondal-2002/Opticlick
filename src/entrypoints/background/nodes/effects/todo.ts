import { appendConversationTurn } from '@/utils/db';
import { saveTodoToVFS, applyTodoUpdates } from '@/utils/todo';
import { log } from '@/utils/agent-log';
import type { AgentAction, TodoItem } from '@/utils/types';
import type { EffectCtx } from './ctx';

type TodoCreateAction = Extract<AgentAction, { type: 'todo_create' }>;
type TodoUpdateAction = Extract<AgentAction, { type: 'todo_update' }>;
type TodoAddAction = Extract<AgentAction, { type: 'todo_add' }>;

export async function handleTodoCreate(
  action: TodoCreateAction,
  ctx: EffectCtx,
): Promise<TodoItem[]> {
  const { sessionId, toolCallId, toolName } = ctx;
  const newTodo = action.items as TodoItem[];
  await saveTodoToVFS(sessionId, newTodo);
  const result = `Created todo plan with ${newTodo.length} item(s)`;
  await log(result, 'info');
  await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
  return newTodo;
}

export async function handleTodoUpdate(
  action: TodoUpdateAction,
  ctx: EffectCtx,
  currentTodo: TodoItem[],
): Promise<TodoItem[]> {
  const { sessionId, toolCallId, toolName } = ctx;
  const newTodo = applyTodoUpdates(currentTodo, action.updates);
  await saveTodoToVFS(sessionId, newTodo);
  const summary = action.updates.map((u) => `${u.id}→${u.status ?? 'note'}`).join(', ');
  const result = `Todo updated: ${summary}`;
  await log(result, 'info');
  await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
  return newTodo;
}

export async function handleTodoAdd(
  action: TodoAddAction,
  ctx: EffectCtx,
  currentTodo: TodoItem[],
): Promise<TodoItem[]> {
  const { sessionId, toolCallId, toolName } = ctx;
  const existingIds = new Set(currentTodo.map((item) => item.id));
  const newItems = (action.items as TodoItem[]).filter((item) => !existingIds.has(item.id));
  let result: string;
  if (newItems.length > 0) {
    const newTodo = [...currentTodo, ...newItems];
    await saveTodoToVFS(sessionId, newTodo);
    result = `Todo: added ${newItems.length} new item(s): ${newItems.map((item) => item.id).join(', ')}`;
    await log(result, 'info');
    await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
    return newTodo;
  }
  result = 'Todo: no new items added (all IDs already exist)';
  await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
  return currentTodo;
}
