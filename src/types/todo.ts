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
  ashiCategoryId?: string;
  ashiTags?: string[];
  ashiTaskJson?: AshiTaskJson;
  rolloverStatus?: 'undone' | 'moved-next-day';
  rolloverDecidedAt?: string;
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
export type AshiCategoryLayer = 'generic' | 'specific';

export interface AshiCategory {
  id: string;
  name: string;
  description?: string;
  layer?: AshiCategoryLayer;
  disabled?: boolean;
  createdAt: string;
}

export interface AshiTaskJson {
  taskCategory: string;
  taskTags: string[];
  taskName: string;
  moveToNextDay: boolean;
}

export interface TagRule {
  description: string;
  triggers: string[];
  parent_tags: string[];
  move_default: 'yes' | 'no' | 'unclear';
  examples: string[];
  priority?: number;
  active?: boolean;
}

export interface TagRulesStore {
  tags: Record<string, TagRule>;
  hierarchy: Record<string, string[]>;
}

export interface AshiSettings {
  categories: AshiCategory[];
  basePrompt?: string;
  rulesPrompt?: string;
  categoriesSource?: string;
  rolloverPrompt: string;
  rolloverPromptUpdatedAt?: string;
  lastRolloverDate?: string;
  todayTagFilter?: string;
  tagRules?: TagRulesStore;
}

