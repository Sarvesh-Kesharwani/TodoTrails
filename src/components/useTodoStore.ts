'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_STORE, type TodoItem, type TodoStore, normalizeStore } from '@/types/todo';

const STORE_CHANGED_EVENT = 'mytodo-store-changed';
const STORE_CACHE_KEY = 'mytodo_store_snapshot_v1';
const STORE_STALE_MS = 20_000;

let memoryStore: TodoStore | null = null;
let memoryLoadedAt = 0;
let pendingLoad: Promise<TodoStore | null> | null = null;

function isCompleted(todo: TodoItem) {
  return todo.done || todo.bucket === 'completed';
}

function completionHistoryEntry(todo: TodoItem, completedAt: string) {
  return {
    id: `${todo.id}-${completedAt}`,
    todoId: todo.id,
    title: todo.title,
    notes: todo.notes,
    deadline: todo.deadline,
    scheduledAt: todo.scheduledAt,
    dimensionValues: todo.dimensionValues,
    createdAt: todo.createdAt,
    completedAt,
  };
}

function readCachedStore(): TodoStore | null {
  if (memoryStore) return memoryStore;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORE_CACHE_KEY);
    if (!raw) return null;
    memoryStore = normalizeStore(JSON.parse(raw));
    return memoryStore;
  } catch {
    return null;
  }
}

function writeCachedStore(store: TodoStore) {
  memoryStore = normalizeStore(store);
  memoryLoadedAt = Date.now();
  try {
    window.localStorage.setItem(STORE_CACHE_KEY, JSON.stringify(memoryStore));
  } catch {
    /* ignore */
  }
}

async function loadStore(force = false): Promise<TodoStore | null> {
  if (!force && memoryStore && Date.now() - memoryLoadedAt < STORE_STALE_MS) return memoryStore;
  if (pendingLoad) return pendingLoad;

  pendingLoad = fetch('/api/todos')
    .then(async (response) => {
      if (!response.ok) return null;
      const store = normalizeStore(await response.json());
      writeCachedStore(store);
      return store;
    })
    .catch(() => null)
    .finally(() => {
      pendingLoad = null;
    });

  return pendingLoad;
}

export function useTodoStore() {
  const [store, setStore] = useState<TodoStore>(DEFAULT_STORE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = readCachedStore();
    if (cached) {
      queueMicrotask(() => {
        setStore(cached);
        setLoaded(true);
      });
    }

    void loadStore(!cached).then((data) => {
      if (cancelled) return;
      if (data) setStore(data);
      setLoaded(true);
    });

    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ store?: TodoStore; forceReload?: boolean }>).detail;
      if (detail?.store) {
        const next = normalizeStore(detail.store);
        writeCachedStore(next);
        setStore(next);
        setLoaded(true);
        return;
      }

      void loadStore(Boolean(detail?.forceReload)).then((data) => {
        if (data && !cancelled) setStore(data);
      });
    };

    window.addEventListener(STORE_CHANGED_EVENT, onChange as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(STORE_CHANGED_EVENT, onChange as EventListener);
    };
  }, []);

  async function persist(next: TodoStore, autoSync = false) {
    const normalized = normalizeStore(next);
    writeCachedStore(normalized);
    setStore(normalized);

    const response = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized),
    });
    if (!response.ok) return;

    const data = (await response.json()) as { updatedAt?: string };
    const saved = normalizeStore({ ...normalized, updatedAt: data.updatedAt ?? normalized.updatedAt });
    writeCachedStore(saved);
    setStore(saved);
    window.dispatchEvent(new CustomEvent(STORE_CHANGED_EVENT, { detail: { autoSync, store: saved } }));
  }

  async function updateTodo(todoId: string, updater: (todo: TodoItem) => TodoItem) {
    const nowIso = new Date().toISOString();
    let completionHistory = store.completionHistory;
    const nextTodos = store.todos.map((todo) => {
      if (todo.id !== todoId) return todo;
      const updated = { ...updater(todo), updatedAt: nowIso };
      if (!isCompleted(todo) && isCompleted(updated)) {
        completionHistory = [completionHistoryEntry(updated, nowIso), ...completionHistory];
      }
      return updated;
    });
    await persist({ ...store, todos: nextTodos, completionHistory, updatedAt: nowIso });
  }

  async function deleteTodo(todoId: string) {
    await persist({
      ...store,
      todos: store.todos.filter((todo) => todo.id !== todoId),
      updatedAt: new Date().toISOString(),
    });
  }

  return { store, loaded, persist, updateTodo, deleteTodo };
}
