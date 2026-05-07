export type TimeBucket = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'nextYear' | 'completed';

export interface Dimension {
  id: string;
  name: string;
  optional: boolean;
  valueOrder: Record<string, number>;
}

export interface TodoItem {
  id: string;
  title: string;
  notes?: string;
  bucket: TimeBucket;
  deadline?: string;
  scheduledAt?: string;
  done: boolean;
  repetitive?: boolean;
  attachments?: TodoAttachment[];
  dimensionValues: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface TodoAttachment {
  id: string;
  url: string;
  name: string;
  type?: string;
  size?: number;
  createdAt: string;
}

export interface CompletionHistoryEntry {
  id: string;
  todoId: string;
  title: string;
  notes?: string;
  deadline?: string;
  scheduledAt?: string;
  dimensionValues: Record<string, string>;
  createdAt: string;
  completedAt: string;
}

export interface SortOption {
  field: 'deadline' | 'scheduledAt' | 'createdAt' | 'dimension';
  dimensionId?: string;
}

export type SortMap = Record<TimeBucket, SortOption>;

export interface TodoStore {
  todos: TodoItem[];
  dimensions: Dimension[];
  bucketSort: SortMap;
  completionHistory: CompletionHistoryEntry[];
  updatedAt: string;
}

export const DEFAULT_SORT: SortMap = {
  today: { field: 'deadline' },
  week: { field: 'deadline' },
  month: { field: 'deadline' },
  quarter: { field: 'deadline' },
  year: { field: 'deadline' },
  nextYear: { field: 'deadline' },
  completed: { field: 'createdAt' },
};

export const DEFAULT_STORE: TodoStore = {
  todos: [],
  dimensions: [
    { id: 'location', name: 'Location', optional: false, valueOrder: {} },
    { id: 'situation', name: 'Situation', optional: true, valueOrder: {} },
    { id: 'person', name: 'Person', optional: true, valueOrder: {} },
  ],
  bucketSort: DEFAULT_SORT,
  completionHistory: [],
  updatedAt: new Date(0).toISOString(),
};

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDimension(raw: unknown): Dimension | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<Dimension>;
  const id = cleanText(data.id);
  const name = cleanText(data.name);
  if (!id || !name) return null;

  const valueOrder: Record<string, number> = {};
  if (data.valueOrder && typeof data.valueOrder === 'object') {
    for (const [key, val] of Object.entries(data.valueOrder)) {
      const cleanKey = key.trim();
      const parsed = Number(val);
      if (cleanKey && Number.isFinite(parsed)) valueOrder[cleanKey] = parsed;
    }
  }

  return { id, name, optional: Boolean(data.optional), valueOrder };
}

function normalizeAttachment(raw: unknown, fallbackCreatedAt: string): TodoAttachment | null {
  if (!raw || typeof raw !== 'object') return null;
  const attachment = raw as Partial<TodoAttachment>;
  const id = cleanText(attachment.id);
  const url = cleanText(attachment.url);
  const name = cleanText(attachment.name) || 'attachment';
  if (!id || !url) return null;
  const parsedSize = Number(attachment.size);
  return {
    id,
    url,
    name,
    type: cleanText(attachment.type) || undefined,
    size: Number.isFinite(parsedSize) ? parsedSize : undefined,
    createdAt: cleanText(attachment.createdAt) || fallbackCreatedAt,
  };
}

