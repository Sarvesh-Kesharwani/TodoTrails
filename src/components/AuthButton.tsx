'use client';

import { getSession, signOut } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SignInButton } from '@/components/SignInButton';

type CachedUser = {
  name?: string | null;
  email?: string | null;
};

type AuthSnapshot = {
  user: CachedUser | null;
  checkedAt: number;
};

const AUTH_CACHE_KEY = 'mytodo_auth_snapshot_v1';
const AUTH_CHANGED_EVENT = 'mytodo-auth-changed';
const AUTH_STALE_MS = 60_000;
const AUTH_RESUME_STALE_MS = 120_000;

let memorySnapshot: AuthSnapshot | null = null;
let sessionRequest: Promise<AuthSnapshot> | null = null;

function readSnapshot(): AuthSnapshot | null {
  if (memorySnapshot) return memorySnapshot;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSnapshot;
    memorySnapshot = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: AuthSnapshot) {
  memorySnapshot = snapshot;
  try {
    window.localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    /* ignore */
  }
}

function clearSnapshot() {
  memorySnapshot = { user: null, checkedAt: Date.now() };
  try {
    window.localStorage.removeItem(AUTH_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

async function fetchSessionSnapshot(): Promise<AuthSnapshot> {
  if (!sessionRequest) {
    sessionRequest = getSession()
      .then((session) => {
        const snapshot: AuthSnapshot = {
          user: session?.user ? { name: session.user.name, email: session.user.email } : null,
          checkedAt: Date.now(),
        };
        writeSnapshot(snapshot);
        return snapshot;
      })
      .finally(() => {
        sessionRequest = null;
      });
  }
  return sessionRequest;
}

export function AuthButton() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({ user: null, checkedAt: 0 });
  const [signingOut, setSigningOut] = useState(false);
  const validatingRef = useRef(false);

  const validate = useCallback(async (force = false) => {
    const current = readSnapshot();
    if (!force && current && Date.now() - current.checkedAt < AUTH_STALE_MS) {
      setSnapshot(current);
      return;
    }
    if (validatingRef.current) return;
    validatingRef.current = true;
    try {
      setSnapshot(await fetchSessionSnapshot());
    } finally {
      validatingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const cached = readSnapshot();
    if (cached) queueMicrotask(() => setSnapshot(cached));
    queueMicrotask(() => void validate(!cached));

    const onAuthChanged = () => void validate(true);
    const onResume = () => {
      const current = readSnapshot();
      if (!current || Date.now() - current.checkedAt > AUTH_RESUME_STALE_MS) {
        void validate(true);
      }
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [validate]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    clearSnapshot();
    setSnapshot({ user: null, checkedAt: Date.now() });
    sessionStorage.removeItem('mytodo_drive_pulled');
    sessionStorage.removeItem('mytodo_sync_state_v1');
    try {
      await fetch('/api/auth/cleanup', { method: 'POST' });
      await signOut({ redirect: false, redirectTo: '/' });
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  if (!snapshot.user) return <SignInButton onSignedIn={() => void validate(true)} />;

  return (
    <div className="auth-chip">
      <span className="user-name">{snapshot.user.name ?? snapshot.user.email ?? 'Signed in'}</span>
      <button type="button" onClick={handleSignOut} disabled={signingOut} className="btn-ghost">
        {signingOut ? 'Signing out...' : 'Sign out'}
      </button>
    </div>
  );
}
