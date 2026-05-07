import { cookies } from 'next/headers';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { DEFAULT_STORE, type TodoStore, normalizeStore } from '@/types/todo';

const STORE_COOKIE = 'mytodo_store';
const STORE_CHUNK_COUNT_COOKIE = 'mytodo_store_chunks';
const STORE_CHUNK_COOKIE_PREFIX = 'mytodo_store_chunk_';
const DRIVE_READY_COOKIE = 'mytodo_drive_ready';
const LOCAL_UPDATED_COOKIE = 'mytodo_store_updated_at';
const LOCAL_DIRTY_COOKIE = 'mytodo_store_dirty';
const MAX_AGE = 60 * 60 * 24 * 365;
const MAX_COOKIE_CHUNK_SIZE = 3000;

function encodeStore(store: TodoStore): string {
  return deflateRawSync(Buffer.from(JSON.stringify(normalizeStore(store)), 'utf8')).toString('base64url');
}

function decodeStore(value: string): TodoStore {
  const encoded = Buffer.from(value, 'base64url');
  try {
    return normalizeStore(JSON.parse(inflateRawSync(encoded).toString('utf8')));
  } catch {
    return normalizeStore(JSON.parse(encoded.toString('utf8')));
  }
}

export async function getCookieTodoStore(): Promise<TodoStore> {
  const jar = await cookies();
  const chunkCount = Number(jar.get(STORE_CHUNK_COUNT_COOKIE)?.value ?? '0');
  if (Number.isInteger(chunkCount) && chunkCount > 0) {
    try {
      const encoded = Array.from({ length: chunkCount }, (_, index) => jar.get(`${STORE_CHUNK_COOKIE_PREFIX}${index}`)?.value ?? '').join('');
      if (encoded) return decodeStore(encoded);
    } catch {
      return { ...DEFAULT_STORE, updatedAt: new Date().toISOString() };
    }
  }

  const raw = jar.get(STORE_COOKIE)?.value;
  if (!raw) return { ...DEFAULT_STORE, updatedAt: new Date().toISOString() };

  try {
    if (raw.trim().startsWith('{')) return normalizeStore(JSON.parse(raw));
    return decodeStore(raw);
  } catch {
    return { ...DEFAULT_STORE, updatedAt: new Date().toISOString() };
  }
}

export async function setCookieTodoStore(store: TodoStore): Promise<void> {
  const jar = await cookies();
  const oldChunkCount = Number(jar.get(STORE_CHUNK_COUNT_COOKIE)?.value ?? '0');
  const encoded = encodeStore(store);
  const chunks = encoded.match(new RegExp(`.{1,${MAX_COOKIE_CHUNK_SIZE}}`, 'g')) ?? [''];

  jar.delete(STORE_COOKIE);
  jar.set(STORE_CHUNK_COUNT_COOKIE, String(chunks.length), { maxAge: MAX_AGE, path: '/', sameSite: 'lax' });

  chunks.forEach((chunk, index) => {
    jar.set(`${STORE_CHUNK_COOKIE_PREFIX}${index}`, chunk, {
      maxAge: MAX_AGE,
      path: '/',
      sameSite: 'lax',
    });
  });

  if (Number.isInteger(oldChunkCount)) {
    for (let index = chunks.length; index < oldChunkCount; index += 1) {
      jar.delete(`${STORE_CHUNK_COOKIE_PREFIX}${index}`);
    }
  }
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
  const chunkCount = Number(jar.get(STORE_CHUNK_COUNT_COOKIE)?.value ?? '0');
  jar.delete(STORE_COOKIE);
  jar.delete(STORE_CHUNK_COUNT_COOKIE);
  if (Number.isInteger(chunkCount)) {
    for (let index = 0; index < chunkCount; index += 1) {
      jar.delete(`${STORE_CHUNK_COOKIE_PREFIX}${index}`);
    }
  }
  jar.delete(DRIVE_READY_COOKIE);
  jar.delete(LOCAL_UPDATED_COOKIE);
  jar.delete(LOCAL_DIRTY_COOKIE);
}