export interface TodoStore {
  todos: TodoItem[];
  dimensions: Dimension[];
  bucketSort: SortMap;
  completionHistory: CompletionHistoryEntry[];
  ashiSettings: AshiSettings;
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

export const DEFAULT_ASHI_ROLLOVER_PROMPT = `Decide what to do with each unfinished task from yesterday or older.
Use "move_next_day" when the task is still actionable today and should remain visible in today's list.
Use "undone" when it should stay as an overdue unfinished task for review instead of being carried forward automatically.`;

export const DEFAULT_ASHI_BASE_PROMPT = `You are a todo auto-tagging assistant.
Assign the most relevant user-defined tags.
Use parent tags from the hierarchy.
Decide whether an unfinished task should move to next day.
Return JSON only.`;

const DEFAULT_ASHI_CATEGORIES: AshiCategory[] = [
  { id: 'ashi-cat-indu-aayega', name: 'Jub Indu aayega', description: 'Tasks to do when Indu comes.', layer: 'specific', createdAt: new Date(0).toISOString() },
  { id: 'ashi-cat-cnc-jaayenge', name: 'Jub CNC jaayenge', description: 'Shopping or errands for CNC.', layer: 'specific', createdAt: new Date(0).toISOString() },
  { id: 'ashi-cat-katni-city-jaayenge', name: 'Jub Katni city jaayenge', description: 'Tasks to do in Katni city.', layer: 'generic', createdAt: new Date(0).toISOString() },
  { id: 'ashi-cat-jbp-jaayenge', name: 'Jub JBP jaayenge', description: 'Tasks to do in Jabalpur.', layer: 'generic', createdAt: new Date(0).toISOString() },
  { id: 'ashi-cat-electrician-aayega', name: 'Jub electrician aayega', description: 'Electrical work when electrician comes.', layer: 'specific', createdAt: new Date(0).toISOString() },
];

const LEGACY_ASHI_RULES_PROMPT = `${DEFAULT_ASHI_CATEGORIES.map((category) => `${category.name}: ${category.description ?? ''}`).join('\n\n')}

Location hierarchy / parent tags:
- Add rules like: jilharighaat -> jbp
- Meaning: if a task belongs to jilharighaat, also tag it with jbp even when jbp is not written in the task title.`;

const DEFAULT_ASHI_RULES_PROMPT = `Base prompt:
${DEFAULT_ASHI_BASE_PROMPT}

Editable tag definitions:
${DEFAULT_ASHI_CATEGORIES.map((category) => `${category.name}: [layer: ${category.layer ?? 'specific'}] ${category.description ?? ''}`).join('\n\n')}

Location hierarchy / parent tags:
- child_tag -> parent_tag
- If a task belongs to a child tag, also include every parent tag.

Learning rules:
- Corrections update compact Tag Rules JSON, not this prompt.
- Do not append full historical examples here.
- Keep this prompt small: only stable tag meanings, layer markers, and hierarchy rules.`;

export const DEFAULT_STORE: TodoStore = {
  todos: [],
  dimensions: [
    { id: 'location', name: 'Location', optional: false, valueOrder: {} },
    { id: 'situation', name: 'Situation', optional: true, valueOrder: {} },
    { id: 'person', name: 'Person', optional: true, valueOrder: {} },
  ],
  bucketSort: DEFAULT_SORT,
  completionHistory: [],
  ashiSettings: {
    categories: DEFAULT_ASHI_CATEGORIES,
    basePrompt: DEFAULT_ASHI_BASE_PROMPT,
    rulesPrompt: DEFAULT_ASHI_RULES_PROMPT,
    rolloverPrompt: DEFAULT_ASHI_ROLLOVER_PROMPT,
    todayTagFilter: '',
    tagRules: { tags: {}, hierarchy: {} },
  },
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

  const rawAshiTags = Array.isArray(data.ashiTags)
    ? data.ashiTags.map((t) => cleanText(t)).filter(Boolean)
    : undefined;

  return {
    id,
    title,
    notes: cleanText(data.notes) || undefined,
    bucket: safeBucket,
    deadline: cleanText(data.deadline) || undefined,
    scheduledAt: cleanText(data.scheduledAt) || undefined,
    done: safeBucket === 'completed' || Boolean(data.done),
    repetitive: Boolean(data.repetitive),
    ashiCategoryId: cleanText(data.ashiCategoryId) || undefined,
    ashiTags: rawAshiTags?.length ? rawAshiTags : undefined,
    ashiTaskJson: normalizeAshiTaskJson(data.ashiTaskJson),
    rolloverStatus:
      data.rolloverStatus === 'undone' || data.rolloverStatus === 'moved-next-day' ? data.rolloverStatus : undefined,
    rolloverDecidedAt: cleanText(data.rolloverDecidedAt) || undefined,
    attachments: attachments.length ? attachments : undefined,
    dimensionValues,
    createdAt: cleanText(data.createdAt) || now,
    updatedAt: cleanText(data.updatedAt) || now,
  };
}

function normalizeAshiTaskJson(raw: unknown): AshiTaskJson | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const data = raw as Partial<AshiTaskJson>;
  const taskCategory = cleanText(data.taskCategory);
  const taskName = cleanText(data.taskName);
  if (!taskCategory || !taskName) return undefined;
  const taskTags = Array.isArray(data.taskTags)
    ? data.taskTags.map((t) => cleanText(t)).filter(Boolean)
    : taskCategory ? [taskCategory] : [];
  return {
    taskCategory,
    taskTags,
    taskName,
    moveToNextDay: Boolean(data.moveToNextDay),
  };
}

function normalizeAshiCategory(raw: unknown): AshiCategory | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<AshiCategory>;
  const id = cleanText(data.id);
  const name = cleanText(data.name);
  const layer = data.layer === 'generic' || data.layer === 'specific' ? data.layer : undefined;
  if (!id || !name) return null;
  return {
    id,
    name,
    description: cleanText(data.description) || undefined,
    layer,
    disabled: Boolean(data.disabled),
    createdAt: cleanText(data.createdAt) || new Date(0).toISOString(),
  };
}

