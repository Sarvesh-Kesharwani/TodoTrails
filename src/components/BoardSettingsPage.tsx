'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Dimension, SortOption, TodoItem, TodoStore } from '@/types/todo';
import { DEFAULT_STORE } from '@/types/todo';

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

export function BoardSettingsPage() {
  const [store, setStore] = useState<TodoStore>(DEFAULT_STORE);
  const [loaded, setLoaded] = useState(false);
  const [showCompleted, setShowCompleted] = useState(true);
  const [newDimName, setNewDimName] = useState('');
  const [newDimOptional, setNewDimOptional] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/todos');
        if (!r.ok) return;
        setStore((await r.json()) as TodoStore);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  async function persist(next: TodoStore) {
    setStore(next);
    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
  }

  const completedTodos = useMemo(() => {
    const completed = store.todos.filter((todo) => todo.bucket === 'completed' || todo.done);
    return sortTodos(completed, store.bucketSort.completed, store.dimensions);
  }, [store]);

  async function addDimension() {
    const name = newDimName.trim();
    if (!name) return;

    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || Math.random().toString(36).slice(2, 10);
    if (store.dimensions.some((dim) => dim.id === id)) return;

    await persist({
      ...store,
      dimensions: [...store.dimensions, { id, name, optional: newDimOptional, valueOrder: {} }],
      updatedAt: new Date().toISOString(),
    });
    setNewDimName('');
    setNewDimOptional(true);
  }

  async function updateDimension(dimId: string, fn: (dim: Dimension) => Dimension) {
    await persist({
      ...store,
      dimensions: store.dimensions.map((dim) => (dim.id === dimId ? fn(dim) : dim)),
      updatedAt: new Date().toISOString(),
    });
  }

  async function deleteDimension(dimId: string) {
    await persist({
      ...store,
      dimensions: store.dimensions.filter((dim) => dim.id !== dimId),
      todos: store.todos.map((todo) => {
        const next = { ...todo.dimensionValues };
        delete next[dimId];
        return { ...todo, dimensionValues: next };
      }),
      updatedAt: new Date().toISOString(),
    });
  }

  async function updateTodo(todoId: string, updater: (todo: TodoItem) => TodoItem) {
    await persist({
      ...store,
      todos: store.todos.map((todo) =>
        todo.id === todoId ? { ...updater(todo), updatedAt: new Date().toISOString() } : todo,
      ),
      updatedAt: new Date().toISOString(),
    });
  }

  async function deleteTodo(todoId: string) {
    await persist({
      ...store,
      todos: store.todos.filter((todo) => todo.id !== todoId),
      updatedAt: new Date().toISOString(),
    });
  }

  if (!loaded) {
    return <section className="panel">Loading settings...</section>;
  }

  return (
    <div className="board-wrap">
      <section className="panel settings-panel settings-page-panel">
        <div className="panel-head">
          <div>
            <span className="section-eyebrow">Settings</span>
            <h1 className="settings-title">Board Settings</h1>
          </div>
          <span className="section-chip">Manage dimensions and archive</span>
        </div>

        <div className="settings-grid">
          <section className="settings-card">
            <div className="panel-head">
              <div>
                <span className="section-eyebrow">Organize</span>
                <h2>Dimensions</h2>
              </div>
              <span className="section-chip">Flexible tags</span>
            </div>
            <div className="dim-add-row">
              <input placeholder="New dimension name" value={newDimName} onChange={(e) => setNewDimName(e.target.value)} />
              <label className="inline-check"><input type="checkbox" checked={newDimOptional} onChange={(e) => setNewDimOptional(e.target.checked)} />Optional</label>
              <button type="button" className="btn-3d" onClick={() => void addDimension()}>Add</button>
            </div>
            <div className="dim-list">
              {store.dimensions.map((dim) => (
                <article key={dim.id} className="dim-card">
                  <div className="dim-head">
                    <input value={dim.name} onChange={(e) => void updateDimension(dim.id, (d) => ({ ...d, name: e.target.value }))} />
                    <label className="inline-check"><input type="checkbox" checked={dim.optional} onChange={(e) => void updateDimension(dim.id, (d) => ({ ...d, optional: e.target.checked }))} />Optional</label>
                    <button type="button" className="btn-ghost" onClick={() => void deleteDimension(dim.id)}>Delete</button>
                  </div>
                  <details>
                    <summary>Value sort mapping</summary>
                    <div className="mapping-list">
                      {Object.entries(dim.valueOrder).map(([key, val]) => (
                        <div key={key} className="mapping-row">
                          <code>{key}</code>
                          <input
                            type="number"
                            value={val}
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              void updateDimension(dim.id, (d) => ({
                                ...d,
                                valueOrder: { ...d.valueOrder, [key]: Number.isFinite(next) ? next : 0 },
                              }));
                            }}
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => {
                          const key = window.prompt(`Enter value label for ${dim.name}`)?.trim();
                          if (!key) return;
                          const order = Number(window.prompt('Numeric sort order', '1') ?? '1');
                          void updateDimension(dim.id, (d) => ({
                            ...d,
                            valueOrder: { ...d.valueOrder, [key]: Number.isFinite(order) ? order : 1 },
                          }));
                        }}
                      >
                        Add mapping
                      </button>
                    </div>
                  </details>
                </article>
              ))}
            </div>
          </section>

          <section className="settings-card">
            <div className="panel-head">
              <div>
                <span className="section-eyebrow">Archive</span>
                <h2>Completed</h2>
              </div>
              <button type="button" className="btn-ghost" onClick={() => setShowCompleted((prev) => !prev)}>
                {showCompleted ? 'Hide' : 'Show'} Completed ({completedTodos.length})
              </button>
            </div>
            {showCompleted && (
              <div className="completed-list">
                {completedTodos.map((todo) => (
                  <article key={todo.id} className="todo-card completed">
                    <h4>{todo.title}</h4>
                    <div className="card-actions">
                      <button type="button" className="btn-3d" onClick={() => void updateTodo(todo.id, (t) => ({ ...t, bucket: 'today', done: false }))}>Reopen</button>
                      <button type="button" className="btn-ghost" onClick={() => void deleteTodo(todo.id)}>Delete</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
