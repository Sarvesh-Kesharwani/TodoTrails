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
  taskTags: string[];
  taskName: string;
  moveToNextDay: boolean;
  confidence?: number;
  reason?: string;
};

export type GeneratedCategory = {
  id: string;
  name: string;
  description?: string;
  layer?: 'generic' | 'specific';
  createdAt: string;
};

export type RolloverDecision = {
  todoId: string;
  action: 'undone' | 'move_next_day';
  reason?: string;
};

export type TeachIntent = {
  taskTags: string[];
  moveToNextDay: boolean | null;
  note?: string;
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

function cleanCategoryLayer(value: unknown): 'generic' | 'specific' | undefined {
  return value === 'generic' || value === 'specific' ? value : undefined;
}

function categoryPayload(categories: AshiCategory[]) {
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description,
    layer: category.layer,
  }));
}

function inferCategoryLayer(name: string, description = ''): 'generic' | 'specific' {
  const text = `${name} ${description}`.toLowerCase();
  if (/\b(cnc|indu|electrician|person|aayega|ayega|comes|spot|shop|store|doctor|gajnan|prakash)\b/.test(text)) {
    return 'specific';
  }
  if (/\b(katni|jbp|jabalpur|city|nagar|madhav|gpc|area|location|locality)\b/.test(text)) {
    return 'generic';
  }
  return 'specific';
}

function readLayerMarker(value: string): 'generic' | 'specific' | undefined {
  const marker = /\[layer:\s*(generic|specific)\]/i.exec(value);
  const layer = marker?.[1]?.toLowerCase();
  return layer === 'generic' || layer === 'specific' ? layer : undefined;
}

function cleanLayerMarker(value: string) {
  return value.replace(/\[layer:\s*(generic|specific)\]\s*/gi, '').trim();
}

function matchCategoryId(taskCategory: string, categories: AshiCategory[]) {
  const clean = taskCategory.trim().toLowerCase();
  const found =
    categories.find((category) => category.id.toLowerCase() === clean) ??
    categories.find((category) => category.name.trim().toLowerCase() === clean);
  return found?.id;
}

function normalizeRuleKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, '');
}

function resolveCategory(value: string, categories: AshiCategory[]) {
  const clean = normalizeRuleKey(value);
  if (!clean) return undefined;
  return categories.find((category) => normalizeRuleKey(category.name) === clean);
}

function splitRuleTags(value: string) {
  return value
    .split(/,|\band\b|&|\+|\//i)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseHierarchyRules(source: string, categories: AshiCategory[]) {
  const pairs: Array<{ child: AshiCategory; parent: AshiCategory }> = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/^[-*]\s*/, '').trim();
    if (!line) continue;

    const arrow = /^(.+?)\s*(?:->|=>)\s*(.+)$/.exec(line);
    const words = /^(.+?)\s+(?:comes under|under|inside|belongs to|part of|ke under|ke andar)\s+(.+)$/i.exec(line);
    const match = arrow ?? words;
    if (!match) continue;

    const child = resolveCategory(match[1], categories);
    if (!child) continue;
    for (const parentText of splitRuleTags(match[2])) {
      const parent = resolveCategory(parentText.replace(/\.$/, ''), categories);
      if (parent && parent.id !== child.id) pairs.push({ child, parent });
    }
  }
  return pairs;
}

function expandAssignmentsWithHierarchy(
  assignments: CategoryAssignment[],
  todos: TodoItem[],
  categories: AshiCategory[],
  rulesPrompt: string,
) {
  const hierarchy = parseHierarchyRules(rulesPrompt, categories);
  if (!hierarchy.length) return assignments;

  const byTodo = new Map(todos.map((todo) => [todo.id, todo]));
  return assignments.map((assignment) => {
    const names = new Set(assignment.taskTags);
    const todoText = normalizeRuleKey(`${byTodo.get(assignment.todoId)?.title ?? ''} ${byTodo.get(assignment.todoId)?.notes ?? ''}`);

    for (const { child } of hierarchy) {
      if (todoText.includes(normalizeRuleKey(child.name))) names.add(child.name);
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const { child, parent } of hierarchy) {
        if (names.has(child.name) && !names.has(parent.name)) {
          names.add(parent.name);
          changed = true;
        }
      }
    }

    const resolvedCategories = Array.from(names)
      .map((name) => resolveCategory(name, categories))
      .filter((category): category is AshiCategory => Boolean(category));
    const primary = resolvedCategories[0] ?? categories.find((category) => category.id === assignment.categoryId);
    return {
      ...assignment,
      categoryId: primary?.id ?? assignment.categoryId,
      taskCategory: primary?.name ?? assignment.taskCategory,
      taskTags: resolvedCategories.map((category) => category.name),
    };
  });
}

