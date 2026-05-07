'use client';

import { signIn } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';

const AUTH_CHANGED_EVENT = 'mytodo-auth-changed';
const POPUP_WIDTH = 520;
const POPUP_HEIGHT = 680;

function popupFeatures() {
  const left = Math.max(0, window.screenX + (window.outerWidth - POPUP_WIDTH) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2);
  return [
    `width=${POPUP_WIDTH}`,
    `height=${POPUP_HEIGHT}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
    'popup=yes',
    'resizable=yes',
    'scrollbars=yes',
  ].join(',');
}

export function SignInButton({ onSignedIn }: { onSignedIn?: () => void }) {
  const [pending, setPending] = useState(false);
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'mytodo-auth-complete') return;
      setPending(false);
      popupRef.current?.close();
      popupRef.current = null;
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      onSignedIn?.();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSignedIn]);

  async function startPopupSignin() {
    if (pending) return;
    setPending(true);

    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const completeUrl = `/auth/popup-complete?returnTo=${encodeURIComponent(returnTo)}`;
    const popup = window.open('about:blank', 'tasktrail-google-signin', popupFeatures());
    popupRef.current = popup;

    try {
      const response = await signIn(
        'google',
        { redirect: false, redirectTo: completeUrl },
        { prompt: 'select_account' },
      );

      if (!response?.url) throw new Error('Missing sign-in URL');

      if (popup && !popup.closed) {
        popup.location.href = response.url;
        popup.focus();
        return;
      }

      window.location.href = response.url;
    } catch {
      popup?.close();
      popupRef.current = null;
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      disabled={pending}
      className="btn-3d google-signin-btn"
      aria-label={pending ? 'Opening Google sign in' : 'Sign in with Google'}
      title={pending ? 'Opening Google...' : 'Sign in with Google'}
      onClick={() => void startPopupSignin()}
    >
      {pending ? '...' : 'G'}
    </button>
  );
}