function normalizeTagRulesStore(raw: unknown): TagRulesStore {
  if (!raw || typeof raw !== 'object') return { tags: {}, hierarchy: {} };
  const data = raw as Partial<TagRulesStore>;
  const tags: Record<string, TagRule> = {};
  if (data.tags && typeof data.tags === 'object') {
    for (const [key, val] of Object.entries(data.tags)) {
      if (!val || typeof val !== 'object') continue;
      const rule = val as Partial<TagRule>;
      const tagKey = key.trim().toLowerCase();
      if (!tagKey) continue;
      tags[tagKey] = {
        description: cleanText(rule.description),
        triggers: Array.isArray(rule.triggers)
          ? rule.triggers.map((t) => cleanText(t).toLowerCase()).filter(Boolean).slice(0, 15)
          : [],
        parent_tags: Array.isArray(rule.parent_tags)
          ? rule.parent_tags.map((t) => cleanText(t).toLowerCase()).filter(Boolean)
          : [],
        move_default: rule.move_default === 'yes' || rule.move_default === 'no' || rule.move_default === 'unclear'
          ? rule.move_default
          : 'unclear',
        examples: Array.isArray(rule.examples)
          ? rule.examples.map((e) => cleanText(e)).filter(Boolean).slice(0, 5)
          : [],
        priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 0,
        active: rule.active === false ? false : true,
      };
    }
  }
  const hierarchy: Record<string, string[]> = {};
  if (data.hierarchy && typeof data.hierarchy === 'object') {
    for (const [key, val] of Object.entries(data.hierarchy)) {
      const childKey = key.trim().toLowerCase();
      if (!childKey) continue;
      const parents = Array.isArray(val)
        ? val.map((p) => cleanText(p).toLowerCase()).filter(Boolean)
        : [];
      if (parents.length) hierarchy[childKey] = parents;
    }
  }
  return { tags, hierarchy };
}

function normalizeAshiSettings(raw: unknown): AshiSettings {
  const data = raw && typeof raw === 'object' ? (raw as Partial<AshiSettings>) : {};
  const rawCategories = Array.isArray(data.categories) ? data.categories : null;
  const categories = rawCategories
    ? rawCategories.map(normalizeAshiCategory).filter((item): item is AshiCategory => Boolean(item))
    : DEFAULT_STORE.ashiSettings.categories;
  const rawRulesPrompt =
    cleanText(data.rulesPrompt) ||
    cleanText(data.categoriesSource) ||
    cleanText(data.rolloverPrompt) ||
    DEFAULT_ASHI_RULES_PROMPT;
  const migratedRulesPrompt = rawRulesPrompt === LEGACY_ASHI_RULES_PROMPT ? DEFAULT_ASHI_RULES_PROMPT : rawRulesPrompt;
  const rulesPrompt = /location hierarchy|parent tags/i.test(migratedRulesPrompt)
    ? migratedRulesPrompt
    : `${migratedRulesPrompt.trim()}\n\nLocation hierarchy / parent tags:\n- child_tag -> parent_tag\n- If a task belongs to a child tag, also include every parent tag.`;
  return {
    categories,
    basePrompt: cleanText(data.basePrompt) || DEFAULT_ASHI_BASE_PROMPT,
    rulesPrompt,
    categoriesSource: cleanText(data.categoriesSource) || undefined,
    rolloverPrompt: cleanText(data.rolloverPrompt) || DEFAULT_ASHI_ROLLOVER_PROMPT,
    rolloverPromptUpdatedAt: cleanText(data.rolloverPromptUpdatedAt) || undefined,
    lastRolloverDate: cleanText(data.lastRolloverDate) || undefined,
    todayTagFilter: cleanText(data.todayTagFilter) || '',
    tagRules: normalizeTagRulesStore(data.tagRules),
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
  const ashiSettings = normalizeAshiSettings(source.ashiSettings);
  const categoryIds = new Set(ashiSettings.categories.map((category) => category.id));

  const dimensionIds = new Set(dimensions.map((d) => d.id));
  const todos = Array.isArray(source.todos)
    ? source.todos
        .map(normalizeTodo)
        .filter((item): item is TodoItem => Boolean(item))
        .map((todo) => ({
          ...todo,
          ashiCategoryId: todo.ashiCategoryId && categoryIds.has(todo.ashiCategoryId) ? todo.ashiCategoryId : undefined,
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
    ashiSettings,
    updatedAt: cleanText(source.updatedAt) || new Date().toISOString(),
  };
}
