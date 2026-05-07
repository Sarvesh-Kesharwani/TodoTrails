'use client';

import { useEffect, useState } from 'react';

export type WorkspaceView = 'ashi' | 'today' | 'week' | 'month' | 'board' | 'settings';

const WORKSPACE_VIEW_EVENT = 'mytodo-workspace-view';

const VIEWS: Array<{ key: WorkspaceView; label: string; group: 'planner' | 'manage'; icon?: 'settings' }> = [
  { key: 'ashi', label: 'Ashi', group: 'planner' },
  { key: 'today', label: 'Today', group: 'planner' },
  { key: 'week', label: 'Weekly', group: 'planner' },
  { key: 'month', label: 'Monthly', group: 'planner' },
  { key: 'board', label: 'Board', group: 'manage' },
  { key: 'settings', label: 'Settings', group: 'manage', icon: 'settings' },
];

function viewFromLocation(): WorkspaceView {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  if (tab === 'ashi' || tab === 'board' || tab === 'settings' || tab === 'today' || tab === 'week' || tab === 'month') return tab;
  if (window.location.pathname === '/board') return 'board';
  if (window.location.pathname === '/settings') return 'settings';
  return 'today';
}

export function setWorkspaceView(view: WorkspaceView, replace = false) {
  const url = view === 'today' ? '/' : `/?tab=${view}`;
  if (replace) window.history.replaceState({ view }, '', url);
  else window.history.pushState({ view }, '', url);
  window.dispatchEvent(new CustomEvent(WORKSPACE_VIEW_EVENT, { detail: { view } }));
}

export function FastWorkspaceNav() {
  const [active, setActive] = useState<WorkspaceView>('today');

  useEffect(() => {
    queueMicrotask(() => setActive(viewFromLocation()));
    const onView = (event: Event) => {
      const view = (event as CustomEvent<{ view?: WorkspaceView }>).detail?.view;
      if (view) setActive(view);
    };
    const onPopState = () => setActive(viewFromLocation());
    window.addEventListener(WORKSPACE_VIEW_EVENT, onView);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener(WORKSPACE_VIEW_EVENT, onView);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  return (
    <nav className="workspace-tabs" aria-label="Workspace views">
      {VIEWS.map((view, index) => (
        <span
          key={view.key}
          className={`workspace-tab-wrap ${index > 0 && VIEWS[index - 1].group !== view.group ? 'has-separator' : ''}`}
        >
          <button
            type="button"
            className={`btn-ghost topbar-link workspace-tab ${view.icon ? 'workspace-tab-icon' : ''} ${active === view.key ? 'is-active' : ''}`}
            aria-current={active === view.key ? 'page' : undefined}
            aria-label={view.label}
            title={view.label}
            onClick={() => setWorkspaceView(view.key)}
          >
            {view.icon === 'settings' ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" className="settings-nav-icon">
                <path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z" />
                <path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.5-1.4L14.2 2h-4.4l-.4 3.2A8 8 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.5 1.4l.4 3.2h4.4l.4-3.2a8 8 0 0 0 2.5-1.4l2.4 1 2-3.4-2.2-1.5Z" />
              </svg>
            ) : (
              view.label
            )}
          </button>
        </span>
      ))}
    </nav>
  );
}

export { WORKSPACE_VIEW_EVENT, viewFromLocation };
