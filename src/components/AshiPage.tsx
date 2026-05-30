'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AshiCategory, TodoAttachment, TodoItem } from '@/types/todo';
import { endOfDay, parseDate, startOfLocalDay } from '@/lib/planner-date';
import { uploadTodoAttachment } from '@/lib/attachments-client';
import { useTodoStore } from './useTodoStore';

type ChatMessage = { role: 'user' | 'assistant'; text: string };
type CategoryAssignment = { todoId: string; categoryId: string; reason?: string };
type RolloverDecision = { todoId: string; action: 'undone' | 'move_next_day'; reason?: string };

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function slugId(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `ashi-cat-${slug || uid()}-${uid()}`;
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

function addDays(date: Date, days: number) {
  const out = startOfLocalDay(date);
  out.setDate(out.getDate() + days);
  return out;
}

function startOfWeek(date: Date) {
  const out = startOfLocalDay(date);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
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

function dateInHalfOpenRange(date: Date, start: Date, end: Date) {
  const time = startOfLocalDay(date).getTime();
  return time >= start.getTime() && time < end.getTime();
}

function buildTaskDivisions(tasks: TodoItem[], today: Date) {
  const weekStart = startOfWeek(today);
  const nextWeekStart = addDays(weekStart, 7);
  const followingWeekStart = addDays(nextWeekStart, 7);

  return {
    today: tasks.filter((todo) => {
      const due = taskDueDate(todo);
      return due ? sameDay(due, today) : false;
    }),
    thisWeek: tasks.filter((todo) => {
      const due = taskDueDate(todo);
      return due ? !sameDay(due, today) && dateInHalfOpenRange(due, weekStart, nextWeekStart) : false;
    }),
    nextWeek: tasks.filter((todo) => {
      const due = taskDueDate(todo);
      return due ? dateInHalfOpenRange(due, nextWeekStart, followingWeekStart) : false;
    }),
  };
}

function groupByCategory(tasks: TodoItem[], categories: AshiCategory[]) {
  const groups = categories.map((category) => ({
    category,
    items: tasks.filter((todo) => todo.ashiCategoryId === category.id),
  }));
  const categorizedIds = new Set(categories.map((category) => category.id));
  const uncategorized = tasks.filter((todo) => !todo.ashiCategoryId || !categorizedIds.has(todo.ashiCategoryId));
  return { groups, uncategorized };
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
  categoryName?: string;
  onComplete: (todo: TodoItem) => void;
  onEdit: (todo: TodoItem) => void;
  onDelete: (todo: TodoItem) => void;
};

function TaskRow({ todo, categoryName, onComplete, onEdit, onDelete }: TaskRowProps) {
  const due = taskDueDate(todo);
  return (
    <article className="ashi-task-row">
      <div className="ashi-task-main">
        <strong>{todo.title}</strong>
        {todo.notes ? <span>{todo.notes}</span> : null}
        {due ? <span>{due.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span> : null}
        {categoryName ? <span className="ashi-category-chip">{categoryName}</span> : null}
        {todo.rolloverStatus === 'undone' ? <span className="ashi-category-chip is-warn">Undone from previous day</span> : null}
        {attachmentPreview(todo.attachments)}
      </div>
      <div className="ashi-task-actions">
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
    </article>
  );
}

type TaskSectionProps = {
  title: string;
  items: TodoItem[];
  emptyText: string;
  renderTaskRow: (todo: TodoItem) => ReactNode;
};

function TaskSection({ title, items, emptyText, renderTaskRow }: TaskSectionProps) {
  return (
    <section className="ashi-task-section">
      <div className="ashi-task-section-head">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
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
  const [notes, setNotes] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [classifying, setClassifying] = useState(false);
  const rolloverPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const rolloverRunningRef = useRef(false);

  const tasks = useMemo(() => sortedTodos(store.todos), [store.todos]);
  const taskDivisions = useMemo(() => buildTaskDivisions(tasks, today), [tasks, today]);
  const categories = store.ashiSettings.categories;
  const categorized = useMemo(() => groupByCategory(tasks, categories), [tasks, categories]);
  const todayKey = useMemo(() => localDateKey(today), [today]);

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
            prompt: store.ashiSettings.rolloverPrompt,
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
  }, [categories, loaded, persist, store, today, todayKey]);

  async function classifyWithDeepSeek(items: TodoItem[]) {
    if (!items.length || !categories.length) return [];
    const response = await fetch('/api/ashi/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todos: items, categories }),
    });
    const data = (await response.json()) as { assignments?: CategoryAssignment[] };
    return data.assignments ?? [];
  }

  function applyAssignments(items: TodoItem[], assignments: CategoryAssignment[], updatedAt: string) {
    const byTodo = new Map(assignments.map((item) => [item.todoId, item.categoryId]));
    return items.map((todo) => {
      const categoryId = byTodo.get(todo.id);
      return categoryId ? { ...todo, ashiCategoryId: categoryId, updatedAt } : todo;
    });
  }

  async function addTask() {
    const cleanTitle = title.trim();
    const cleanNotes = notes.trim();
    if (!cleanTitle) return;
    setStatus('');
    try {
      const attachments = imageFile ? [await uploadTodoAttachment(imageFile)] : undefined;
      const now = new Date().toISOString();
      let todo: TodoItem = {
        id: uid(),
        title: cleanTitle,
        notes: cleanNotes || undefined,
        bucket: 'today',
        deadline: endOfDay(today).toISOString(),
        done: false,
        attachments,
        dimensionValues: {},
        createdAt: now,
        updatedAt: now,
      };
      const assignments = await classifyWithDeepSeek([todo]);
      const assignedCategoryId = assignments[0]?.categoryId;
      if (assignedCategoryId) todo = { ...todo, ashiCategoryId: assignedCategoryId };
      await persist({ ...store, todos: [todo, ...store.todos], updatedAt: now });
      setTitle('');
      setNotes('');
      setImageFile(null);
      setStatus(assignedCategoryId ? 'Added and categorized.' : 'Added.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Add failed.');
    }
  }

  async function organizeAllTasks() {
    const items = tasks.filter((todo) => categories.length && (!todo.ashiCategoryId || !categories.some((category) => category.id === todo.ashiCategoryId)));
    if (!items.length || classifying) return;
    setClassifying(true);
    setStatus('');
    try {
      const assignments = await classifyWithDeepSeek(items);
      const now = new Date().toISOString();
      await persist({ ...store, todos: applyAssignments(store.todos, assignments, now), updatedAt: now });
      setStatus(`Organized ${assignments.length} task${assignments.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Organize failed.');
    } finally {
      setClassifying(false);
    }
  }

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const category: AshiCategory = { id: slugId(name), name, createdAt: now };
    await persist({
      ...store,
      ashiSettings: { ...store.ashiSettings, categories: [...categories, category] },
      updatedAt: now,
    });
    setNewCategory('');
  }

  async function removeCategory(categoryId: string) {
    const category = categories.find((item) => item.id === categoryId);
    if (!category || !window.confirm(`Remove category "${category.name}"? Tasks stay saved but become uncategorized.`)) return;
    const now = new Date().toISOString();
    await persist({
      ...store,
      todos: store.todos.map((todo) => (todo.ashiCategoryId === categoryId ? { ...todo, ashiCategoryId: undefined, updatedAt: now } : todo)),
      ashiSettings: { ...store.ashiSettings, categories: categories.filter((item) => item.id !== categoryId) },
      updatedAt: now,
    });
  }

  async function saveRolloverPrompt() {
    const now = new Date().toISOString();
    const prompt = rolloverPromptRef.current?.value.trim() || store.ashiSettings.rolloverPrompt;
    await persist({
      ...store,
      ashiSettings: { ...store.ashiSettings, rolloverPrompt: prompt, rolloverPromptUpdatedAt: now },
      updatedAt: now,
    });
    setStatus('Rollover prompt saved.');
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

  function renderTaskRow(todo: TodoItem) {
    const categoryName = categories.find((category) => category.id === todo.ashiCategoryId)?.name;
    return (
      <TaskRow
        key={todo.id}
        todo={todo}
        categoryName={categoryName}
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
          <textarea
            className="ashi-task-input ashi-task-notes"
            placeholder="description / details"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          <label className={`ashi-image-pick${imagePreview ? ' has-image' : ''}`}>
            {imagePreview ? (
              <span className="ashi-image-thumb">
                <img src={imagePreview} alt="preview" />
                <span className="ashi-image-name">{imageFile?.name}</span>
              </span>
            ) : (
              <>
                <span className="ashi-image-icon" aria-hidden>+</span>
                <span className="ashi-image-title">Attach image</span>
                <span className="ashi-image-hint">PNG, JPG up to a few MB</span>
              </>
            )}
            <input type="file" accept="image/*" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} />
          </label>
          {imagePreview ? (
            <button type="button" className="ashi-image-clear" onClick={() => setImageFile(null)}>
              Remove image
            </button>
          ) : null}
          <button type="button" className="btn-3d ashi-add-btn" onClick={() => void addTask()}>
            add + auto categorize
          </button>
        </div>
        {status ? <p className="ashi-status">{status}</p> : null}
        <div className="ashi-list">
          <span className="ashi-list-title">Upcoming tasks</span>
          {tasks.length === 0 ? <p className="ashi-empty">No tasks yet - add one above.</p> : null}
          <TaskSection title="Today's tasks" items={taskDivisions.today} emptyText="No tasks due today." renderTaskRow={renderTaskRow} />
          <TaskSection title="This week tasks" items={taskDivisions.thisWeek} emptyText="No other tasks this week." renderTaskRow={renderTaskRow} />
          <TaskSection title="Next week tasks" items={taskDivisions.nextWeek} emptyText="No tasks due next week." renderTaskRow={renderTaskRow} />
          <details className="ashi-task-section ashi-task-details">
            <summary>
              <span>All tasks</span>
              <strong>{tasks.length}</strong>
            </summary>
            {tasks.length === 0 ? <p className="ashi-empty">All tasks will show here.</p> : <div className="ashi-task-stack">{tasks.map(renderTaskRow)}</div>}
          </details>
        </div>
      </section>

      <section className="panel ashi-categories-panel">
        <div className="panel-head">
          <div>
            <span className="section-eyebrow">Ashi categories</span>
            <h2>All-time tasks</h2>
          </div>
          <button type="button" className="btn-ghost" onClick={() => void organizeAllTasks()} disabled={classifying || !tasks.length}>
            {classifying ? 'Organizing...' : 'AI organize'}
          </button>
        </div>

        <div className="ashi-category-add">
          <input
            value={newCategory}
            placeholder="new category"
            onChange={(event) => setNewCategory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addCategory();
            }}
          />
          <button type="button" className="btn-3d" onClick={() => void addCategory()}>
            Add
          </button>
        </div>

        <div className="ashi-rollover-box">
          <div className="ashi-task-section-head">
            <h3>Next-day prompt</h3>
            <span>AI</span>
          </div>
          <textarea ref={rolloverPromptRef} defaultValue={store.ashiSettings.rolloverPrompt} />
          <button type="button" className="btn-ghost" onClick={() => void saveRolloverPrompt()}>
            Save prompt
          </button>
        </div>

        <div className="ashi-category-groups">
          {categorized.groups.map(({ category, items }) => (
            <details key={category.id} className="ashi-task-section ashi-task-details ashi-category-details" open>
              <summary>
                <span>{category.name}</span>
                <strong>{items.length}</strong>
              </summary>
              <button type="button" className="ashi-category-remove" onClick={() => void removeCategory(category.id)}>
                Remove category
              </button>
              {items.length === 0 ? <p className="ashi-empty">No tasks in this category.</p> : <div className="ashi-task-stack">{items.map(renderTaskRow)}</div>}
            </details>
          ))}
          <details className="ashi-task-section ashi-task-details ashi-category-details" open={categorized.uncategorized.length > 0}>
            <summary>
              <span>Uncategorized</span>
              <strong>{categorized.uncategorized.length}</strong>
            </summary>
            {categorized.uncategorized.length === 0 ? (
              <p className="ashi-empty">All active tasks have categories.</p>
            ) : (
              <div className="ashi-task-stack">{categorized.uncategorized.map(renderTaskRow)}</div>
            )}
          </details>
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
