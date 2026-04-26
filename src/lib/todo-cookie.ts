import { cookies } from 'next/headers';
import { DEFAULT_STORE, type TodoStore, normalizeStore } from '@/types/todo';

const STORE_COOKIE = 'mytodo_store';
const DRIVE_READY_COOKIE = 'mytodo_drive_ready';
const LOCAL_UPDATED_COOKIE = 'mytodo_store_updated_at';
const LOCAL_DIRTY_COOKIE = 'mytodo_store_dirty';
const MAX_AGE = 60 * 60 * 24 * 365;

export async function getCookieTodoStore(): Promise<TodoStore> {
  const jar = await cookies();
  const raw = jar.get(STORE_COOKIE)?.value;
  if (!raw) return { ...DEFAULT_STORE, updatedAt: new Date().toISOString() };

  try {
    const parsed = JSON.parse(raw);
    return normalizeStore(parsed);
  } catch {
    return { ...DEFAULT_STORE, updatedAt: new Date().toISOString() };
  }
}

export async function setCookieTodoStore(store: TodoStore): Promise<void> {
  const jar = await cookies();
  jar.set(STORE_COOKIE, JSON.stringify(normalizeStore(store)), {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
}

export async function hasDriveSyncHydrated(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(DRIVE_READY_COOKIE)?.value === '1';
}

export async function markDriveSyncHydrated(): Promise<void> {
  const jar = await cookies();
  jar.set(DRIVE_READY_COOKIE, '1', {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
}

export async function getCookieSyncMeta(): Promise<{ updatedAt: string | null; dirty: boolean }> {
  const jar = await cookies();
  return {
    updatedAt: jar.get(LOCAL_UPDATED_COOKIE)?.value ?? null,
    dirty: jar.get(LOCAL_DIRTY_COOKIE)?.value === '1',
  };
}

export async function markCookieTodoStoreDirty(updatedAt = new Date().toISOString()): Promise<void> {
  const jar = await cookies();
  jar.set(LOCAL_UPDATED_COOKIE, updatedAt, { maxAge: MAX_AGE, path: '/', sameSite: 'lax' });
  jar.set(LOCAL_DIRTY_COOKIE, '1', { maxAge: MAX_AGE, path: '/', sameSite: 'lax' });
}

export async function markCookieTodoStoreSynced(updatedAt = new Date().toISOString()): Promise<void> {
  const jar = await cookies();
  jar.set(LOCAL_UPDATED_COOKIE, updatedAt, { maxAge: MAX_AGE, path: '/', sameSite: 'lax' });
  jar.set(LOCAL_DIRTY_COOKIE, '0', { maxAge: MAX_AGE, path: '/', sameSite: 'lax' });
}

export async function clearCookieTodoStore(): Promise<void> {
  const jar = await cookies();
  jar.delete(STORE_COOKIE);
  jar.delete(DRIVE_READY_COOKIE);
  jar.delete(LOCAL_UPDATED_COOKIE);
  jar.delete(LOCAL_DIRTY_COOKIE);
}
