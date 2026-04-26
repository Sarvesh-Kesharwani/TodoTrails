'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type SyncState = 'loading' | 'synced' | 'unsynced' | 'syncing' | 'no-auth';

const PULLED_KEY = 'mytodo_drive_pulled';
const STORE_CHANGED_EVENT = 'mytodo-store-changed';

export function SyncButton() {
  const router = useRouter();
  const [state, setState] = useState<SyncState>('loading');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const checkingRef = useRef(false);

  const checkSync = useCallback(async () => {
    if (syncingRef.current || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const r = await fetch('/api/drive/sync');
      if (r.status === 401) return void setState('no-auth');
      if (!r.ok) return void setState('unsynced');
      const data = (await r.json()) as { synced: boolean; updatedAt?: string | null };
      setState(data.synced ? 'synced' : 'unsynced');
      setLastSynced(data.updatedAt ?? null);
    } catch {
      setState('unsynced');
    } finally {
      checkingRef.current = false;
    }
  }, []);

  const pushSync = useCallback(async (background = false) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (!background) setState('syncing');

    try {
      const r = await fetch('/api/drive/sync', { method: 'POST' });
      if (r.status === 401) return void setState('no-auth');
      if (!r.ok) return void setState('unsynced');
      const data = (await r.json()) as { replacedLocal?: boolean; updatedAt?: string };
      setLastSynced(data.updatedAt ?? new Date().toISOString());
      setState('synced');
      if (data.replacedLocal) router.refresh();
    } catch {
      setState('unsynced');
    } finally {
      syncingRef.current = false;
    }
  }, [router]);

  useEffect(() => {
    if (sessionStorage.getItem(PULLED_KEY)) {
      queueMicrotask(() => void checkSync());
      return;
    }

    fetch('/api/drive/sync', { method: 'PUT' })
      .then((r) => {
        if (r.status === 401) return void setState('no-auth');
        if (!r.ok) return void setState('unsynced');
        sessionStorage.setItem(PULLED_KEY, '1');
        void checkSync();
        router.refresh();
      })
      .catch(() => void checkSync());
  }, [checkSync, router]);

  useEffect(() => {
    const onStoreChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ autoSync?: boolean }>).detail;
      setLastSynced(null);
      setState('unsynced');
      if (detail?.autoSync) void pushSync(true);
    };
    window.addEventListener(STORE_CHANGED_EVENT, onStoreChanged);
    return () => window.removeEventListener(STORE_CHANGED_EVENT, onStoreChanged);
  }, [pushSync]);

  useEffect(() => {
    if (state === 'no-auth') return;
    const id = setInterval(() => void checkSync(), 30_000);
    return () => clearInterval(id);
  }, [checkSync, state]);

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
