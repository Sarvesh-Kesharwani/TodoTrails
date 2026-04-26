'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';

export function SignInButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      className="btn-3d"
      onClick={async () => {
        if (pending) return;
        setPending(true);
        try {
          await fetch('/api/auth/cleanup', { method: 'POST' });
          await signIn('google', { redirectTo: '/' });
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? 'Redirecting...' : 'Sign in with Google'}
    </button>
  );
}
