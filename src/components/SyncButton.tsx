'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type SyncState = 'loading' | 'synced' | 'unsynced' | 'syncing' | 'no-auth';

type CachedSync = {
  state: SyncState;
  lastSynced: string | null;
  checkedAt: number;
};

const PULLED_KEY = 'mytodo_drive_pulled';
const SYNC_CACHE_KEY = 'mytodo_sync_state_v1';
const STORE_CHANGED_EVENT = 'mytodo-store-changed';
const AUTH_CHANGED_EVENT = 'mytodo-auth-changed';
const CHECK_STALE_MS = 90_000;
const RESUME_STALE_MS = 180_000;
const AUTO_SYNC_DEBOUNCE_MS = 1200;

let memorySync: CachedSync | null = null;

function readSyncCache(): CachedSync | null {
  if (memorySync) return memorySync;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SYNC_CACHE_KEY) ?? window.sessionStorage.getItem(SYNC_CACHE_KEY);
    if (!raw) return null;
    memorySync = JSON.parse(raw) as CachedSync;
    return memorySync;
  } catch {
    return null;
  }
}

function writeSyncCache(next: CachedSync) {
  memorySync = next;
  try {
    window.localStorage.setItem(SYNC_CACHE_KEY, JSON.stringify(next));
    window.sessionStorage.setItem(SYNC_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function SyncButton() {
  const router = useRouter();
  const [state, setState] = useState<SyncState>('loading');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const checkingRef = useRef(false);
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setCachedState = useCallback((nextState: SyncState, syncedAt?: string | null) => {
    const resolvedSyncedAt = syncedAt === undefined ? (memorySync?.lastSynced ?? null) : syncedAt;
    setState(nextState);
    setLastSynced(resolvedSyncedAt);
    writeSyncCache({ state: nextState, lastSynced: resolvedSyncedAt, checkedAt: Date.now() });
  }, []);

  const checkSync = useCallback(async (force = false) => {
    const current = readSyncCache();
    if (!force && current && Date.now() - current.checkedAt < CHECK_STALE_MS) {
      setState(current.state);
      setLastSynced(current.lastSynced);
      return;
    }
    if (syncingRef.current || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const r = await fetch('/api/drive/sync');
      if (r.status === 401) return void setCachedState('no-auth', null);
      if (!r.ok) return void setCachedState('unsynced');
      const data = (await r.json()) as { synced: boolean; updatedAt?: string | null };
      setCachedState(data.synced ? 'synced' : 'unsynced', data.updatedAt ?? null);
    } catch {
      setCachedState('unsynced');
    } finally {
      checkingRef.current = false;
    }
  }, [setCachedState]);

  const pushSync = useCallback(async (background = false) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (!background) setCachedState('syncing');

    try {
      const r = await fetch('/api/drive/sync', { method: 'POST' });
      if (r.status === 401) return void setCachedState('no-auth', null);
      if (!r.ok) return void setCachedState('unsynced');
      const data = (await r.json()) as { replacedLocal?: boolean; updatedAt?: string };
      const syncedAt = data.updatedAt ?? new Date().toISOString();
      setCachedState('synced', syncedAt);
      if (data.replacedLocal) {
        window.dispatchEvent(new CustomEvent(STORE_CHANGED_EVENT, { detail: { forceReload: true } }));
        router.refresh();
      }
    } catch {
      setCachedState('unsynced');
    } finally {
      syncingRef.current = false;
    }
  }, [router, setCachedState]);

  const hydrateFromDrive = useCallback(async () => {
    if (sessionStorage.getItem(PULLED_KEY)) {
      void checkSync();
      return;
    }

    setCachedState(readSyncCache()?.state ?? 'loading');
    try {
      const r = await fetch('/api/drive/sync', { method: 'PUT' });
      if (r.status === 401) return void setCachedState('no-auth', null);
      if (!r.ok) return void setCachedState('unsynced');
      const data = (await r.json()) as { updatedAt?: string | null };
      sessionStorage.setItem(PULLED_KEY, '1');
      setCachedState('synced', data.updatedAt ?? null);
      window.dispatchEvent(new CustomEvent(STORE_CHANGED_EVENT, { detail: { forceReload: true } }));
      router.refresh();
    } catch {
      void checkSync(true);
    }
  }, [checkSync, router, setCachedState]);

  useEffect(() => {
    const cached = readSyncCache();
    if (cached) {
      queueMicrotask(() => {
        setState(cached.state);
        setLastSynced(cached.lastSynced);
      });
    }
    queueMicrotask(() => void hydrateFromDrive());
  }, [hydrateFromDrive]);

  useEffect(() => {
    const onStoreChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ autoSync?: boolean; forceReload?: boolean }>).detail;
      if (detail?.forceReload) return;
      setCachedState('unsynced', null);
      if (!detail?.autoSync) return;
      if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
      autoSyncTimerRef.current = setTimeout(() => void pushSync(true), AUTO_SYNC_DEBOUNCE_MS);
    };
    window.addEventListener(STORE_CHANGED_EVENT, onStoreChanged);
    return () => {
      if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
      window.removeEventListener(STORE_CHANGED_EVENT, onStoreChanged);
    };
  }, [pushSync, setCachedState]);

  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState === 'hidden') return;
      const current = readSyncCache();
      if (!current || Date.now() - current.checkedAt > RESUME_STALE_MS) void checkSync(true);
    };
    const onAuthChanged = () => {
      sessionStorage.removeItem(PULLED_KEY);
      void hydrateFromDrive();
    };
    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => {
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    };
  }, [checkSync, hydrateFromDrive]);

  if (state === 'no-auth') return null;

  const isSynced = state === 'synced';
  const isSyncing = state === 'syncing' || state === 'loading';
  const label = isSyncing ? '↻' : '●';
  const title = isSyncing
    ? 'Syncing with Google Drive...'
    : isSynced
      ? `Synced${lastSynced ? ' · ' + new Date(lastSynced).toLocaleTimeString() : ''}`
      : 'Not synced - click to sync now';

  return (
    <button
      onClick={!isSynced && !isSyncing ? () => void pushSync() : undefined}
      title={title}
      disabled={isSyncing}
      className={`sync-dot ${isSyncing ? 'is-syncing' : ''} ${isSynced ? 'is-synced' : 'is-unsynced'}`}
    >
      <span className={isSyncing ? 'spin' : ''}>{label}</span>
    </button>
  );
}
