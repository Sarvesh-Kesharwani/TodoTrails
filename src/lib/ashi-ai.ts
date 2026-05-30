import 'server-only';

import type { AshiCategory, TodoItem } from '@/types/todo';

type DeepSeekMessage = {
  role: 'system' | 'user';
  content: string;
};

export type CategoryAssignment = {
  todoId: string;
  categoryId: string;
  confidence?: number;
  reason?: string;
};

export type RolloverDecision = {
  todoId: string;
  action: 'undone' | 'move_next_day';
  reason?: string;
};

function compactTodo(todo: TodoItem) {
  return {
    id: todo.id,
    title: todo.title,
    description: todo.notes,
    bucket: todo.bucket,
    deadline: todo.deadline,
    scheduledAt: todo.scheduledAt,
    categoryId: todo.ashiCategoryId,
    rolloverStatus: todo.rolloverStatus,
  };
}

function extractJson(text: string): unknown {
  const clean = text.trim();
  try {
    return JSON.parse(clean);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(clean);
    if (fenced) return JSON.parse(fenced[1]);
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error('DeepSeek did not return JSON.');
  }
}

async function deepSeekJson(messages: DeepSeekMessage[], maxTokens: number) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY missing on server.');

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      messages,
      max_tokens: maxTokens,
      temperature: 0.1,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error.slice(0, 500) || 'DeepSeek request failed.');
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('No DeepSeek content returned.');
  return extractJson(content);
}

function fallbackCategory(todo: TodoItem, categories: AshiCategory[]) {
  const text = `${todo.title} ${todo.notes ?? ''}`.toLowerCase();
  const byName = categories.find((category) => {
    const tokens = category.name
      .toLowerCase()
      .split(/[^a-z0-9\u0900-\u097f]+/i)
      .filter((token) => token.length > 2 && token !== 'jub');
    return tokens.some((token) => text.includes(token));
  });
  return byName?.id ?? categories[0]?.id ?? '';
}

export async function classifyTodos(todos: TodoItem[], categories: AshiCategory[]): Promise<CategoryAssignment[]> {
  if (!todos.length || !categories.length) return [];

  try {
    const json = (await deepSeekJson(
      [
        {
          role: 'system',
          content:
            'You classify todos into exactly one user-defined category. Use only category IDs supplied. Return JSON only.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            instructions:
              'For each todo, read title and description. Pick the best category from categories. Return {"assignments":[{"todoId":"...","categoryId":"...","confidence":0.0,"reason":"short"}]}.',
            categories: categories.map((category) => ({ id: category.id, name: category.name })),
            todos: todos.map(compactTodo),
          }),
        },
      ],
      Math.min(1800, Math.max(400, todos.length * 70)),
    )) as { assignments?: CategoryAssignment[] };

    const categoryIds = new Set(categories.map((category) => category.id));
    const todoIds = new Set(todos.map((todo) => todo.id));
    const assignments = Array.isArray(json.assignments) ? json.assignments : [];
    return assignments
      .filter((item) => todoIds.has(item.todoId) && categoryIds.has(item.categoryId))
      .map((item) => ({
        todoId: item.todoId,
        categoryId: item.categoryId,
        confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : undefined,
        reason: typeof item.reason === 'string' ? item.reason.slice(0, 160) : undefined,
      }));
  } catch {
    return todos.map((todo) => ({
      todoId: todo.id,
      categoryId: fallbackCategory(todo, categories),
      confidence: 0,
      reason: 'Fallback category match.',
    }));
  }
}

export async function decideRollover(
  todos: TodoItem[],
  categories: AshiCategory[],
  prompt: string,
  todayKey: string,
): Promise<RolloverDecision[]> {
  if (!todos.length) return [];

  try {
    const json = (await deepSeekJson(
      [
        {
          role: 'system',
          content:
            'You decide rollover actions for unfinished todos. Return JSON only. Valid actions: "undone", "move_next_day".',
        },
        {
          role: 'user',
          content: JSON.stringify({
            today: todayKey,
            userPrompt: prompt,
            categories: categories.map((category) => ({ id: category.id, name: category.name })),
            actionMeanings: {
              undone: 'Keep task unfinished and overdue for manual review.',
              move_next_day: 'Carry task into today list.',
            },
            todos: todos.map(compactTodo),
            requiredShape: {
              decisions: [{ todoId: 'todo id', action: 'undone or move_next_day', reason: 'short reason' }],
            },
          }),
        },
      ],
      Math.min(1800, Math.max(500, todos.length * 80)),
    )) as { decisions?: RolloverDecision[] };

    const todoIds = new Set(todos.map((todo) => todo.id));
    const decisions = Array.isArray(json.decisions) ? json.decisions : [];
    return decisions
      .filter((item) => todoIds.has(item.todoId) && (item.action === 'undone' || item.action === 'move_next_day'))
      .map((item) => ({
        todoId: item.todoId,
        action: item.action,
        reason: typeof item.reason === 'string' ? item.reason.slice(0, 180) : undefined,
      }));
  } catch {
    return todos.map((todo) => ({
      todoId: todo.id,
      action: 'move_next_day',
      reason: 'Fallback: keep visible today.',
    }));
  }
}
