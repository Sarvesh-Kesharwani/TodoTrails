'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TodoItem } from '@/types/todo';
import {
  MONTH_SHORT_NAMES,
  PLANNER_YEAR,
  clampPlannerDate,
  endOfDay,
  fromDateKey,
  getMonthWeeks,
  getWeekForDate,
  parseDate,
  sameLocalDay,
  toDateKey,
} from '@/lib/planner-date';
import { useTodoStore } from './useTodoStore';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function taskClockTime(todo: TodoItem): Date | null {
  const value = todo.scheduledAt ?? todo.deadline;
  return parseDate(value);
}

function taskDate(todo: TodoItem): Date | null {
  return parseDate(todo.scheduledAt) ?? parseDate(todo.deadline);
}

const BUBBLE_SLOTS = [
  { r: 32, da: 0 },
  { r: 24, da: -7 },
  { r: 24, da: 7 },
  { r: 39, da: -5 },
  { r: 39, da: 5 },
];

type Period = 'AM' | 'PM';
type ClockKind = 'repetitive' | 'oneTimer';
const CLOCK_COLUMNS: Array<{ kind: ClockKind; label: string; bucketKey: 'rep' | 'one' }> = [
  { kind: 'repetitive', label: 'repetitive', bucketKey: 'rep' },
  { kind: 'oneTimer', label: 'one timer', bucketKey: 'one' },
];
type PendingAction = { kind: 'complete' | 'delete'; todo: TodoItem };
type SelectedBubble = { todo: TodoItem; angle: number; radius: number; faceKey: string; cloudX: string } | null;

