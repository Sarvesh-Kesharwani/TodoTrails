'use client';

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from 'react';
import type { Dimension, SortOption, TimeBucket, TodoItem } from '@/types/todo';
import { uploadTodoAttachment } from '@/lib/attachments-client';
import { useTodoStore } from './useTodoStore';

const BUCKETS: Array<{ key: TimeBucket; label: string }> = [
  { key: 'today', label: "Today's" },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'year', label: 'This Year' },
  { key: 'nextYear', label: 'Next Year' },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function endOfDay(date: Date): Date {
  const out = new Date(date);
  out.setHours(23, 59, 59, 999);
  return out;
}

function autoDeadlineForBucket(bucket: TimeBucket): string | undefined {
  const now = new Date();
  if (bucket === 'completed') return undefined;
  if (bucket === 'today') return endOfDay(now).toISOString();
  if (bucket === 'week') {
    const sunday = new Date(now);
    const daysUntilSunday = (7 - sunday.getDay()) % 7;
    sunday.setDate(sunday.getDate() + daysUntilSunday);
    return endOfDay(sunday).toISOString();
  }
  if (bucket === 'month') return endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)).toISOString();
  if (bucket === 'quarter') {
    const quarterEndMonth = Math.floor(now.getMonth() / 3) * 3 + 2;
    return endOfDay(new Date(now.getFullYear(), quarterEndMonth + 1, 0)).toISOString();
  }
  if (bucket === 'year') return endOfDay(new Date(now.getFullYear(), 11, 31)).toISOString();
  return endOfDay(new Date(now.getFullYear() + 1, 11, 31)).toISOString();
}

