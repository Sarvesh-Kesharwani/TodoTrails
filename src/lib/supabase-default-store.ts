import 'server-only';
import { DEFAULT_STORE, normalizeStore, type TodoStore } from '@/types/todo';

const ROW_ID = 'default';

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

function headers(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

export async function getDefaultCloudTodoStore(): Promise<TodoStore> {
  const config = supabaseConfig();
  if (!config) return { ...DEFAULT_STORE, updatedAt: new Date().toISOString() };

  const res = await fetch(`${config.url}/rest/v1/todo_default_store?id=eq.${ROW_ID}&select=store`, {
    headers: headers(config.key),
    cache: 'no-store',
  });

  if (!res.ok) return { ...DEFAULT_STORE, updatedAt: new Date().toISOString() };
  const rows = (await res.json()) as Array<{ store?: unknown }>;
  return normalizeStore(rows[0]?.store ?? DEFAULT_STORE);
}

export async function setDefaultCloudTodoStore(store: TodoStore): Promise<{ updatedAt: string }> {
  const config = supabaseConfig();
  if (!config) throw new Error('Missing Supabase default-store config');

  const updatedAt = new Date().toISOString();
  const normalized = normalizeStore({ ...store, updatedAt });

  const res = await fetch(`${config.url}/rest/v1/todo_default_store?id=eq.${ROW_ID}`, {
    method: 'PATCH',
    headers: {
      ...headers(config.key),
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ store: normalized, updated_at: updatedAt }),
  });

  if (!res.ok) throw new Error('Failed to update Supabase default store');
  return { updatedAt };
}
