'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { AshiCategory, AshiCategoryLayer, TodoAttachment, TodoItem } from '@/types/todo';
import { endOfDay, parseDate, startOfLocalDay } from '@/lib/planner-date';
import { uploadTodoAttachment } from '@/lib/attachments-client';
import { useTodoStore } from './useTodoStore';

type ChatMessage = { role: 'user' | 'assistant'; text: string };
type CategoryAssignment = {
  todoId: string;
  categoryId: string;
  taskCategory: string;
  taskTags: string[];
  taskName: string;
  moveToNextDay: boolean;
  reason?: string;
};
type RolloverDecision = { todoId: string; action: 'undone' | 'move_next_day'; reason?: string };
type GeneratedCategory = AshiCategory;
type TeachIntent = { taskTags: string[]; moveToNextDay: boolean | null; note?: string };

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sortedTodos(todos: TodoItem[]) {
  return [...todos]
    .filter((todo) => !todo.done && todo.bucket !== 'completed')
    .sort((a, b) => {
      const at = Date.parse(a.deadline ?? a.scheduledAt ?? a.createdAt);
      const bt = Date.parse(b.deadline ?? b.scheduledAt ?? b.createdAt);
      return (Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER) - (Number.isFinite(bt) ? bt : Number.MAX_SAFE_INTEGER);
    });
}

function taskDueDate(todo: TodoItem) {
  return parseDate(todo.deadline ?? todo.scheduledAt);
}

function isPastTodayTodo(todo: TodoItem, today: Date) {
  if (todo.done || todo.bucket !== 'today') return false;
  const due = taskDueDate(todo);
  return Boolean(due && startOfLocalDay(due).getTime() < today.getTime());
}

function sameDay(a: Date, b: Date) {
  return startOfLocalDay(a).getTime() === startOfLocalDay(b).getTime();
}

function normalizeTagName(value: string) {
  return value.trim().toLowerCase();
}

function inferTagLayer(tag: string, category?: AshiCategory): 'generic' | 'specific' {
  if (category?.layer === 'generic' || category?.layer === 'specific') return category.layer;
  const text = `${tag} ${category?.description ?? ''}`.toLowerCase();
  if (/\b(cnc|indu|electrician|person|aayega|ayega|comes|spot|shop|store|doctor|gajnan|prakash)\b/.test(text)) {
    return 'specific';
  }
  if (/\b(katni|jbp|jabalpur|city|nagar|madhav|gpc|area|location|locality)\b/.test(text)) {
    return 'generic';
  }
  return 'specific';
}

function cleanLayerRuleText(value: string) {
  return value.replace(/\[layer:\s*(generic|specific)\]\s*/gi, '').trim();
}

function updateRulesTagLayer(source: string, category: AshiCategory, layer: AshiCategoryLayer) {
  const marker = `[layer: ${layer}]`;
  const lines = source.trimEnd().split(/\r?\n/);
  const categoryKey = normalizeTagName(category.name);
  const categoryIndex = lines.findIndex((line) => normalizeTagName(line.replace(/[:\-].*$/, '')) === categoryKey);

  if (categoryIndex >= 0) {
    const line = lines[categoryIndex];
    const colonIndex = line.indexOf(':');
    if (colonIndex >= 0) {
      const name = line.slice(0, colonIndex).trim() || category.name;
      const description = cleanLayerRuleText(line.slice(colonIndex + 1));
      lines[categoryIndex] = `${name}: ${marker}${description ? ` ${description}` : ''}`;
    } else {
      lines[categoryIndex] = `${category.name}: ${marker}`;
    }
    return lines.join('\n');
  }

  const description = cleanLayerRuleText(category.description ?? '');
  const prefix = source.trim() ? `${source.trimEnd()}\n\n` : '';
  return `${prefix}${category.name}: ${marker}${description ? ` ${description}` : ''}`;
}

function buildTeachJson(tags: string[]) {
  return JSON.stringify(
    {
      'Put this task in': tags.length ? tags : ['call service', 'ghar'],
      'This should move to next day if unfinished': 'yes or no',
    },
    null,
    2,
  );
}

