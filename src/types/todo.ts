export type TimeBucket = 'today' | 'week' | 'month' | 'year' | 'nextYear' | 'completed';

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
  dimensionValues: Record<string, string>;
  createdAt: string;
  updatedAt: string;
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
  updatedAt: string;
}

export const DEFAULT_SORT: SortMap = {
  today: { field: 'deadline' },
  week: { field: 'deadline' },
  month: { field: 'deadline' },
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

function normalizeTodo(raw: unknown): TodoItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<TodoItem>;
  const id = cleanText(data.id);
  const title = cleanText(data.title);
  const bucket = cleanText(data.bucket) as TimeBucket;
  if (!id || !title) return null;

  const safeBucket: TimeBucket =
    ['today', 'week', 'month', 'year', 'nextYear', 'completed'].includes(bucket) ? bucket : 'today';

  const dimensionValues: Record<string, string> = {};
  if (data.dimensionValues && typeof data.dimensionValues === 'object') {
    for (const [key, val] of Object.entries(data.dimensionValues)) {
      const v = cleanText(val);
      if (key.trim() && v) dimensionValues[key.trim()] = v;
    }
  }

  const now = new Date().toISOString();
  return {
    id,
    title,
    notes: cleanText(data.notes) || undefined,
    bucket: safeBucket,
    deadline: cleanText(data.deadline) || undefined,
    scheduledAt: cleanText(data.scheduledAt) || undefined,
    done: safeBucket === 'completed' || Boolean(data.done),
    dimensionValues,
    createdAt: cleanText(data.createdAt) || now,
    updatedAt: cleanText(data.updatedAt) || now,
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

  return {
    todos,
    dimensions: dimensions.length ? dimensions : DEFAULT_STORE.dimensions,
    bucketSort: safeSort,
    updatedAt: cleanText(source.updatedAt) || new Date().toISOString(),
  };
}
