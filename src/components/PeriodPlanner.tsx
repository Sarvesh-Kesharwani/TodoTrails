'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { TodoItem } from '@/types/todo';
import {
  MONTH_NAMES,
  MONTH_SHORT_NAMES,
  PLANNER_YEAR,
  endOfDay,
  endOfMonth,
  getMonthWeeks,
  parseDate,
  dateInRange,
} from '@/lib/planner-date';
import { setWorkspaceView } from './FastWorkspaceNav';
import { useTodoStore } from './useTodoStore';

type PlannerMode = 'week' | 'month';
type BroadTaskBucket = PlannerMode | 'quarter' | 'year';
type BubbleType = BroadTaskBucket | 'day';
type AddTarget =
  | { bucket: 'day'; day: Date }
  | { bucket: BroadTaskBucket; month?: number; weekIndex?: number; quarter?: number }
  | null;

const PLANNER_JUMP_EVENT = 'mytodo-planner-jump';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function todoDeadline(todo: TodoItem): Date | null {
  return parseDate(todo.deadline) ?? parseDate(todo.scheduledAt) ?? parseDate(todo.createdAt);
}

function monthLengthClass(monthIndex: number) {
  const days = new Date(PLANNER_YEAR, monthIndex + 1, 0).getDate();
  if (days === 30) return 'month-days-30';
  if (monthIndex === 1) return days === 28 ? 'month-feb-28' : 'month-feb-leap';
  return 'month-days-31';
}

function endOfQuarter(quarter: number) {
  return endOfDay(new Date(PLANNER_YEAR, quarter * 3 + 3, 0));
}

function PlannerTaskBubble({
  todo,
  type,
  onDragStart,
  onDragEnd,
  onDelete,
}: {
  todo: TodoItem;
  type: BubbleType;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDelete: () => void;
}) {
  return (
    <span className="planner-bubble-wrap" onClick={(event) => event.stopPropagation()}>
      <span
        className={`planner-bubble planner-bubble-${type}`}
        draggable
        role="button"
        tabIndex={0}
        aria-label={`${todo.title}, ${type} task`}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', todo.id);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
      />
      <span className="planner-bubble-cloud">
        <strong>{todo.title}</strong>
        <small>{type}</small>
        {todo.notes ? <span>{todo.notes}</span> : null}
        <button type="button" aria-label={`Delete ${todo.title}`} onClick={onDelete}>x</button>
      </span>
    </span>
  );
}