function at(value: string | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function sortTodos(todos: TodoItem[], sort: SortOption, dimensions: Dimension[]): TodoItem[] {
  const dim = sort.dimensionId ? dimensions.find((d) => d.id === sort.dimensionId) : null;
  return [...todos].sort((a, b) => {
    const deadlineFirst = at(a.deadline) - at(b.deadline);
    if (deadlineFirst !== 0) return deadlineFirst;
    if (sort.field === 'dimension' && dim) {
      const av = (a.dimensionValues[dim.id] ?? '').trim();
      const bv = (b.dimensionValues[dim.id] ?? '').trim();
      const ao = dim.valueOrder[av] ?? 9999;
      const bo = dim.valueOrder[bv] ?? 9999;
      if (ao !== bo) return ao - bo;
      return av.localeCompare(bv);
    }
    if (sort.field === 'scheduledAt') return at(a.scheduledAt) - at(b.scheduledAt);
    if (sort.field === 'createdAt') return at(a.createdAt) - at(b.createdAt);
    return at(a.deadline) - at(b.deadline);
  });
}

export function TodoBoard() {
  const { store, loaded, persist, updateTodo, deleteTodo } = useTodoStore();

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [specificDeadline, setSpecificDeadline] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [bucket, setBucket] = useState<TimeBucket>('today');
  const [dimValues, setDimValues] = useState<Record<string, string>>({});
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState('');

  const byBucket = useMemo(() => {
    const grouped: Record<TimeBucket, TodoItem[]> = {
      today: [],
      week: [],
      month: [],
      quarter: [],
      year: [],
      nextYear: [],
      completed: [],
    };
    for (const todo of store.todos) grouped[todo.bucket]?.push(todo);
    for (const key of Object.keys(grouped) as TimeBucket[]) {
      grouped[key] = sortTodos(grouped[key], store.bucketSort[key], store.dimensions);
    }
    return grouped;
  }, [store]);

  const smartGroups = useMemo(() => {
    const active = store.todos.filter((todo) => !todo.done && todo.bucket !== 'completed');
    const locationDim = store.dimensions.find((d) => d.name.toLowerCase().includes('location'));
    const situationDim = store.dimensions.find((d) => d.name.toLowerCase().includes('situation'));
    const map = new Map<string, TodoItem[]>();
    for (const todo of active) {
      const location = locationDim ? (todo.dimensionValues[locationDim.id] ?? '').trim() : '';
      const situation = situationDim ? (todo.dimensionValues[situationDim.id] ?? '').trim() : '';
      if (location) {
        const key = `${todo.bucket}::location::${location.toLowerCase()}`;
        map.set(key, [...(map.get(key) ?? []), todo]);
      }
      if (situation) {
        const key = `${todo.bucket}::situation::${situation.toLowerCase()}`;
        map.set(key, [...(map.get(key) ?? []), todo]);
      }
    }
    return [...map.entries()]
      .map(([key, todos]) => ({ key, todos }))
      .filter((group) => group.todos.length >= 2)
      .slice(0, 8);
  }, [store]);

  async function addTodo() {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    const now = new Date().toISOString();
    setUploadStatus('');
    let attachments;
    try {
      attachments = imageFile ? [await uploadTodoAttachment(imageFile)] : undefined;
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : 'Image upload failed.');
      return;
    }
    const resolvedDeadline = specificDeadline ? (deadline || undefined) : autoDeadlineForBucket(bucket);
    const todo: TodoItem = {
      id: uid(),
      title: cleanTitle,
      notes: notes.trim() || undefined,
      bucket,
      deadline: resolvedDeadline,
      scheduledAt: scheduledAt || undefined,
      done: bucket === 'completed',
      attachments,
      dimensionValues: Object.fromEntries(Object.entries(dimValues).filter(([, value]) => value.trim())),
      createdAt: now,
      updatedAt: now,
    };
    await persist({ ...store, todos: [todo, ...store.todos], updatedAt: now });
    setTitle('');
    setNotes('');
    setSpecificDeadline(false);
    setDeadline('');
    setScheduledAt('');
    setBucket('today');
    setDimValues({});
    setImageFile(null);
    setUploadStatus('');
  }

  async function onDrop(target: TimeBucket) {
    if (!draggedId) return;
    await updateTodo(draggedId, (todo) => ({ ...todo, bucket: target, done: target === 'completed' }));
    setDraggedId(null);
  }

  if (!loaded) return <section className="panel">Loading your board...</section>;

  return (
    <div className="board-wrap">
      <section className="workspace-grid">
        <section className="panel add-panel">
          <div className="panel-head">
            <div>
              <span className="section-eyebrow">Create</span>
              <h2>Add Todo</h2>
            </div>
            <span className="section-chip">Quick capture</span>
          </div>
          <div className="form-grid">
            <input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <label>
              Deadline
              <button
                type="button"
                className={specificDeadline ? 'btn-3d' : 'btn-ghost'}
                onClick={() => setSpecificDeadline((prev) => !prev)}
              >
                {specificDeadline ? 'Specific' : 'Auto'}
              </button>
            </label>
            {specificDeadline ? (
              <label>Deadline<input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
            ) : null}
            <div className="form-subsection">
              <span className="subsection-label">Time Bucket</span>
              <label>Bucket<select value={bucket} onChange={(e) => setBucket(e.target.value as TimeBucket)}>{BUCKETS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}<option value="completed">Completed</option></select></label>
            </div>
            {store.dimensions.map((dim) => (
              <label key={dim.id}>{dim.name}
                <input
                  placeholder={dim.optional ? 'Optional' : 'Required'}
                  value={dimValues[dim.id] ?? ''}
                  onChange={(e) => setDimValues((prev) => ({ ...prev, [dim.id]: e.target.value }))}
                />
              </label>
            ))}
            <label>
              Image
              <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
            </label>
            {uploadStatus ? <p className="form-error">{uploadStatus}</p> : null}
          </div>
          <div className="cta-row">
            <button type="button" className="btn-3d btn-hero" onClick={() => void addTodo()}>Add Task</button>
          </div>
        </section>
      </section>

      {smartGroups.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <span className="section-eyebrow">Combine</span>
              <h2>Auto Groups</h2>
            </div>
            <span className="section-chip">Smart batching</span>
          </div>
          <div className="group-grid">
            {smartGroups.map((group) => {
              const [timeBucket, kind, value] = group.key.split('::');
              return (
                <article key={group.key} className="group-card">
                  <h3>{timeBucket} | {kind}: {value}</h3>
                  <p>{group.todos.length} related tasks</p>
                  <ul>{group.todos.map((todo) => <li key={todo.id}>{todo.title}</li>)}</ul>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="board-scroll">
        {BUCKETS.map((b) => (
          <article key={b.key} className="lane" onDragOver={(e) => e.preventDefault()} onDrop={() => void onDrop(b.key)}>
            <header className="lane-head">
              <div className="lane-title-row">
                <h3>{b.label}</h3>
                <span className="lane-count">{byBucket[b.key].length}</span>
              </div>
              <label>Sort
                <select
                  value={`${store.bucketSort[b.key].field}:${store.bucketSort[b.key].dimensionId ?? ''}`}
                  onChange={(e) => {
                    const [field, dimensionId] = e.target.value.split(':');
                    const nextSort: SortOption =
                      field === 'dimension' ? { field: 'dimension', dimensionId } : { field: field as SortOption['field'] };
                    void persist({
                      ...store,
                      bucketSort: { ...store.bucketSort, [b.key]: nextSort },
                      updatedAt: new Date().toISOString(),
                    });
                  }}
                >
                  <option value="deadline:">Deadline</option>
                  <option value="scheduledAt:">Time</option>
                  <option value="createdAt:">Created</option>
                  {store.dimensions.map((dim) => <option key={dim.id} value={`dimension:${dim.id}`}>{dim.name} mapping</option>)}
                </select>
              </label>
            </header>
            <div className="lane-body">
              {byBucket[b.key].map((todo) => (
                <article key={todo.id} className="todo-card" draggable onDragStart={() => setDraggedId(todo.id)} onDragEnd={() => setDraggedId(null)}>
                  <h4>{todo.title}</h4>
                  {todo.notes && <p>{todo.notes}</p>}
                  <div className="meta-row">
                    {todo.deadline && <span className="pill">Deadline: {new Date(todo.deadline).toLocaleString()}</span>}
                    {todo.scheduledAt && <span className="pill">Time: {new Date(todo.scheduledAt).toLocaleString()}</span>}
                  </div>
                  <div className="meta-row">
                    {store.dimensions.map((dim) => {
                      const value = todo.dimensionValues[dim.id];
                      if (!value) return null;
                      return <span key={dim.id} className="pill dim-pill">{dim.name}: {value}</span>;
                    })}
                  </div>
                  {todo.attachments?.length ? (
                    <div className="task-attachments">
                      {todo.attachments.map((attachment) => (
                        <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="task-attachment">
                          <img src={attachment.url} alt={attachment.name} />
                        </a>
                      ))}
                    </div>
                  ) : null}
                  <div className="card-actions">
                    <button type="button" className="btn-3d" onClick={() => void updateTodo(todo.id, (t) => ({ ...t, bucket: 'completed', done: true }))}>Complete</button>
                    <button type="button" className="btn-ghost" onClick={() => void deleteTodo(todo.id)}>Delete</button>
                  </div>
                </article>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
