'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TodoAttachment, TodoItem } from '@/types/todo';
import { MONTH_NAMES, endOfDay, getMonthWeeks, parseDate, startOfLocalDay, toDateKey } from '@/lib/planner-date';
import { uploadTodoAttachment } from '@/lib/attachments-client';
import { useTodoStore } from './useTodoStore';

type ChatMessage = { role: 'user' | 'assistant'; text: string };

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function formatLong(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function sortedTodos(todos: TodoItem[]) {
  return [...todos]
    .filter((todo) => !todo.done && todo.bucket !== 'completed')
    .sort((a, b) => {
      const at = Date.parse(a.deadline ?? a.scheduledAt ?? a.createdAt);
      const bt = Date.parse(b.deadline ?? b.scheduledAt ?? b.createdAt);
      return (Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER) - (Number.isFinite(bt) ? bt : Number.MAX_SAFE_INTEGER);
    });
}

function attachmentPreview(attachments: TodoAttachment[] | undefined) {
  if (!attachments?.length) return null;
  return (
    <div className="task-attachments">
      {attachments.map((attachment) => (
        <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="task-attachment">
          <img src={attachment.url} alt={attachment.name} />
        </a>
      ))}
    </div>
  );
}

interface CalendarPickerProps {
  selected: Date;
  onSelect: (date: Date) => void;
  minDate: Date;
}

function CalendarPicker({ selected, onSelect, minDate }: CalendarPickerProps) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth());
  const wrapRef = useRef<HTMLDivElement>(null);
  const minKey = toDateKey(minDate);
  const selectedKey = toDateKey(selected);
  const todayKey = toDateKey(new Date());

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const weeks = useMemo(() => getMonthWeeks(viewYear, viewMonth), [viewYear, viewMonth]);

  function shift(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  return (
    <div className="ashi-cal" ref={wrapRef}>
      <button type="button" className="ashi-cal-trigger" onClick={() => setOpen((value) => !value)}>
        <span className="ashi-cal-trigger-label">Due date</span>
        <span className="ashi-cal-trigger-value">{formatLong(selected)}</span>
        <span className="ashi-cal-trigger-chevron" aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="ashi-cal-pop" role="dialog" aria-label="Pick a date">
          <div className="ashi-cal-head">
            <button type="button" className="ashi-cal-nav" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
            <span className="ashi-cal-month">{MONTH_NAMES[viewMonth]} {viewYear}</span>
            <button type="button" className="ashi-cal-nav" onClick={() => shift(1)} aria-label="Next month">›</button>
          </div>
          <div className="ashi-cal-weekdays">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="ashi-cal-grid">
            {weeks.map((week) =>
              week.days.map((day) => {
                const key = toDateKey(day);
                const inMonth = day.getMonth() === viewMonth;
                const disabled = key < minKey;
                const isSelected = key === selectedKey;
                const isToday = key === todayKey;
                return (
                  <button
                    type="button"
                    key={key}
                    disabled={disabled}
                    className={`ashi-cal-day${inMonth ? '' : ' is-out'}${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
                    onClick={() => {
                      onSelect(startOfLocalDay(day));
                      setOpen(false);
                    }}
                  >
                    {day.getDate()}
                  </button>
                );
              }),
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AshiPage() {
  const { store, loaded, persist, updateTodo, deleteTodo } = useTodoStore();
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState<Date>(today);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [status, setStatus] = useState('');
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);

  const tasks = useMemo(() => sortedTodos(store.todos), [store.todos]);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview('');
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  async function addTask() {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    if (startOfLocalDay(date).getTime() < today.getTime()) {
      setStatus('Pick today or later.');
      return;
    }
    setStatus('');
    try {
      const attachments = imageFile ? [await uploadTodoAttachment(imageFile)] : undefined;
      const now = new Date().toISOString();
      const todo: TodoItem = {
        id: uid(),
        title: cleanTitle,
        bucket: 'today',
        deadline: endOfDay(date).toISOString(),
        done: false,
        attachments,
        dimensionValues: {},
        createdAt: now,
        updatedAt: now,
      };
      await persist({ ...store, todos: [todo, ...store.todos], updatedAt: now });
      setTitle('');
      setImageFile(null);
      setStatus('Added.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Add failed.');
    }
  }

  async function askAshi() {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || asking) return;
    setQuestion('');
    setAsking(true);
    setChat((prev) => [...prev, { role: 'user', text: cleanQuestion }]);
    try {
      const response = await fetch('/api/ashi/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: cleanQuestion, todos: store.todos }),
      });
      const data = (await response.json()) as { answer?: string; error?: string };
      setChat((prev) => [...prev, { role: 'assistant', text: data.answer || data.error || 'No answer.' }]);
    } catch {
      setChat((prev) => [...prev, { role: 'assistant', text: 'Chat failed.' }]);
    } finally {
      setAsking(false);
    }
  }

  if (!loaded) return <section className="panel">Loading Ashi...</section>;

  return (
    <div className="board-wrap ashi-shell">
      <section className="panel ashi-panel">
        <div className="ashi-create">
          <input
            className="ashi-task-input"
            placeholder="describe your task"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <CalendarPicker selected={date} onSelect={setDate} minDate={today} />
          <label className={`ashi-image-pick${imagePreview ? ' has-image' : ''}`}>
            {imagePreview ? (
              <span className="ashi-image-thumb">
                <img src={imagePreview} alt="preview" />
                <span className="ashi-image-name">{imageFile?.name}</span>
              </span>
            ) : (
              <>
                <span className="ashi-image-icon" aria-hidden>+</span>
                <span className="ashi-image-title">Attach image</span>
                <span className="ashi-image-hint">PNG, JPG up to a few MB</span>
              </>
            )}
            <input type="file" accept="image/*" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} />
          </label>
          {imagePreview ? (
            <button type="button" className="ashi-image-clear" onClick={() => setImageFile(null)}>
              Remove image
            </button>
          ) : null}
          <button type="button" className="btn-3d ashi-add-btn" onClick={() => void addTask()}>
            add task
          </button>
        </div>
        {status ? <p className="ashi-status">{status}</p> : null}
        <div className="ashi-list">
          <span className="ashi-list-title">Upcoming tasks</span>
          {tasks.length === 0 ? <p className="ashi-empty">No tasks yet — add one above.</p> : null}
          {tasks.map((todo) => {
            const due = parseDate(todo.deadline ?? todo.scheduledAt);
            return (
              <article key={todo.id} className="ashi-task-row">
                <div className="ashi-task-main">
                  <strong>{todo.title}</strong>
                  {due ? <span>{due.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span> : null}
                  {attachmentPreview(todo.attachments)}
                </div>
                <div className="ashi-task-actions">
                  <button
                    type="button"
                    className="ashi-task-btn is-complete"
                    onClick={() => {
                      if (!window.confirm(`Mark "${todo.title}" as complete?`)) return;
                      void updateTodo(todo.id, (item) => ({ ...item, done: true, bucket: 'completed' }));
                    }}
                    aria-label="Mark complete"
                    title="Mark complete"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="ashi-task-btn is-delete"
                    onClick={() => {
                      if (!window.confirm(`Delete "${todo.title}"? This cannot be undone.`)) return;
                      void deleteTodo(todo.id);
                    }}
                    aria-label="Delete task"
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel ashi-chat-panel">
        <div className="panel-head">
          <div>
            <span className="section-eyebrow">Ashi Chat</span>
            <h2>Ask tasks</h2>
          </div>
        </div>
        <div className="ashi-chat-log">
          {chat.length === 0 ? <p>Ask: indu se kya kaam hai, monday ko kya hai, gajnan se kya lena hai.</p> : null}
          {chat.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`ashi-chat-msg is-${message.role}`}>
              {message.text}
            </div>
          ))}
        </div>
        <div className="ashi-chat-box">
          <input
            placeholder="Ask about tasks..."
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void askAshi();
            }}
          />
          <button type="button" className="btn-3d" onClick={() => void askAshi()} disabled={asking}>
            {asking ? '...' : 'Ask'}
          </button>
        </div>
      </section>
    </div>
  );
}