export function PeriodPlanner({ mode }: { mode: PlannerMode }) {
  const { store, loaded, persist, updateTodo, deleteTodo } = useTodoStore();
  const now = new Date();
  const [month, setMonth] = useState(now.getFullYear() === PLANNER_YEAR ? now.getMonth() : 0);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [addTarget, setAddTarget] = useState<AddTarget>(null);
  const [highlightedWeek, setHighlightedWeek] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const highlightTimer = useRef<number | null>(null);

  const weeks = useMemo(() => getMonthWeeks(PLANNER_YEAR, month), [month]);

  const activeTodos = useMemo(
    () => store.todos.filter((todo) => !todo.done && todo.bucket !== 'completed'),
    [store.todos],
  );

  const todosForWeek = (weekIndex: number) => {
    const week = weeks.find((item) => item.index === weekIndex);
    if (!week) return [];
    return activeTodos.filter((todo) => {
      if (todo.bucket !== 'week') return false;
      const date = todoDeadline(todo);
      return date ? dateInRange(date, week.days[0], week.days[week.days.length - 1]) : false;
    });
  };

  const todosForMonth = (monthIndex: number) =>
    activeTodos.filter((todo) => {
      if (todo.bucket !== 'month') return false;
      const date = todoDeadline(todo);
      return date ? date.getFullYear() === PLANNER_YEAR && date.getMonth() === monthIndex : false;
    });

  const todosForQuarter = (quarter: number) =>
    activeTodos.filter((todo) => {
      if (todo.bucket !== 'quarter') return false;
      const date = todoDeadline(todo);
      return date
        ? date.getFullYear() === PLANNER_YEAR && date.getMonth() >= quarter * 3 && date.getMonth() <= quarter * 3 + 2
        : false;
    });

  const yearTodos = useMemo(
    () =>
      activeTodos.filter((todo) => {
        if (todo.bucket !== 'year') return false;
        const date = todoDeadline(todo);
        return date ? date.getFullYear() === PLANNER_YEAR : true;
      }),
    [activeTodos],
  );

  const dayTodos = (day: Date) =>
    activeTodos.filter((todo) => {
      if (todo.bucket !== 'today') return false;
      const date = parseDate(todo.scheduledAt) ?? parseDate(todo.deadline);
      return date ? date.toDateString() === day.toDateString() : false;
    });

  useEffect(() => {
    const onJump = (event: Event) => {
      const detail = (event as CustomEvent<{ month?: number; weekIndex?: number }>).detail;
      if (typeof detail?.month === 'number') setMonth(detail.month);
      if (mode === 'week' && typeof detail?.weekIndex === 'number') {
        setHighlightedWeek(detail.weekIndex);
        if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
        highlightTimer.current = window.setTimeout(() => setHighlightedWeek(null), 2400);
      }
    };
    window.addEventListener(PLANNER_JUMP_EVENT, onJump);
    return () => {
      window.removeEventListener(PLANNER_JUMP_EVENT, onJump);
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    };
  }, [mode]);

  function openAdd(bucket: BroadTaskBucket, targetMonth?: number, weekIndex?: number, quarter?: number) {
    setAddTarget({ bucket, month: targetMonth, weekIndex, quarter });
    setTitle('');
    setNotes('');
  }

  function openAddDay(day: Date) {
    setAddTarget({ bucket: 'day', day });
    setTitle('');
    setNotes('');
  }

  function jumpToWeek(targetMonth: number, targetWeekIndex?: number) {
    setWorkspaceView('week');
    window.dispatchEvent(new CustomEvent(PLANNER_JUMP_EVENT, { detail: { month: targetMonth, weekIndex: targetWeekIndex } }));
  }

  async function addTask() {
    if (!addTarget) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    const createdAt = new Date().toISOString();
    const targetMonth = 'month' in addTarget ? addTarget.month ?? 0 : 0;
    const targetWeekIndex = 'weekIndex' in addTarget ? addTarget.weekIndex : undefined;
    const targetWeek = targetWeekIndex
      ? getMonthWeeks(PLANNER_YEAR, targetMonth).find((week) => week.index === targetWeekIndex)
      : null;
    const deadline =
      addTarget.bucket === 'day'
        ? endOfDay(addTarget.day).toISOString()
        : addTarget.bucket === 'week' && targetWeek
        ? endOfDay(targetWeek.days[targetWeek.days.length - 1]).toISOString()
        : addTarget.bucket === 'quarter'
          ? endOfQuarter(addTarget.quarter ?? 0).toISOString()
        : addTarget.bucket === 'month'
          ? endOfMonth(PLANNER_YEAR, targetMonth).toISOString()
          : endOfDay(new Date(PLANNER_YEAR, 11, 31)).toISOString();
    const todo: TodoItem = {
      id: uid(),
      title: cleanTitle,
      notes: notes.trim() || undefined,
      bucket: addTarget.bucket === 'day' ? 'today' : addTarget.bucket,
      deadline,
      done: false,
      dimensionValues: {},
      createdAt,
      updatedAt: createdAt,
    };
    await persist({ ...store, todos: [todo, ...store.todos], updatedAt: createdAt });
    setAddTarget(null);
  }

  async function moveToDay(day: Date) {
    if (!draggedId) return;
    await updateTodo(draggedId, (todo) => ({
      ...todo,
      bucket: 'today',
      done: false,
      deadline: endOfDay(day).toISOString(),
      scheduledAt: undefined,
    }));
    setDraggedId(null);
  }

  async function moveToWeek(targetMonth: number, weekIndex: number) {
    if (!draggedId) return;
    const week = getMonthWeeks(PLANNER_YEAR, targetMonth).find((item) => item.index === weekIndex);
    if (!week) return;
    await updateTodo(draggedId, (todo) => ({
      ...todo,
      bucket: 'week',
      done: false,
      deadline: endOfDay(week.days[week.days.length - 1]).toISOString(),
      scheduledAt: undefined,
    }));
    setDraggedId(null);
  }

  async function moveToMonth(targetMonth: number) {
    if (!draggedId) return;
    await updateTodo(draggedId, (todo) => ({
      ...todo,
      bucket: 'month',
      done: false,
      deadline: endOfMonth(PLANNER_YEAR, targetMonth).toISOString(),
      scheduledAt: undefined,
    }));
    setDraggedId(null);
  }

  async function moveToQuarter(targetQuarter: number) {
    if (!draggedId) return;
    await updateTodo(draggedId, (todo) => ({
      ...todo,
      bucket: 'quarter',
      done: false,
      deadline: endOfQuarter(targetQuarter).toISOString(),
      scheduledAt: undefined,
    }));
    setDraggedId(null);
  }

  async function moveToYear() {
    if (!draggedId) return;
    await updateTodo(draggedId, (todo) => ({
      ...todo,
      bucket: 'year',
      done: false,
      deadline: endOfDay(new Date(PLANNER_YEAR, 11, 31)).toISOString(),
      scheduledAt: undefined,
    }));
    setDraggedId(null);
  }

  if (!loaded) return <section className="panel">Loading your planner...</section>;

  return (
    <div className={`board-wrap planner-shell ${draggedId ? 'is-dragging' : ''}`}>
      <section className="panel planner-panel">
        <div className="planner-toolbar">
          <div className="planner-tabs-inline" aria-label="Planner months">
            {MONTH_SHORT_NAMES.map((name, index) => (
              <button
                key={name}
                type="button"
                className={`planner-chip ${monthLengthClass(index)} ${month === index ? 'is-active' : ''}`}
                onClick={() => setMonth(index)}
              >
                {name}
              </button>
            ))}
          </div>
          <span className="section-chip">{mode === 'week' ? 'Drag week tasks to a day' : 'Drag month tasks to a week'}</span>
        </div>

        {mode === 'week' ? (
          <div className="planner-week-grid">
            {weeks.map((week) => (
              <section
                key={week.index}
                className={`planner-week-card ${highlightedWeek === week.index ? 'is-highlighted' : ''}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void moveToWeek(month, week.index);
                }}
              >
                <button type="button" className="planner-card-title" onClick={() => openAdd('week', month, week.index)}>
                  week{week.index}
                </button>
                <div
                  className="planner-bubble-row planner-week-level-drop"
                  aria-label={`week${week.index} broad tasks`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void moveToWeek(month, week.index);
                  }}
                >
                  {todosForWeek(week.index).map((todo) => (
                    <PlannerTaskBubble
                      key={todo.id}
                      todo={todo}
                      type="week"
                      onDragStart={() => setDraggedId(todo.id)}
                      onDragEnd={() => setDraggedId(null)}
                      onDelete={() => void deleteTodo(todo.id)}
                    />
                  ))}
                </div>
                <div className="planner-day-stack">
                  {week.days.map((day) => (
                    <div
                      key={day.toISOString()}
                      className={`planner-day-drop ${day.getMonth() !== month ? 'is-outside-month' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openAddDay(day)}
                      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openAddDay(day);
                        }
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void moveToDay(day);
                      }}
                    >
                      <span>{day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</span>
                      <div className="planner-day-bubbles">
                        {dayTodos(day).map((todo) => (
                          <PlannerTaskBubble
                            key={todo.id}
                            todo={todo}
                            type="day"
                            onDragStart={() => setDraggedId(todo.id)}
                            onDragEnd={() => setDraggedId(null)}
                            onDelete={() => void deleteTodo(todo.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <>
          <section
            className="planner-year-band"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void moveToYear();
            }}
          >
            <button type="button" className="planner-year-add" onClick={() => openAdd('year')}>
              + 2026 task
            </button>
            <div className="planner-bubble-row" aria-label="2026 broad tasks">
              {yearTodos.map((todo) => (
                <PlannerTaskBubble
                  key={todo.id}
                  todo={todo}
                  type="year"
                  onDragStart={() => setDraggedId(todo.id)}
                  onDragEnd={() => setDraggedId(null)}
                  onDelete={() => void deleteTodo(todo.id)}
                />
              ))}
            </div>
          </section>
          <div className="planner-quarter-grid">
            {[0, 1, 2, 3].map((quarter) => (
              <section
                key={quarter}
                className="planner-quarter-card"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void moveToQuarter(quarter);
                }}
              >
                <div
                  className="planner-label-wrap planner-quarter-title-wrap"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void moveToQuarter(quarter);
                  }}
                >
                  <button type="button" className="planner-card-title" onClick={() => openAdd('quarter', undefined, undefined, quarter)}>
                    quarter{quarter + 1}
                  </button>
                </div>
                <div className="planner-bubble-row planner-quarter-level-drop" aria-label={`quarter${quarter + 1} broad tasks`}>
                  {todosForQuarter(quarter).map((todo) => (
                    <PlannerTaskBubble
                      key={todo.id}
                      todo={todo}
                      type="quarter"
                      onDragStart={() => setDraggedId(todo.id)}
                      onDragEnd={() => setDraggedId(null)}
                      onDelete={() => void deleteTodo(todo.id)}
                    />
                  ))}
                </div>
                <div className="planner-month-column">
                  {[0, 1, 2].map((offset) => {
                    const monthIndex = quarter * 3 + offset;
                    return (
                      <article
                        key={monthIndex}
                        className={`planner-month-card ${monthLengthClass(monthIndex)}`}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void moveToMonth(monthIndex);
                        }}
                      >
                        <div className="planner-label-wrap">
                          <button type="button" className="planner-card-title" onClick={() => openAdd('month', monthIndex)}>
                            {MONTH_SHORT_NAMES[monthIndex].toLowerCase()}
                          </button>
                          <span className="planner-label-actions">
                            <button type="button" onClick={() => jumpToWeek(monthIndex)}>view</button>
                          </span>
                        </div>
                        <div className="planner-bubble-row" aria-label={`${MONTH_NAMES[monthIndex]} broad tasks`}>
                          {todosForMonth(monthIndex).map((todo) => (
                            <PlannerTaskBubble
                              key={todo.id}
                              todo={todo}
                              type="month"
                              onDragStart={() => setDraggedId(todo.id)}
                              onDragEnd={() => setDraggedId(null)}
                              onDelete={() => void deleteTodo(todo.id)}
                            />
                          ))}
                        </div>
                        <div className="planner-week-drop-row">
                          {getMonthWeeks(PLANNER_YEAR, monthIndex).map((week) => (
                            <span key={week.index} className="planner-week-label-wrap">
                            <button
                              type="button"
                              className="planner-week-drop"
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void moveToWeek(monthIndex, week.index);
                              }}
                              onClick={() => openAdd('week', monthIndex, week.index)}
                            >
                              w{week.index}
                            </button>
                            <span className="planner-label-actions">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  jumpToWeek(monthIndex, week.index);
                                }}
                              >
                                view
                              </button>
                            </span>
                            </span>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          </>
        )}
      </section>

      {addTarget ? (
        <div
          className="confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAddTarget(null);
          }}
        >
          <section className="confirm-dialog planner-add-dialog" role="dialog" aria-modal="true" aria-labelledby="planner-add-title">
            <span className="section-eyebrow">
              {addTarget.bucket === 'day'
                ? 'Day Task'
                : addTarget.bucket === 'week'
                  ? 'Weekly Task'
                  : addTarget.bucket === 'month'
                    ? 'Monthly Task'
                    : addTarget.bucket === 'quarter'
                      ? 'Quarter Task'
                      : 'Year Task'}
            </span>
            <h3 id="planner-add-title">
              Add to {addTarget.bucket === 'day'
                ? addTarget.day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
                : addTarget.bucket === 'year'
                  ? PLANNER_YEAR
                  : addTarget.bucket === 'quarter'
                    ? `quarter${(addTarget.quarter ?? 0) + 1}`
                    : addTarget.weekIndex
                      ? `week${addTarget.weekIndex}`
                      : MONTH_NAMES[addTarget.month ?? 0]}
            </h3>
            <input placeholder="Task title" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
            <textarea placeholder="Notes (optional)" value={notes} onChange={(event) => setNotes(event.target.value)} />
            <div className="confirm-actions">
              <button type="button" className="btn-ghost" onClick={() => setAddTarget(null)}>Cancel</button>
              <button type="button" className="btn-3d" onClick={() => void addTask()}>Add Task</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