function normalizeTodo(raw: unknown): TodoItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<TodoItem>;
  const id = cleanText(data.id);
  const title = cleanText(data.title);
  const bucket = cleanText(data.bucket) as TimeBucket;
  if (!id || !title) return null;

  const safeBucket: TimeBucket =
    ['today', 'week', 'month', 'quarter', 'year', 'nextYear', 'completed'].includes(bucket) ? bucket : 'today';
  const now = new Date().toISOString();

  const dimensionValues: Record<string, string> = {};
  if (data.dimensionValues && typeof data.dimensionValues === 'object') {
    for (const [key, val] of Object.entries(data.dimensionValues)) {
      const v = cleanText(val);
      if (key.trim() && v) dimensionValues[key.trim()] = v;
    }
  }

  const attachments = Array.isArray(data.attachments)
    ? data.attachments.map((item) => normalizeAttachment(item, now)).filter((item): item is TodoAttachment => Boolean(item))
    : [];

  return {
    id,
    title,
    notes: cleanText(data.notes) || undefined,
    bucket: safeBucket,
    deadline: cleanText(data.deadline) || undefined,
    scheduledAt: cleanText(data.scheduledAt) || undefined,
    done: safeBucket === 'completed' || Boolean(data.done),
    repetitive: Boolean(data.repetitive),
    attachments: attachments.length ? attachments : undefined,
    dimensionValues,
    createdAt: cleanText(data.createdAt) || now,
    updatedAt: cleanText(data.updatedAt) || now,
  };
}

function normalizeCompletionHistoryEntry(raw: unknown): CompletionHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<CompletionHistoryEntry>;
  const todoId = cleanText(data.todoId);
  const title = cleanText(data.title);
  const completedAt = cleanText(data.completedAt);
  if (!todoId || !title || !completedAt) return null;

  const dimensionValues: Record<string, string> = {};
  if (data.dimensionValues && typeof data.dimensionValues === 'object') {
    for (const [key, val] of Object.entries(data.dimensionValues)) {
      const v = cleanText(val);
      if (key.trim() && v) dimensionValues[key.trim()] = v;
    }
  }

  const id = cleanText(data.id) || `${todoId}-${completedAt}`;
  return {
    id,
    todoId,
    title,
    notes: cleanText(data.notes) || undefined,
    deadline: cleanText(data.deadline) || undefined,
    scheduledAt: cleanText(data.scheduledAt) || undefined,
    dimensionValues,
    createdAt: cleanText(data.createdAt) || completedAt,
    completedAt,
  };
}

export function normalizeStore(input: unknown): TodoStore {
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_STORE, updatedAt: new Date().toISOString() };
  }

  const source = input as Partial<TodoStore> & { listSort?: SortMap };
  const dimensions = Array.isArray(source.dimensions)
    ? source.dimensions.map(normalizeDimension).filter((item): item is Dimension => Boolean(item))
    : DEFAULT_STORE.dimensions;

  const dimensionIds = new Set(dimensions.map((d) => d.id));
  const todos = Array.isArray(source.todos)
    ? source.todos
        .map(normalizeTodo)
        .filter((item): item is TodoItem => Boolean(item))
        .map((todo) => ({
          ...todo,
          dimensionValues: Object.fromEntries(Object.entries(todo.dimensionValues).filter(([k]) => dimensionIds.has(k))),
        }))
    : [];

  const safeSort: SortMap = { ...DEFAULT_SORT };
  const sortSource = source.bucketSort ?? source.listSort;
  if (sortSource && typeof sortSource === 'object') {
    for (const key of Object.keys(DEFAULT_SORT) as TimeBucket[]) {
      const rawSort = (sortSource as Partial<SortMap>)[key];
      if (!rawSort) continue;
      if (rawSort.field === 'dimension' && rawSort.dimensionId && dimensionIds.has(rawSort.dimensionId)) {
        safeSort[key] = { field: 'dimension', dimensionId: rawSort.dimensionId };
      } else if (['deadline', 'scheduledAt', 'createdAt'].includes(rawSort.field)) {
        safeSort[key] = { field: rawSort.field };
      }
    }
  }

  const completionHistory = Array.isArray(source.completionHistory)
    ? source.completionHistory
        .map(normalizeCompletionHistoryEntry)
        .filter((item): item is CompletionHistoryEntry => Boolean(item))
        .map((entry) => ({
          ...entry,
          dimensionValues: Object.fromEntries(Object.entries(entry.dimensionValues).filter(([k]) => dimensionIds.has(k))),
        }))
    : [];

  return {
    todos,
    dimensions: dimensions.length ? dimensions : DEFAULT_STORE.dimensions,
    bucketSort: safeSort,
    completionHistory,
    updatedAt: cleanText(source.updatedAt) || new Date().toISOString(),
  };
}