function appendTeachingIntentToRules(source: string, intent: TeachIntent, taskTitle: string, rawInstruction: string) {
  const cleanTitle = taskTitle.trim();
  const cleanTags = Array.from(new Set(intent.taskTags.map((tag) => tag.trim()).filter(Boolean)));
  if (!cleanTitle || !cleanTags.length) return source;

  const nextDayText =
    intent.moveToNextDay === null ? '' : `; move to next day: ${intent.moveToNextDay ? 'yes' : 'no'}`;
  const noteText = intent.note ? `; note: ${intent.note}` : rawInstruction ? `; note: ${rawInstruction}` : '';
  const exampleLine = `- Example task: ${cleanTitle}${nextDayText}${noteText}`;
  let nextSource = source.trimEnd();

  for (const categoryName of cleanTags) {
    if (nextSource.toLowerCase().includes(`${categoryName.toLowerCase()}`) && nextSource.toLowerCase().includes(cleanTitle.toLowerCase())) {
      continue;
    }
    const lines = nextSource.split(/\r?\n/);
    const categoryKey = normalizeTagName(categoryName);
    const categoryIndex = lines.findIndex((line) => normalizeTagName(line.replace(/[:\-].*$/, '')) === categoryKey);

    if (categoryIndex >= 0) {
      lines.splice(categoryIndex + 1, 0, exampleLine);
      nextSource = lines.join('\n');
    } else {
      const prefix = nextSource.trim() ? `${nextSource}\n\n` : '';
      nextSource = `${prefix}${categoryName}:\n${exampleLine}`;
    }
  }
  return nextSource;
}