export async function classifyTodos(todos: TodoItem[], categories: AshiCategory[], rulesPrompt = ''): Promise<CategoryAssignment[]> {
  if (!todos.length || !categories.length) return [];

  try {
    const json = (await deepSeekJson(
      [
        {
          role: 'system',
          content:
            'You tag todos with one or more user-defined category tags. A todo can belong to multiple tags. Return JSON only.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            instructions:
              'For each todo, assign all relevant category tags from the provided list. Use the userRules text, especially any location hierarchy / parent tag rules, so a task can receive child specific tags and parent generic tags even when the parent keyword is not written in the task title. Return this exact JSON shape: {"assignments":[{"todoId":"...","taskTags":["exact category name 1","exact category name 2"],"taskName":"clean task name","moveToNextDay":true,"confidence":0.0,"reason":"short"}]}. taskTags must be an array of one or more exact category names from the categories list. moveToNextDay means this task should be carried into tomorrow if unfinished.',
            userRules: rulesPrompt,
            categories: categoryPayload(categories),
            todos: todos.map(compactTodo),
          }),
        },
      ],
      Math.min(1800, Math.max(400, todos.length * 70)),
    )) as { assignments?: Array<Partial<CategoryAssignment> & { taskTags?: string[] }> };

    const todoIds = new Set(todos.map((todo) => todo.id));
    const assignments = Array.isArray(json.assignments) ? json.assignments : [];
    const parsed: Array<CategoryAssignment | null> = assignments.map((item) => {
      const raw = item as Partial<CategoryAssignment> & { taskTags?: unknown };
      const todoId = cleanString(raw.todoId);
      if (!todoId || !todoIds.has(todoId)) return null;
      const sourceTodo = todos.find((todo) => todo.id === todoId);

      // Support both old taskCategory (single) and new taskTags (array)
      const rawTags: string[] = Array.isArray(raw.taskTags)
        ? (raw.taskTags as unknown[]).map((t) => cleanString(t)).filter(Boolean)
        : cleanString(raw.taskCategory) ? [cleanString(raw.taskCategory)] : [];

      // Resolve tag names to category ids; keep only valid ones
      const resolvedTags = rawTags
        .map((tagName) => {
          const catId = matchCategoryId(tagName, categories);
          return catId ? categories.find((c) => c.id === catId) : undefined;
        })
        .filter((c): c is AshiCategory => Boolean(c));

      if (!resolvedTags.length) return null;

      // Primary category = first resolved tag
      const primaryCategory = resolvedTags[0];
      const taskName = cleanString(raw.taskName) || sourceTodo?.title || '';
      const assignment: CategoryAssignment = {
        todoId,
        categoryId: primaryCategory.id,
        taskCategory: primaryCategory.name,
        taskTags: resolvedTags.map((c) => c.name),
        taskName,
        moveToNextDay: Boolean(raw.moveToNextDay),
      };
      if (Number.isFinite(Number(raw.confidence))) assignment.confidence = Number(raw.confidence);
      if (typeof raw.reason === 'string') assignment.reason = raw.reason.slice(0, 160);
      return assignment;
    });
    return expandAssignmentsWithHierarchy(
      parsed.filter((item): item is CategoryAssignment => Boolean(item)),
      todos,
      categories,
      rulesPrompt,
    );
  } catch {
    return expandAssignmentsWithHierarchy(todos.map((todo) => {
      const catId = fallbackCategory(todo, categories);
      const cat = categories.find((c) => c.id === catId) ?? categories[0];
      return {
        todoId: todo.id,
        categoryId: catId,
        taskCategory: cat?.name ?? '',
        taskTags: cat ? [cat.name] : [],
        taskName: todo.title,
        moveToNextDay: true,
        confidence: 0,
        reason: 'Fallback category match.',
      };
    }), todos, categories, rulesPrompt);
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
              'Read the user text. Extract every task category and a clear description of what kind of tasks belong there. Ignore section headings like "Location hierarchy / parent tags" and explanatory bullets like "Add rules like" or "Meaning". If a category line has explicit marker like [layer: generic] or [layer: specific], obey that marker exactly. Otherwise classify each category into layer "generic" for broad areas/cities/localities like Katni, JBP, Madhav Nagar, or "specific" for exact spots, shops, people, workers, or situational triggers like CNC, Indu, electrician. Return {"categories":[{"name":"category name","description":"classification rule","layer":"generic or specific"}]}.',
            userText: cleanSource,
          }),
        },
      ],
      1200,
    )) as { categories?: Array<{ name?: string; description?: string; layer?: string }> };

    const now = new Date().toISOString();
    const seen = new Set<string>();
    return (Array.isArray(json.categories) ? json.categories : [])
      .map((category) => ({
        name: cleanString(category.name),
        description: cleanLayerMarker(cleanString(category.description)),
        layer: cleanCategoryLayer(category.layer),
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
        layer: category.layer ?? inferCategoryLayer(category.name, category.description),
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
        const description = rest.join('-').trim() || line;
        const layer = readLayerMarker(line) ?? inferCategoryLayer(name, description);
        return {
          id: slugId(name),
          name: name.trim(),
          description: cleanLayerMarker(description),
          layer,
          createdAt: now,
        };
      });
  }
}

