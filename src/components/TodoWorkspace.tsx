'use client';

import { useEffect, useState } from 'react';
import { BoardSettingsPage } from '@/components/BoardSettingsPage';
import { AshiPage } from '@/components/AshiPage';
import { PeriodPlanner } from '@/components/PeriodPlanner';
import { TodoBoard } from '@/components/TodoBoard';
import { TodoDashboard } from '@/components/TodoDashboard';
import {
  WORKSPACE_VIEW_EVENT,
  type WorkspaceView,
  setWorkspaceView,
  viewFromLocation,
} from '@/components/FastWorkspaceNav';

export function TodoWorkspace({ initialView = 'today' }: { initialView?: WorkspaceView }) {
  const [active, setActive] = useState<WorkspaceView>(initialView);

  useEffect(() => {
    const current = viewFromLocation();
    queueMicrotask(() => setActive(current));
    if (window.location.pathname === '/board' || window.location.pathname === '/settings') {
      setWorkspaceView(current, true);
    }

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
    <div className="workspace-shell">
      <section className="workspace-panel" hidden={active !== 'ashi'} aria-hidden={active !== 'ashi'}>
        <AshiPage />
      </section>
      <section className="workspace-panel" hidden={active !== 'today'} aria-hidden={active !== 'today'}>
        <TodoDashboard />
      </section>
      <section className="workspace-panel" hidden={active !== 'week'} aria-hidden={active !== 'week'}>
        <PeriodPlanner mode="week" />
      </section>
      <section className="workspace-panel" hidden={active !== 'month'} aria-hidden={active !== 'month'}>
        <PeriodPlanner mode="month" />
      </section>
      <section className="workspace-panel" hidden={active !== 'board'} aria-hidden={active !== 'board'}>
        <TodoBoard />
      </section>
      <section className="workspace-panel" hidden={active !== 'settings'} aria-hidden={active !== 'settings'}>
        <BoardSettingsPage />
      </section>
    </div>
  );
}