export function TodoDashboard() {
  const { store, loaded, persist, updateTodo, deleteTodo } = useTodoStore();
  const [selectedDate, setSelectedDate] = useState(() => clampPlannerDate(new Date()));
  const [dateIsLive, setDateIsLive] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function refreshServerDate() {
      try {
        const response = await fetch('/api/time', { cache: 'no-store' });
        if (!response.ok) return;
        const data = (await response.json()) as { now?: string };
        const parsed = data.now ? new Date(data.now) : null;
        if (!cancelled && parsed && !Number.isNaN(parsed.getTime())) {
          setSelectedDate((current) => (dateIsLive ? clampPlannerDate(parsed) : current));
        }
      } catch {
        /* browser clock remains the fallback */
      }
    }
    void refreshServerDate();
    const timer = window.setInterval(() => {
      setSelectedDate((current) => (dateIsLive ? clampPlannerDate(new Date()) : current));
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [dateIsLive]);

  const selectedWeeks = useMemo(() => getMonthWeeks(PLANNER_YEAR, selectedDate.getMonth()), [selectedDate]);
  const selectedWeek = useMemo(() => getWeekForDate(selectedDate), [selectedDate]);

  function setManualDate(date: Date) {
    setDateIsLive(false);
    setSelectedDate(clampPlannerDate(date));
  }

  const todayTodos = useMemo(
    () =>
      store.todos.filter((todo) => {
        if (todo.bucket !== 'today' || todo.done) return false;
        const date = taskDate(todo);
        return date ? sameLocalDay(date, selectedDate) : dateIsLive && sameLocalDay(new Date(), selectedDate);
      }),
    [store.todos, selectedDate, dateIsLive],
  );

  const bubbleSets = useMemo(() => {
    const make = () => new Map<number, Array<{ todo: TodoItem; time: Date }>>();
    const buckets: Record<'rep' | 'one', { am: Map<number, Array<{ todo: TodoItem; time: Date }>>; pm: Map<number, Array<{ todo: TodoItem; time: Date }>> }> = {
      rep: { am: make(), pm: make() },
      one: { am: make(), pm: make() },
    };
    for (const todo of todayTodos) {
      const time = taskClockTime(todo);
      if (!time) continue;
      const kind = todo.repetitive ? 'rep' : 'one';
      const period = time.getHours() >= 12 ? 'pm' : 'am';
      const hour = time.getHours() % 12 || 12;
      const groups = buckets[kind][period];
      const arr = groups.get(hour) ?? [];
      arr.push({ todo, time });
      groups.set(hour, arr);
    }
    const build = (groups: Map<number, Array<{ todo: TodoItem; time: Date }>>) => {
      const out: Array<{ todo: TodoItem; time: Date; angle: number; radius: number }> = [];
      for (const [hour, items] of groups) {
        const baseAngle = (hour - 0.5) * 30;
        items.slice(0, 5).forEach((item, i) => {
          const slot = BUBBLE_SLOTS[i];
          out.push({ todo: item.todo, time: item.time, angle: baseAngle + slot.da, radius: slot.r });
        });
      }
      return out;
    };
    return {
      rep: { am: build(buckets.rep.am), pm: build(buckets.rep.pm) },
      one: { am: build(buckets.one.am), pm: build(buckets.one.pm) },
    };
  }, [todayTodos]);

  const todayClockTasks = useMemo(
    () =>
      todayTodos
        .map((todo) => {
          const time = taskClockTime(todo);
          return time ? { todo, time } : null;
        })
        .filter((item): item is { todo: TodoItem; time: Date } => Boolean(item))
        .sort((a, b) => {
          const am = a.time.getHours() * 60 + a.time.getMinutes();
          const bm = b.time.getHours() * 60 + b.time.getMinutes();
          if (am !== bm) return am - bm;
          return a.time.getTime() - b.time.getTime();
        }),
    [todayTodos],
  );

  const untimedDayTasks = useMemo(
    () => todayTodos.filter((todo) => !todo.scheduledAt),
    [todayTodos],
  );

  const [bubbleDragId, setBubbleDragId] = useState<string | null>(null);
  const [popupSlot, setPopupSlot] = useState<{ hour: number; period: Period; kind: ClockKind } | null>(null);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickNotes, setQuickNotes] = useState('');
  const [quickDimValues, setQuickDimValues] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [selectedBubble, setSelectedBubble] = useState<SelectedBubble>(null);

  useEffect(() => {
    if (!pendingAction) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingAction(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingAction]);

  function hourToH24(hour: number, period: Period): number {
    if (hour === 12) return period === 'PM' ? 12 : 0;
    return period === 'PM' ? hour + 12 : hour;
  }

  async function moveBubbleToHour(todoId: string, hour: number, period: Period, kind: ClockKind) {
    const todo = store.todos.find((t) => t.id === todoId);
    if (!todo) return;
    const base = todo.scheduledAt ? new Date(todo.scheduledAt) : selectedDate;
    const next = new Date(base);
    next.setHours(hourToH24(hour, period), 0, 0, 0);
    await updateTodo(todoId, (t) => ({
      ...t,
      bucket: 'today',
      deadline: endOfDay(selectedDate).toISOString(),
      scheduledAt: next.toISOString(),
      repetitive: kind === 'repetitive',
    }));
    setSelectedBubble(null);
  }

  async function runPendingAction() {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    setSelectedBubble(null);
    if (action.kind === 'complete') {
      await updateTodo(action.todo.id, (t) => ({ ...t, bucket: 'completed', done: true }));
      return;
    }
    await deleteTodo(action.todo.id);
  }

  function openHourPopup(hour: number, period: Period, kind: ClockKind) {
    setSelectedBubble(null);
    setPopupSlot({ hour, period, kind });
    setQuickTitle('');
    setQuickNotes('');
    setQuickDimValues({});
  }

  async function addQuickTodo() {
    if (!popupSlot) return;
    const cleanTitle = quickTitle.trim();
    if (!cleanTitle) return;
    const now = new Date();
    const scheduled = new Date(selectedDate);
    scheduled.setHours(hourToH24(popupSlot.hour, popupSlot.period), 0, 0, 0);
    const nowIso = now.toISOString();
    const todo: TodoItem = {
      id: uid(),
      title: cleanTitle,
      notes: quickNotes.trim() || undefined,
      bucket: 'today',
      deadline: endOfDay(selectedDate).toISOString(),
      scheduledAt: scheduled.toISOString(),
      done: false,
      repetitive: popupSlot.kind === 'repetitive',
      dimensionValues: Object.fromEntries(Object.entries(quickDimValues).filter(([, v]) => v.trim())),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await persist({ ...store, todos: [todo, ...store.todos], updatedAt: nowIso });
    setPopupSlot(null);
  }

  function chooseBubble(todo: TodoItem, angle: number, radius: number, faceKey: string) {
    setPopupSlot(null);
    const normalizedAngle = ((angle % 360) + 360) % 360;
    const cloudX =
      normalizedAngle > 180 && normalizedAngle < 330
        ? '34cqi'
        : normalizedAngle > 30 && normalizedAngle < 180
          ? '-34cqi'
          : '0px';
    setSelectedBubble((current) =>
      current?.todo.id === todo.id && current.faceKey === faceKey ? null : { todo, angle, radius, faceKey, cloudX },
    );
  }

  if (!loaded) return <section className="panel">Loading your board...</section>;

  return (
    <div className="board-wrap home-shell">
      <section className="panel clock-panel">
        <div className="panel-head">
          <div>
            <span className="section-eyebrow">Today Clock</span>
            <h2>Time map for {selectedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</h2>
          </div>
          <span className="section-chip">{todayClockTasks.length} timed tasks</span>
        </div>
        <div className="clock-date-filter" aria-label="Day filters for 2026">
          <label>
            Month
            <select
              value={selectedDate.getMonth()}
              onChange={(event) => {
                const nextMonth = Number(event.target.value);
                const maxDay = new Date(PLANNER_YEAR, nextMonth + 1, 0).getDate();
                setManualDate(new Date(PLANNER_YEAR, nextMonth, Math.min(selectedDate.getDate(), maxDay)));
              }}
            >
              {MONTH_SHORT_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
            </select>
          </label>
          <label>
            Week
            <select
              value={selectedWeek.index}
              onChange={(event) => {
                const nextWeek = selectedWeeks.find((week) => week.index === Number(event.target.value)) ?? selectedWeeks[0];
                setManualDate(nextWeek.days[0]);
              }}
            >
              {selectedWeeks.map((week) => (
                <option key={week.index} value={week.index}>week{week.index}</option>
              ))}
            </select>
          </label>
          <label>
            Day
            <select value={toDateKey(selectedDate)} onChange={(event) => setManualDate(fromDateKey(event.target.value))}>
              {selectedWeek.days.map((day) => (
                <option key={toDateKey(day)} value={toDateKey(day)}>
                  {day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={dateIsLive ? 'planner-chip is-active' : 'planner-chip'}
            onClick={() => {
              setDateIsLive(true);
              setSelectedDate(clampPlannerDate(new Date()));
            }}
          >
            live
          </button>
        </div>
        <div className="clock-layout">
          <div className="clock-grid">
            {CLOCK_COLUMNS.map((col) => (
              <div key={col.kind} className={`clock-column clock-column-${col.kind}`}>
                <h3 className="clock-column-title">{col.label}</h3>
                <div className="clock-pair">
                  {(['AM', 'PM'] as const).map((period) => {
                    const bubbles =
                      period === 'AM'
                        ? bubbleSets[col.bucketKey].am
                        : bubbleSets[col.bucketKey].pm;
                    return (
                      <div key={period} className="task-clock">
                        <span className="clock-period-label">{period}</span>
                        {(() => {
                          const faceKey = `${col.kind}-${period}`;
                          return (
                        <div className={`clock-face clock-face-${period.toLowerCase()} clock-face-${col.kind}`}>
                          {Array.from({ length: 12 }, (_, index) => {
                            const hour = index + 1;
                            const angle = (hour - 0.5) * 30;
                            return (
                              <button
                                key={`sector-${col.kind}-${period}-${hour}`}
                                type="button"
                                className="clock-sector"
                                style={{ ['--angle' as string]: `${angle}deg` }}
                                onDoubleClick={() => openHourPopup(hour, period, col.kind)}
                                onDragOver={(e) => {
                                  if (bubbleDragId) e.preventDefault();
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (bubbleDragId) {
                                    void moveBubbleToHour(bubbleDragId, hour, period, col.kind);
                                    setBubbleDragId(null);
                                  }
                                }}
                                aria-label={`Add ${col.label} task at ${hour} ${period}`}
                              />
                            );
                          })}
                          <div className="clock-cross clock-cross-vertical" />
                          <div className="clock-cross clock-cross-horizontal" />
                          {Array.from({ length: 12 }, (_, index) => {
                            const hour = index + 1;
                            const angle = (hour / 12) * 360;
                            return (
                              <span
                                key={`label-${col.kind}-${period}-${hour}`}
                                className="clock-hour"
                                style={{ ['--angle' as string]: `${angle}deg` }}
                              >
                                {hour}
                              </span>
                            );
                          })}
                          {bubbles.map(({ todo, angle, radius }) => (
                            <span
                              key={todo.id}
                              className={`clock-bubble ${selectedBubble?.todo.id === todo.id ? 'is-selected' : ''}`}
                              draggable
                              role="button"
                              tabIndex={0}
                              onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', todo.id);
                                setBubbleDragId(todo.id);
                              }}
                              onDragEnd={() => setBubbleDragId(null)}
                              onClick={() => chooseBubble(todo, angle, radius, faceKey)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  chooseBubble(todo, angle, radius, faceKey);
                                }
                              }}
                              style={{
                                ['--angle' as string]: `${angle}deg`,
                                ['--radius' as string]: `${radius}cqi`,
                              }}
                            >
                              <span className="clock-bubble-tip">{todo.title}</span>
                            </span>
                          ))}
                          {selectedBubble?.faceKey === faceKey ? (
                            <div
                              className="clock-bubble-cloud"
                              style={{
                                ['--angle' as string]: `${selectedBubble.angle}deg`,
                                ['--radius' as string]: `${selectedBubble.radius}cqi`,
                                ['--cloud-x' as string]: selectedBubble.cloudX,
                              }}
                            >
                              <strong>{selectedBubble.todo.title}</strong>
                              <div className="clock-cloud-actions">
                                <button
                                  type="button"
                                  className="clock-action-btn clock-action-complete"
                                  aria-label={`Mark ${selectedBubble.todo.title} completed`}
                                  title="Mark completed"
                                  onClick={() => setPendingAction({ kind: 'complete', todo: selectedBubble.todo })}
                                >
                                  <svg viewBox="0 0 16 16" aria-hidden="true">
                                    <path d="M3 8.2 6.4 11.5 13 4.5" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  className="clock-action-btn clock-action-delete"
                                  aria-label={`Delete ${selectedBubble.todo.title}`}
                                  title="Delete"
                                  onClick={() => setPendingAction({ kind: 'delete', todo: selectedBubble.todo })}
                                >
                                  <svg viewBox="0 0 16 16" aria-hidden="true">
                                    <path d="M4 4 12 12M12 4 4 12" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          ) : null}
                          <span className="clock-center" />
                        </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {untimedDayTasks.length > 0 ? (
            <div className="day-unscheduled-strip" aria-label="Tasks for this day without a specific time">
              <strong>Drag to clock</strong>
              <div>
                {untimedDayTasks.map((todo) => (
                  <span
                    key={todo.id}
                    className="day-unscheduled-task"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', todo.id);
                      setBubbleDragId(todo.id);
                    }}
                    onDragEnd={() => setBubbleDragId(null)}
                  >
                    {todo.title}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {popupSlot ? (
            <div className="clock-popup">
              <div className="clock-popup-head">
                <strong>
                  Add {popupSlot.kind === 'repetitive' ? 'repetitive' : 'one-timer'} task at {popupSlot.hour}:00 {popupSlot.period}
                </strong>
                <button type="button" className="btn-ghost" onClick={() => setPopupSlot(null)}>Close</button>
              </div>
              <div className="form-grid">
                <input placeholder="Task title" value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)} autoFocus />
                <textarea placeholder="Notes (optional)" value={quickNotes} onChange={(e) => setQuickNotes(e.target.value)} />
                {store.dimensions.map((dim) => (
                  <label key={dim.id}>{dim.name}
                    <input
                      placeholder={dim.optional ? 'Optional' : 'Required'}
                      value={quickDimValues[dim.id] ?? ''}
                      onChange={(e) => setQuickDimValues((prev) => ({ ...prev, [dim.id]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
              <div className="cta-row">
                <button type="button" className="btn-3d" onClick={() => void addQuickTodo()}>Add Task</button>
                <button type="button" className="btn-ghost" onClick={() => setPopupSlot(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <details className="clock-side-details">
              <summary>AM / PM task lists</summary>
              <div className="clock-side-split">
              {(['AM', 'PM'] as const).map((period) => {
                const items = todayClockTasks.filter(({ time }) =>
                  period === 'PM' ? time.getHours() >= 12 : time.getHours() < 12,
                );
                return (
                  <div key={period} className="clock-side-column">
                    <h4 className="clock-side-heading">{period} tasks list</h4>
                    {items.length > 0 ? (
                      items.map(({ todo, time }) => (
                        <article key={todo.id} className="clock-side-item">
                          <div className="clock-side-item-head">
                            <strong>{time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong>
                            <div className="clock-side-actions">
                              <button
                                type="button"
                                className="clock-action-btn clock-action-complete"
                                aria-label={`Mark ${todo.title} completed`}
                                title="Mark completed"
                                onClick={() => setPendingAction({ kind: 'complete', todo })}
                              >
                                <svg viewBox="0 0 16 16" aria-hidden="true">
                                  <path d="M3 8.2 6.4 11.5 13 4.5" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="clock-action-btn clock-action-delete"
                                aria-label={`Delete ${todo.title}`}
                                title="Delete"
                                onClick={() => setPendingAction({ kind: 'delete', todo })}
                              >
                                <svg viewBox="0 0 16 16" aria-hidden="true">
                                  <path d="M4 4 12 12M12 4 4 12" />
                                </svg>
                              </button>
                            </div>
                          </div>
                          <span>{todo.title}</span>
                        </article>
                      ))
                    ) : (
                      <p className="clock-empty">No {period} tasks yet.</p>
                    )}
                  </div>
                );
              })}
              </div>
            </details>
          )}
        </div>
      </section>
      {pendingAction && (
        <div
          className="confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingAction(null);
          }}
        >
          <section
            className={`confirm-dialog confirm-dialog-${pendingAction.kind}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="todo-confirm-title"
          >
            <span className="section-eyebrow">{pendingAction.kind === 'complete' ? 'Confirm Complete' : 'Confirm Delete'}</span>
            <h3 id="todo-confirm-title">
              {pendingAction.kind === 'complete' ? 'Mark task completed?' : 'Delete this task?'}
            </h3>
            <p>
              <strong>{pendingAction.todo.title}</strong>
              {pendingAction.kind === 'delete' ? ' will be removed permanently.' : ' will move to completed and be added to history.'}
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn-ghost" onClick={() => setPendingAction(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={pendingAction.kind === 'complete' ? 'btn-3d' : 'btn-ghost confirm-danger-btn'}
                onClick={() => void runPendingAction()}
              >
                {pendingAction.kind === 'complete' ? 'Mark Complete' : 'Delete'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
