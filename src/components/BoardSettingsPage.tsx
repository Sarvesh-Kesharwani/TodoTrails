'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { CompletionHistoryEntry, Dimension, SortOption, TodoItem } from '@/types/todo';
import { useTodoStore } from './useTodoStore';

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

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function completionHistoryCsv(history: CompletionHistoryEntry[]): string {
  const headers = ['completedAt', 'title', 'notes', 'todoId', 'createdAt', 'deadline', 'scheduledAt', 'dimensionValues'];
  const rows = history.map((entry) => [
    entry.completedAt,
    entry.title,
    entry.notes ?? '',
    entry.todoId,
    entry.createdAt,
    entry.deadline ?? '',
    entry.scheduledAt ?? '',
    JSON.stringify(entry.dimensionValues),
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

function downloadFile(filename: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function BoardSettingsPage() {
  const { store, loaded, persist, updateTodo, deleteTodo } = useTodoStore();
  const [showCompleted, setShowCompleted] = useState(true);
  const [newDimName, setNewDimName] = useState('');
  const [newDimOptional, setNewDimOptional] = useState(true);

  const completedTodos = useMemo(() => {
    const completed = store.todos.filter((todo) => todo.bucket === 'completed' || todo.done);
    return sortTodos(completed, store.bucketSort.completed, store.dimensions);
  }, [store]);

  const completionHistory = useMemo(
    () =>
      [...store.completionHistory].sort((a, b) => {
        const at = Date.parse(a.completedAt);
        const bt = Date.parse(b.completedAt);
        return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
      }),
    [store.completionHistory],
  );

  function downloadCompletionHistoryJson() {
    downloadFile('tasktrail-completion-history.json', 'application/json', JSON.stringify(completionHistory, null, 2));
  }

  function downloadCompletionHistoryCsv() {
    downloadFile('tasktrail-completion-history.csv', 'text/csv;charset=utf-8', completionHistoryCsv(completionHistory));
  }

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
        <div className="settings-shortcuts">
          <Link href="/settings/auto-tagging" className="btn-3d">Auto-tagging settings</Link>
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
            <div className="history-panel">
              <div className="history-head">
                <div>
                  <span className="section-eyebrow">History</span>
                  <h3>Completion History</h3>
                </div>
                <div className="history-actions">
                  <button type="button" className="btn-ghost" disabled={completionHistory.length === 0} onClick={downloadCompletionHistoryJson}>
                    JSON
                  </button>
                  <button type="button" className="btn-ghost" disabled={completionHistory.length === 0} onClick={downloadCompletionHistoryCsv}>
                    CSV
                  </button>
                </div>
              </div>
              {completionHistory.length > 0 ? (
                <div className="history-list">
                  {completionHistory.map((entry) => (
                    <article key={entry.id} className="history-item">
                      <strong>{entry.title}</strong>
                      <span>{new Date(entry.completedAt).toLocaleString()}</span>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="clock-empty">No completion history yet.</p>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