export async function interpretTeachInstruction(
  todo: TodoItem,
  instruction: string,
  categories: AshiCategory[],
): Promise<TeachIntent> {
  const cleanInstruction = instruction.trim();
  if (!cleanInstruction) return { taskTags: [], moveToNextDay: null };

  try {
    const parsed = JSON.parse(cleanInstruction) as Record<string, unknown>;
    const rawTags = parsed['Put this task in'] ?? parsed.taskTags ?? parsed.tags;
    const taskTags = Array.isArray(rawTags)
      ? rawTags.map((tag) => cleanString(tag)).filter(Boolean)
      : cleanString(rawTags)
        ? splitRuleTags(cleanString(rawTags))
        : [];
    const rawMove = parsed['This should move to next day if unfinished'] ?? parsed.moveToNextDay;
    const moveText = cleanString(rawMove).toLowerCase();
    const moveToNextDay =
      typeof rawMove === 'boolean'
        ? rawMove
        : ['yes', 'y', 'true', 'move', 'move next day', 'kal', 'tomorrow'].includes(moveText)
          ? true
          : ['no', 'n', 'false', 'do not move', 'dont move', "don't move", 'nahi', 'nahin'].includes(moveText)
            ? false
            : null;
    if (taskTags.length || moveToNextDay !== null) {
      return { taskTags, moveToNextDay, note: cleanInstruction };
    }
  } catch {
  }

  try {
    const json = (await deepSeekJson(
      [
        {
          role: 'system',
          content:
            'You extract user correction intent for a todo classifier. Return JSON only. Preserve Hinglish/Hindi category names exactly.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            instructions:
              'The user is teaching the classifier for one todo. Extract all category/tag names the task should belong to. Also detect whether unfinished task should move to next day. Return {"taskTags":["category 1","category 2"],"moveToNextDay":true|false|null,"note":"short rule note"}. Use existing category names when user clearly refers to them, but include new category names if user asks for a new one.',
            todo: compactTodo(todo),
            userText: cleanInstruction,
            existingCategories: categoryPayload(categories),
          }),
        },
      ],
      700,
    )) as Partial<TeachIntent> & { taskTags?: unknown; moveToNextDay?: unknown };

    const taskTags = Array.isArray(json.taskTags)
      ? json.taskTags.map((tag) => cleanString(tag)).filter(Boolean)
      : [];
    const moveToNextDay = typeof json.moveToNextDay === 'boolean' ? json.moveToNextDay : null;
    const note = cleanString(json.note) || cleanInstruction;
    return { taskTags, moveToNextDay, note };
  } catch {
    const lowered = cleanInstruction.toLowerCase();
    const moveToNextDay =
      /\b(no|not|mat|nahi|nahin|dont|don't)\b.*\b(next|tomorrow|kal)\b/.test(lowered)
        ? false
        : /\b(next|tomorrow|kal|carry|move)\b/.test(lowered)
          ? true
          : null;
    const taskTags = categories
      .filter((category) => lowered.includes(category.name.toLowerCase()))
      .map((category) => category.name);
    if (taskTags.length) return { taskTags, moveToNextDay, note: cleanInstruction };
    const roughTags =
      /(?:put(?: this task)? in|tags?|categor(?:y|ies)|under|daalo|dalo)\s*:?\s*([^.;]+)/i.exec(cleanInstruction)?.[1] ?? '';
    return {
      taskTags: roughTags
        .split(/,|\band\b|&|\+/i)
        .map((tag) => tag.trim())
        .filter(Boolean),
      moveToNextDay,
      note: cleanInstruction,
    };
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