/** Get all unique tag names across all tasks (from ashiTags or ashiTaskJson.taskTags) */
function getAllTags(tasks: TodoItem[]): string[] {
  const seen = new Set<string>();
  for (const todo of tasks) {
    const tags = todo.ashiTags ?? todo.ashiTaskJson?.taskTags ?? [];
    for (const tag of tags) {
      if (tag) seen.add(tag);
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

/** Filter tasks by selected tag. Empty string = show all. */
function filterByTag(tasks: TodoItem[], tag: string): TodoItem[] {
  if (!tag) return tasks;
  return tasks.filter((todo) => {
    const tags = todo.ashiTags ?? todo.ashiTaskJson?.taskTags ?? [];
    return tags.includes(tag);
  });
}

function attachmentPreview(attachments: TodoAttachment[] | undefined) {
  if (!attachments?.length) return null;
  return (
    <div className="task-attachments">
      {attachments.map((attachment) => (
        <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="task-attachment">
          <img src={attachment.url} alt={attachment.name} />
        </a>
      ))}
    </div>
  );
}

type TaskRowProps = {
  todo: TodoItem;
  isTeaching: boolean;
  teachDraft: string;
  teachSubmitting: boolean;
  onTeach: (todo: TodoItem) => void;
  onTeachDraftChange: (value: string) => void;
  onSubmitTeach: () => void;
  onCancelTeach: () => void;
  onComplete: (todo: TodoItem) => void;
  onEdit: (todo: TodoItem) => void;
  onDelete: (todo: TodoItem) => void;
};

function TaskRow({
  todo,
  isTeaching,
  teachDraft,
  teachSubmitting,
  onTeach,
  onTeachDraftChange,
  onSubmitTeach,
  onCancelTeach,
  onComplete,
  onEdit,
  onDelete,
}: TaskRowProps) {
  const due = taskDueDate(todo);
  const displayName = todo.ashiTaskJson?.taskName || todo.title;
  const tags = todo.ashiTags ?? todo.ashiTaskJson?.taskTags ?? [];
  return (
    <article className="ashi-task-row">
      <div className="ashi-task-main">
        <strong>{displayName}</strong>
        {todo.notes ? <span>{todo.notes}</span> : null}
        {due ? <span>{due.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span> : null}
        {tags.length > 0 ? (
          <div className="ashi-task-tags">
            {tags.map((tag) => (
              <span key={tag} className="ashi-tag-chip">{tag}</span>
            ))}
          </div>
        ) : null}
        {todo.ashiTaskJson ? (
          <span className={`ashi-category-chip${todo.ashiTaskJson.moveToNextDay ? ' is-move' : ' is-warn'}`}>
            {todo.ashiTaskJson.moveToNextDay ? 'Move next day' : 'Do not auto move'}
          </span>
        ) : null}
        {todo.rolloverStatus === 'undone' ? <span className="ashi-category-chip is-warn">Undone from previous day</span> : null}
        {attachmentPreview(todo.attachments)}
      </div>
      <div className="ashi-task-actions">
        <button type="button" className="ashi-task-btn is-teach" onClick={() => onTeach(todo)} aria-label="Teach correct tag" title="Teach correct tag">
          AI
        </button>
        <button type="button" className="ashi-task-btn is-complete" onClick={() => onComplete(todo)} aria-label="Mark complete" title="Mark complete">
          {'\u2713'}
        </button>
        <button type="button" className="ashi-task-btn is-edit" onClick={() => onEdit(todo)} aria-label="Edit task" title="Edit">
          {'\u270e'}
        </button>
        <button type="button" className="ashi-task-btn is-delete" onClick={() => onDelete(todo)} aria-label="Delete task" title="Delete">
          {'\u2715'}
        </button>
      </div>
      {isTeaching ? (
        <div className="ashi-task-teach">
          <textarea
            value={teachDraft}
            onChange={(event) => onTeachDraftChange(event.target.value)}
            placeholder={buildTeachJson([])}
          />
          <div className="ashi-rules-actions">
            <button type="button" className="btn-ghost" onClick={onCancelTeach} disabled={teachSubmitting}>
              Cancel
            </button>
            <button type="button" className="btn-3d" onClick={onSubmitTeach} disabled={teachSubmitting || !teachDraft.trim()}>
              {teachSubmitting ? 'Learning...' : 'Learn + re-tag'}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

type TaskSectionProps = {
  title: string;
  items: TodoItem[];
  emptyText: string;
  renderTaskRow: (todo: TodoItem) => ReactNode;
  controls?: ReactNode;
};

function TaskSection({ title, items, emptyText, renderTaskRow, controls }: TaskSectionProps) {
  return (
    <section className="ashi-task-section">
      <div className="ashi-task-section-head">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
      {controls}
      {items.length === 0 ? <p className="ashi-empty">{emptyText}</p> : <div className="ashi-task-stack">{items.map(renderTaskRow)}</div>}
    </section>
  );
}

function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function renderStructuredText(text: string) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(<h3 key={`h-${index}`}>{renderInlineMarkdown(heading[2])}</h3>);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^[-*]\s+(.+)$/.exec(lines[index].trim());
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^\d+[.)]\s+(.+)$/.exec(lines[index].trim());
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || /^(#{1,3})\s+/.test(next) || /^[-*]\s+/.test(next) || /^\d+[.)]\s+/.test(next)) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{renderInlineMarkdown(paragraph.join(' '))}</p>);
  }

  return blocks.length ? blocks : text;
}

export function AshiPage() {
  const { store, loaded, persist, updateTodo, deleteTodo } = useTodoStore();
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const [title, setTitle] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesDraft, setRulesDraft] = useState('');
  const [teachingTodo, setTeachingTodo] = useState<TodoItem | null>(null);
  const [teachDraft, setTeachDraft] = useState('');
  const [teachSubmitting, setTeachSubmitting] = useState(false);
  const [activeTag, setActiveTag] = useState('');
  const [draggingTag, setDraggingTag] = useState('');
  const rolloverRunningRef = useRef(false);

  const tasks = useMemo(() => sortedTodos(store.todos), [store.todos]);
  const todayTasks = useMemo(() => tasks.filter((todo) => {
    const due = taskDueDate(todo);
    return due ? sameDay(due, today) : false;
  }), [tasks, today]);
  const categories = store.ashiSettings.categories;
  const rulesPrompt =
    store.ashiSettings.rulesPrompt ?? store.ashiSettings.categoriesSource ?? store.ashiSettings.rolloverPrompt;
  const todayTagFilter = store.ashiSettings.todayTagFilter ?? '';
  const todayKey = useMemo(() => localDateKey(today), [today]);

  // All unique tag names from all tasks
  const allTags = useMemo(() => getAllTags(tasks), [tasks]);
  const todayTagOptions = useMemo(() => {
    const tags = [...allTags];
    if (todayTagFilter && !tags.includes(todayTagFilter)) tags.unshift(todayTagFilter);
    return tags;
  }, [allTags, todayTagFilter]);
  const tagsByLayer = useMemo(() => {
    const categoryByName = new Map(categories.map((category) => [normalizeTagName(category.name), category]));
    return allTags.reduce(
      (groups, tag) => {
        const layer = inferTagLayer(tag, categoryByName.get(normalizeTagName(tag)));
        groups[layer].push(tag);
        return groups;
      },
      { generic: [] as string[], specific: [] as string[] },
    );
  }, [allTags, categories]);

  // Tasks filtered by active tag
  const filteredTasks = useMemo(() => filterByTag(tasks, activeTag), [tasks, activeTag]);
  const visibleTodayTasks = useMemo(() => filterByTag(todayTasks, todayTagFilter), [todayTasks, todayTagFilter]);

  // Count tasks per tag for the filter header
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tag of allTags) {
      counts[tag] = tasks.filter((todo) => {
        const tags = todo.ashiTags ?? todo.ashiTaskJson?.taskTags ?? [];
        return tags.includes(tag);
      }).length;
    }
    return counts;
  }, [allTags, tasks]);

  const untaggedCount = useMemo(
    () => tasks.filter((todo) => !(todo.ashiTags?.length ?? todo.ashiTaskJson?.taskTags?.length)).length,
    [tasks],
  );

  const imagePreview = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : ''), [imageFile]);

  useEffect(() => {
    if (!imagePreview) return;
    return () => URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  useEffect(() => {
    if (
      !loaded ||
      rolloverRunningRef.current ||
      !store.ashiSettings.rolloverPromptUpdatedAt ||
      store.ashiSettings.lastRolloverDate === todayKey
    ) {
      return;
    }
    const candidates = store.todos.filter((todo) => isPastTodayTodo(todo, today));
    if (!candidates.length) {
      void persist({
        ...store,
        ashiSettings: { ...store.ashiSettings, lastRolloverDate: todayKey },
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    rolloverRunningRef.current = true;
    void (async () => {
      try {
        const response = await fetch('/api/ashi/rollover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            todos: candidates,
            categories,
            prompt: rulesPrompt,
            todayKey,
          }),
        });
        const data = (await response.json()) as { decisions?: RolloverDecision[] };
        const decisions = new Map((data.decisions ?? []).map((decision) => [decision.todoId, decision]));
        const decidedAt = new Date().toISOString();
        const nextTodos = store.todos.map((todo) => {
          const decision = decisions.get(todo.id);
          if (!decision) return todo;
          if (decision.action === 'move_next_day') {
            return {
              ...todo,
              bucket: 'today' as const,
              deadline: endOfDay(today).toISOString(),
              scheduledAt: todo.scheduledAt && taskDueDate(todo) ? undefined : todo.scheduledAt,
              rolloverStatus: 'moved-next-day' as const,
              rolloverDecidedAt: decidedAt,
              updatedAt: decidedAt,
            };
          }
          return {
            ...todo,
            rolloverStatus: 'undone' as const,
            rolloverDecidedAt: decidedAt,
            updatedAt: decidedAt,
          };
        });
        await persist({
          ...store,
          todos: nextTodos,
          ashiSettings: { ...store.ashiSettings, lastRolloverDate: todayKey },
          updatedAt: decidedAt,
        });
        setStatus(`Rollover checked ${candidates.length} old task${candidates.length === 1 ? '' : 's'}.`);
      } catch {
        setStatus('Rollover check failed.');
      } finally {
        rolloverRunningRef.current = false;
      }
    })();
  }, [categories, loaded, persist, rulesPrompt, store, today, todayKey]);

  async function classifyWithDeepSeek(items: TodoItem[], sourceCategories = categories) {
    if (!items.length || !sourceCategories.length) return [];
    const response = await fetch('/api/ashi/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todos: items, categories: sourceCategories, rulesPrompt }),
    });
    const data = (await response.json()) as { assignments?: CategoryAssignment[] };
    return data.assignments ?? [];
  }

  async function generateCategoriesFromRules(text: string) {
    const response = await fetch('/api/ashi/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = (await response.json()) as { categories?: GeneratedCategory[]; error?: string };
    if (!response.ok || !data.categories?.length) throw new Error(data.error || 'No tags generated.');
    return data.categories;
  }

  function applyAssignments(items: TodoItem[], assignments: CategoryAssignment[], updatedAt: string) {
    const byTodo = new Map(assignments.map((item) => [item.todoId, item]));
    return items.map((todo) => {
      const assignment = byTodo.get(todo.id);
      return assignment
        ? {
            ...todo,
            ashiCategoryId: assignment.categoryId,
            ashiTags: assignment.taskTags,
            ashiTaskJson: {
              taskCategory: assignment.taskCategory,
              taskTags: assignment.taskTags,
              taskName: assignment.taskName,
              moveToNextDay: assignment.moveToNextDay,
            },
            updatedAt,
          }
        : todo;
    });
  }

  function assignmentFromTeach(todo: TodoItem, intent: TeachIntent, sourceCategories: AshiCategory[]): CategoryAssignment | null {
    const matchedCategories = intent.taskTags
      .map((tag) => sourceCategories.find((category) => normalizeTagName(category.name) === normalizeTagName(tag)))
      .filter((category): category is AshiCategory => Boolean(category));
    const primaryCategory = matchedCategories[0];
    if (!primaryCategory) return null;
    return {
      todoId: todo.id,
      categoryId: primaryCategory.id,
      taskCategory: primaryCategory.name,
      taskTags: matchedCategories.map((category) => category.name),
      taskName: todo.ashiTaskJson?.taskName || todo.title,
      moveToNextDay: intent.moveToNextDay ?? todo.ashiTaskJson?.moveToNextDay ?? true,
      reason: intent.note,
    };
  }

  async function parseTeachIntent(todo: TodoItem, instruction: string) {
    const response = await fetch('/api/ashi/teach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todo, categories, instruction }),
    });
    const data = (await response.json()) as { intent?: TeachIntent; error?: string };
    if (!response.ok || !data.intent) throw new Error(data.error || 'Teach failed.');
    return data.intent;
  }

  async function addTask() {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    setStatus('');
    try {
      const attachments = imageFile ? [await uploadTodoAttachment(imageFile)] : undefined;
      const now = new Date().toISOString();
      let todo: TodoItem = {
        id: uid(),
        title: cleanTitle,
        bucket: 'today',
        deadline: endOfDay(today).toISOString(),
        done: false,
        attachments,
        dimensionValues: {},
        createdAt: now,
        updatedAt: now,
      };
      const assignments = await classifyWithDeepSeek([todo]);
      const assignment = assignments[0];
      if (assignment) {
        todo = {
          ...todo,
          title: assignment.taskName || todo.title,
          ashiCategoryId: assignment.categoryId,
          ashiTags: assignment.taskTags,
          ashiTaskJson: {
            taskCategory: assignment.taskCategory,
            taskTags: assignment.taskTags,
            taskName: assignment.taskName || todo.title,
            moveToNextDay: assignment.moveToNextDay,
          },
        };
      }
      await persist({ ...store, todos: [todo, ...store.todos], updatedAt: now });
      setTitle('');
      setImageFile(null);
      setStatus(assignment ? `Added with tags: ${assignment.taskTags.join(', ')}.` : 'Added.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Add failed.');
    }
  }

  async function organizeAllTasks() {
    const cleanRules = rulesPrompt.trim();
    if (classifying || !tasks.length) return;
    if (!cleanRules) {
      setRulesDraft(cleanRules);
      setRulesOpen(true);
      setStatus('Add Rules first.');
      return;
    }
    setClassifying(true);
    setStatus('');
    try {
      const nextCategories = await generateCategoriesFromRules(cleanRules);
      const assignments = await classifyWithDeepSeek(tasks, nextCategories);
      const now = new Date().toISOString();
      const activeIds = new Set(tasks.map((todo) => todo.id));
      const clearedTodos = store.todos.map((todo) =>
        activeIds.has(todo.id)
          ? { ...todo, ashiCategoryId: undefined, ashiTags: undefined, ashiTaskJson: undefined, updatedAt: now }
          : todo,
      );
      await persist({
        ...store,
        todos: applyAssignments(clearedTodos, assignments, now),
        ashiSettings: {
          ...store.ashiSettings,
          categories: nextCategories,
          rulesPrompt: cleanRules,
          categoriesSource: cleanRules,
          rolloverPrompt: cleanRules,
          rolloverPromptUpdatedAt: now,
        },
        updatedAt: now,
      });
      setActiveTag('');
      setStatus(`Retagged ${assignments.length} task${assignments.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Organize failed.');
    } finally {
      setClassifying(false);
    }
  }

  async function saveRules() {
    const prompt = rulesDraft.trim();
    if (!prompt) {
      setStatus('Rules cannot be empty.');
      return;
    }
    const now = new Date().toISOString();
    await persist({
      ...store,
      ashiSettings: {
        ...store.ashiSettings,
        rulesPrompt: prompt,
        categoriesSource: prompt,
        rolloverPrompt: prompt,
        rolloverPromptUpdatedAt: now,
      },
      updatedAt: now,
    });
    setRulesOpen(false);
    setStatus('Rules saved. Click AI organize to re-tag all tasks.');
  }

  async function updateTodayTagFilter(tag: string) {
    const now = new Date().toISOString();
    await persist({
      ...store,
      ashiSettings: { ...store.ashiSettings, todayTagFilter: tag },
      updatedAt: now,
    });
  }

  function startTeachTask(todo: TodoItem) {
    const currentTags = todo.ashiTags ?? todo.ashiTaskJson?.taskTags ?? (todo.ashiTaskJson?.taskCategory ? [todo.ashiTaskJson.taskCategory] : []);
    setTeachingTodo(todo);
    setTeachDraft(buildTeachJson(currentTags));
    setStatus('');
  }

  async function submitTeachInstruction() {
    const todo = teachingTodo;
    const instruction = teachDraft.trim();
    if (!todo || !instruction || teachSubmitting) return;
    setTeachSubmitting(true);
    setClassifying(true);
    setStatus('');
    try {
      const intent = await parseTeachIntent(todo, instruction);
      if (!intent.taskTags.length) throw new Error('No category found in teach text.');
      const nextRules = appendTeachingIntentToRules(rulesPrompt, intent, todo.title, instruction);
      const nextCategories = await generateCategoriesFromRules(nextRules);
      const assignments = await classifyWithDeepSeek(tasks, nextCategories);
      const taughtAssignment = assignmentFromTeach(todo, intent, nextCategories);
      const assignmentMap = new Map(assignments.map((assignment) => [assignment.todoId, assignment]));
      if (taughtAssignment) assignmentMap.set(todo.id, taughtAssignment);
      const now = new Date().toISOString();
      const activeIds = new Set(tasks.map((item) => item.id));
      const clearedTodos = store.todos.map((item) =>
        activeIds.has(item.id)
          ? { ...item, ashiCategoryId: undefined, ashiTags: undefined, ashiTaskJson: undefined, updatedAt: now }
          : item,
      );

      await persist({
        ...store,
        todos: applyAssignments(clearedTodos, Array.from(assignmentMap.values()), now),
        ashiSettings: {
          ...store.ashiSettings,
          categories: nextCategories,
          rulesPrompt: nextRules,
          categoriesSource: nextRules,
          rolloverPrompt: nextRules,
          rolloverPromptUpdatedAt: now,
        },
        updatedAt: now,
      });
      setRulesDraft(nextRules);
      setTeachingTodo(null);
      setTeachDraft('');
      setActiveTag('');
      setStatus(`Learned "${todo.title}" and re-tagged ${assignmentMap.size} task${assignmentMap.size === 1 ? '' : 's'}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Teach failed.');
    } finally {
      setTeachSubmitting(false);
      setClassifying(false);
    }
  }

  async function removeCategory(categoryId: string) {
    const category = categories.find((item) => item.id === categoryId);
    if (!category || !window.confirm(`Remove tag "${category.name}"? Tasks stay saved but lose this tag.`)) return;
    const now = new Date().toISOString();
    await persist({
      ...store,
      todos: store.todos.map((todo) => {
        if (todo.ashiCategoryId === categoryId || todo.ashiTags?.includes(category.name)) {
          return {
            ...todo,
            ashiCategoryId: todo.ashiCategoryId === categoryId ? undefined : todo.ashiCategoryId,
            ashiTags: todo.ashiTags?.filter((t) => t !== category.name),
            ashiTaskJson: todo.ashiTaskJson
              ? { ...todo.ashiTaskJson, taskTags: (todo.ashiTaskJson.taskTags ?? []).filter((t) => t !== category.name) }
              : undefined,
            updatedAt: now,
          };
        }
        return todo;
      }),
      ashiSettings: { ...store.ashiSettings, categories: categories.filter((item) => item.id !== categoryId) },
      updatedAt: now,
    });
    if (activeTag === category.name) setActiveTag('');
  }

  async function renameCategory(categoryId: string) {
    const category = categories.find((item) => item.id === categoryId);
    if (!category) return;
    const nextName = window.prompt('Rename tag', category.name)?.trim();
    if (!nextName || nextName === category.name) return;
    const nextDescription = window.prompt('Tag description', category.description ?? '')?.trim();
    const now = new Date().toISOString();
    await persist({
      ...store,
      todos: store.todos.map((todo) => {
        const hasTags = todo.ashiTags?.includes(category.name) || todo.ashiTaskJson?.taskTags?.includes(category.name);
        if (!hasTags) return todo;
        return {
          ...todo,
          ashiTags: todo.ashiTags?.map((t) => (t === category.name ? nextName : t)),
          ashiTaskJson: todo.ashiTaskJson
            ? { ...todo.ashiTaskJson, taskTags: (todo.ashiTaskJson.taskTags ?? []).map((t) => (t === category.name ? nextName : t)) }
            : undefined,
          updatedAt: now,
        };
      }),
      ashiSettings: {
        ...store.ashiSettings,
        categories: categories.map((item) => (item.id === categoryId ? { ...item, name: nextName, description: nextDescription || undefined } : item)),
      },
      updatedAt: now,
    });
    if (activeTag === category.name) setActiveTag(nextName);
  }

  async function moveTagLayer(tag: string, layer: AshiCategoryLayer) {
    const category = categories.find((item) => normalizeTagName(item.name) === normalizeTagName(tag));
    if (!category) {
      setStatus(`Cannot move "${tag}" because category metadata is missing. Run AI organize first.`);
      return;
    }
    if (inferTagLayer(category.name, category) === layer) {
      setDraggingTag('');
      return;
    }
    const now = new Date().toISOString();
    const nextRules = updateRulesTagLayer(rulesPrompt, category, layer);
    await persist({
      ...store,
      ashiSettings: {
        ...store.ashiSettings,
        categories: categories.map((item) => (item.id === category.id ? { ...item, layer } : item)),
        rulesPrompt: nextRules,
        categoriesSource: nextRules,
        rolloverPrompt: nextRules,
        rolloverPromptUpdatedAt: now,
      },
      updatedAt: now,
    });
    setRulesDraft(nextRules);
    setDraggingTag('');
    setStatus(`Moved "${category.name}" to ${layer} layer.`);
  }

  function allowTagDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function dropTagLayer(event: DragEvent<HTMLDivElement>, layer: AshiCategoryLayer) {
    event.preventDefault();
    const tag = event.dataTransfer.getData('text/plain') || draggingTag;
    if (!tag) return;
    void moveTagLayer(tag, layer);
  }

  async function askAshi() {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || asking) return;
    setQuestion('');
    setAsking(true);
    setChat((prev) => [...prev, { role: 'user', text: cleanQuestion }]);
    try {
      const response = await fetch('/api/ashi/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: cleanQuestion, todos: store.todos }),
      });
      const data = (await response.json()) as { answer?: string; error?: string };
      setChat((prev) => [...prev, { role: 'assistant', text: data.answer || data.error || 'No answer.' }]);
    } catch {
      setChat((prev) => [...prev, { role: 'assistant', text: 'Chat failed.' }]);
    } finally {
      setAsking(false);
    }
  }

  function renderTagPill(tag: string, layer: AshiCategoryLayer) {
    const nextLayer: AshiCategoryLayer = layer === 'generic' ? 'specific' : 'generic';
    return (
      <button
        key={tag}
        type="button"
        draggable
        className={`ashi-tag-pill${activeTag === tag ? ' is-active' : ''}${draggingTag === tag ? ' is-dragging' : ''}`}
        onClick={() => setActiveTag(tag)}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', tag);
          event.dataTransfer.effectAllowed = 'move';
          setDraggingTag(tag);
        }}
        onDragEnd={() => setDraggingTag('')}
        title={`Drag ${tag} to ${nextLayer}`}
      >
        {tag} <span className="ashi-tag-pill-count">{tagCounts[tag] ?? 0}</span>
      </button>
    );
  }

  function renderTaskRow(todo: TodoItem) {
    return (
      <TaskRow
        key={todo.id}
        todo={todo}
        isTeaching={teachingTodo?.id === todo.id}
        teachDraft={teachDraft}
        teachSubmitting={teachSubmitting}
        onTeach={(item) => {
          startTeachTask(item);
        }}
        onTeachDraftChange={setTeachDraft}
        onSubmitTeach={() => {
          void submitTeachInstruction();
        }}
        onCancelTeach={() => {
          setTeachingTodo(null);
          setTeachDraft('');
        }}
        onComplete={(item) => {
          if (!window.confirm(`Mark "${item.title}" as complete?`)) return;
          void updateTodo(item.id, (next) => ({ ...next, done: true, bucket: 'completed' }));
        }}
        onEdit={(item) => {
          const next = window.prompt('Edit task', item.title);
          if (next === null) return;
          const trimmed = next.trim();
          if (!trimmed || trimmed === item.title) return;
          void updateTodo(item.id, (current) => ({ ...current, title: trimmed }));
        }}
        onDelete={(item) => {
          if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
          void deleteTodo(item.id);
        }}
      />
    );
  }

  if (!loaded) return <section className="panel">Loading Ashi...</section>;

  return (
    <div className="board-wrap ashi-shell">
      <section className="panel ashi-panel">
        <div className="ashi-create">
          <input
            className="ashi-task-input"
            placeholder="task title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label className={`ashi-image-pick${imagePreview ? ' has-image' : ''}`}>
            <span className="ashi-image-title">Photo</span>
            <input type="file" accept="image/*" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="btn-3d ashi-add-btn" onClick={() => void addTask()}>
            add + auto tag
          </button>
        </div>
        {status ? <p className="ashi-status">{status}</p> : null}
        <div className="ashi-list">
          <span className="ashi-list-title">Today</span>
          {tasks.length === 0 ? <p className="ashi-empty">No tasks yet - add one above.</p> : null}
          <TaskSection
            title="Today's tasks"
            items={visibleTodayTasks}
            emptyText={todayTagFilter ? `No tasks due today tagged "${todayTagFilter}".` : 'No tasks due today.'}
            renderTaskRow={renderTaskRow}
            controls={
              <label className="ashi-today-filter">
                <span>Show tag</span>
                <select value={todayTagFilter} onChange={(event) => void updateTodayTagFilter(event.target.value)}>
                  <option value="">All today tasks</option>
                  {todayTagOptions.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </label>
            }
          />
        </div>
      </section>

      <section className="panel ashi-categories-panel">
        <div className="panel-head">
          <div>
            <span className="section-eyebrow">Ashi tags</span>
            <h2>All-time tasks</h2>
          </div>
          <div className="ashi-panel-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setRulesDraft(rulesPrompt);
                setRulesOpen((open) => !open);
              }}
            >
              Rules
            </button>
            <button type="button" className="btn-ghost" onClick={() => void organizeAllTasks()} disabled={classifying || !tasks.length}>
              {classifying ? 'Tagging...' : 'AI organize'}
            </button>
          </div>
        </div>

        {rulesOpen ? (
          <div className="ashi-rules-editor">
            <textarea
              value={rulesDraft}
              onChange={(event) => setRulesDraft(event.target.value)}
              placeholder="Write category rules and next-day rules in one prompt."
            />
            <div className="ashi-rules-actions">
              <button type="button" className="btn-ghost" onClick={() => setRulesOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-3d" onClick={() => void saveRules()}>
                Save rules
              </button>
            </div>
          </div>
        ) : null}

        {/* Tag filter tabs header */}
        <div className="ashi-tag-filter">
          <div className="ashi-tag-filter-label">TAGS</div>
          <div className="ashi-tag-filter-bar">
            <button
              type="button"
              className={`ashi-tag-pill${activeTag === '' ? ' is-active' : ''}`}
              onClick={() => setActiveTag('')}
            >
              All tags <span className="ashi-tag-pill-count">{tasks.length}</span>
            </button>
            {untaggedCount > 0 && (
              <button
                type="button"
                className={`ashi-tag-pill${activeTag === '__untagged__' ? ' is-active' : ''}`}
                onClick={() => setActiveTag('__untagged__')}
              >
                Untagged <span className="ashi-tag-pill-count">{untaggedCount}</span>
              </button>
            )}
          </div>
          <div
            className={`ashi-tag-layer${draggingTag ? ' is-drop-ready' : ''}`}
            onDragOver={allowTagDrop}
            onDrop={(event) => dropTagLayer(event, 'generic')}
          >
            <span className="ashi-tag-layer-label">Generic</span>
            <div className="ashi-tag-filter-bar">{tagsByLayer.generic.map((tag) => renderTagPill(tag, 'generic'))}</div>
          </div>
          <div
            className={`ashi-tag-layer${draggingTag ? ' is-drop-ready' : ''}`}
            onDragOver={allowTagDrop}
            onDrop={(event) => dropTagLayer(event, 'specific')}
          >
            <span className="ashi-tag-layer-label">Specific spots / people</span>
            <div className="ashi-tag-filter-bar">{tagsByLayer.specific.map((tag) => renderTagPill(tag, 'specific'))}</div>
          </div>
          {/* Tag management: rename/remove */}
          {activeTag && activeTag !== '__untagged__' && categories.find((c) => c.name === activeTag) ? (
            <div className="ashi-active-tag-actions">
              <button
                type="button"
                className="ashi-category-link"
                onClick={() => {
                  const cat = categories.find((c) => c.name === activeTag);
                  if (cat) void renameCategory(cat.id);
                }}
              >
                Rename tag
              </button>
              <button
                type="button"
                className="ashi-category-link"
                onClick={() => {
                  const cat = categories.find((c) => c.name === activeTag);
                  if (cat) void removeCategory(cat.id);
                }}
              >
                Remove tag
              </button>
            </div>
          ) : null}
        </div>

        {/* Filtered task list */}
        <div className="ashi-category-groups">
          {activeTag === '__untagged__' ? (
            <div className="ashi-task-section">
              <div className="ashi-task-section-head">
                <h3>Untagged</h3>
                <span>{untaggedCount}</span>
              </div>
              {untaggedCount === 0 ? (
                <p className="ashi-empty">All tasks are tagged.</p>
              ) : (
                <div className="ashi-task-stack">
                  {tasks
                    .filter((todo) => !(todo.ashiTags?.length ?? todo.ashiTaskJson?.taskTags?.length))
                    .map(renderTaskRow)}
                </div>
              )}
            </div>
          ) : (
            <div className="ashi-task-section">
              <div className="ashi-task-section-head">
                <h3>{activeTag || 'All tasks'}</h3>
                <span>{filteredTasks.length}</span>
              </div>
              {filteredTasks.length === 0 ? (
                <p className="ashi-empty">No tasks{activeTag ? ` tagged "${activeTag}"` : ''}.</p>
              ) : (
                <div className="ashi-task-stack">{filteredTasks.map(renderTaskRow)}</div>
              )}
            </div>
          )}
        </div>

        <button type="button" className="btn-3d ashi-chat-toggle" onClick={() => setChatOpen((open) => !open)}>
          {chatOpen ? 'Hide Ashi chat' : 'Open Ashi chat'}
        </button>

        {chatOpen ? (
          <div className="ashi-chat-drawer">
            <div className="ashi-chat-log">
              {chat.length === 0 ? <p>Ask: indu se kya kaam hai, monday ko kya hai, gajnan se kya lena hai.</p> : null}
              {chat.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`ashi-chat-msg is-${message.role}`}>
                  {renderStructuredText(message.text)}
                </div>
              ))}
            </div>
            <div className="ashi-chat-box">
              <input
                placeholder="Ask about tasks..."
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void askAshi();
                }}
              />
              <button type="button" className="btn-3d" onClick={() => void askAshi()} disabled={asking}>
                {asking ? '...' : 'Ask'}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
