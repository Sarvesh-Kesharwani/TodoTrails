'use client';

import { useEffect } from 'react';

export function AuthPopupComplete() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get('returnTo') || '/';

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'mytodo-auth-complete', returnTo }, window.location.origin);
      window.close();
      return;
    }

    window.location.replace(returnTo);
  }, []);

  return (
    <main className="auth-complete">
      <section className="panel">
        <span className="section-eyebrow">Google</span>
        <h1>Finishing sign in...</h1>
      </section>
    </main>
  );
}
