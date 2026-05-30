import 'server-only';

import type { AshiCategory, TodoItem } from '@/types/todo';

type DeepSeekMessage = {
  role: 'system' | 'user';
  content: string;
};

export type CategoryAssignment = {
  todoId: string;
  categoryId: string;
  taskCategory: string;
  taskName: string;
  moveToNextDay: boolean;
  confidence?: number;
  reason?: string;
};

export type GeneratedCategory = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
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
    generatedJson: todo.ashiTaskJson,
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
    const tokens = `${category.name} ${category.description ?? ''}`
      .toLowerCase()
      .split(/[^a-z0-9\u0900-\u097f]+/i)
      .filter((token) => token.length > 2 && token !== 'jub');
    return tokens.some((token) => text.includes(token));
  });
  return byName?.id ?? categories[0]?.id ?? '';
}

function slugId(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `ashi-cat-${slug || 'category'}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function categoryPayload(categories: AshiCategory[]) {
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description,
  }));
}

function matchCategoryId(taskCategory: string, categories: AshiCategory[]) {
  const clean = taskCategory.trim().toLowerCase();
  const found =
    categories.find((category) => category.id.toLowerCase() === clean) ??
    categories.find((category) => category.name.trim().toLowerCase() === clean);
  return found?.id;
}

export async function classifyTodos(todos: TodoItem[], categories: AshiCategory[]): Promise<CategoryAssignment[]> {
  if (!todos.length || !categories.length) return [];

  try {
    const json = (await deepSeekJson(
      [
        {
          role: 'system',
          content:
            'You classify todos into exactly one user-defined category using category descriptions. Return JSON only.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            instructions:
              'For each todo, return this exact JSON shape: {"assignments":[{"todoId":"...","taskCategory":"one exact category name from categories","taskName":"clean task name","moveToNextDay":true,"confidence":0.0,"reason":"short"}]}. moveToNextDay means this task should be carried into tomorrow if unfinished.',
            categories: categoryPayload(categories),
            todos: todos.map(compactTodo),
          }),
        },
      ],
      Math.min(1800, Math.max(400, todos.length * 70)),
    )) as { assignments?: CategoryAssignment[] };

    const todoIds = new Set(todos.map((todo) => todo.id));
    const assignments = Array.isArray(json.assignments) ? json.assignments : [];
    const parsed: Array<CategoryAssignment | null> = assignments.map((item) => {
      const raw = item as Partial<CategoryAssignment>;
      const todoId = cleanString(raw.todoId);
      const taskCategory = cleanString(raw.taskCategory);
      const categoryId = cleanString(raw.categoryId) || matchCategoryId(taskCategory, categories);
      const sourceTodo = todos.find((todo) => todo.id === todoId);
      if (!todoId || !todoIds.has(todoId) || !categoryId) return null;
      const category = categories.find((entry) => entry.id === categoryId);
      if (!category) return null;
      const taskName = cleanString(raw.taskName) || sourceTodo?.title || '';
      const assignment: CategoryAssignment = {
        todoId,
        categoryId,
        taskCategory: category.name,
        taskName,
        moveToNextDay: Boolean(raw.moveToNextDay),
      };
      if (Number.isFinite(Number(raw.confidence))) assignment.confidence = Number(raw.confidence);
      if (typeof raw.reason === 'string') assignment.reason = raw.reason.slice(0, 160);
      return assignment;
    });
    return parsed.filter((item): item is CategoryAssignment => Boolean(item));
  } catch {
    return todos.map((todo) => ({
      todoId: todo.id,
      categoryId: fallbackCategory(todo, categories),
      taskCategory: categories.find((category) => category.id === fallbackCategory(todo, categories))?.name ?? categories[0]?.name ?? '',
      taskName: todo.title,
      moveToNextDay: true,
      confidence: 0,
      reason: 'Fallback category match.',
    }));
  }
}

export async function generateCategoriesFromText(source: string): Promise<GeneratedCategory[]> {
  const cleanSource = source.trim();
  if (!cleanSource) return [];

  try {
    const json = (await deepSeekJson(
      [
        {
          role: 'system',
          content:
            'You convert user category instructions into concise todo categories. Return JSON only. Preserve Hinglish/Hindi names when user uses them.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            instructions:
              'Read the user text. Extract every task category and a clear description of what kind of tasks belong there. Return {"categories":[{"name":"category name","description":"classification rule"}]}.',
            userText: cleanSource,
          }),
        },
      ],
      1200,
    )) as { categories?: Array<{ name?: string; description?: string }> };

    const now = new Date().toISOString();
    const seen = new Set<string>();
    return (Array.isArray(json.categories) ? json.categories : [])
      .map((category) => ({
        name: cleanString(category.name),
        description: cleanString(category.description),
      }))
      .filter((category) => {
        const key = category.name.toLowerCase();
        if (!category.name || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((category) => ({
        id: slugId(category.name),
        name: category.name,
        description: category.description || undefined,
        createdAt: now,
      }));
  } catch {
    const now = new Date().toISOString();
    return cleanSource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, ...rest] = line.split(/[:\-–—]/);
        return {
          id: slugId(name),
          name: name.trim(),
          description: rest.join('-').trim() || line,
          createdAt: now,
        };
      });
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
