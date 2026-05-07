'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TodoAttachment, TodoItem } from '@/types/todo';
import { endOfDay, parseDate, startOfLocalDay } from '@/lib/planner-date';
import { uploadTodoAttachment } from '@/lib/attachments-client';
import { useTodoStore } from './useTodoStore';

type ChatMessage = { role: 'user' | 'assistant'; text: string };

function uid() {
  return Math.random().toString(36).slice(2, 10);
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

function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function renderStructuredText(text: string) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(<h3 key={`h-${index}`}>{renderInlineMarkdown(heading[2])}</h3>);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^[-*]\s+(.+)$/.exec(lines[index].trim());
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^\d+[.)]\s+(.+)$/.exec(lines[index].trim());
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || /^(#{1,3})\s+/.test(next) || /^[-*]\s+/.test(next) || /^\d+[.)]\s+/.test(next)) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{renderInlineMarkdown(paragraph.join(' '))}</p>);
  }

  return blocks.length ? blocks : text;
}

export function AshiPage() {
  const { store, loaded, persist, updateTodo, deleteTodo } = useTodoStore();
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const [title, setTitle] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);

  const tasks = useMemo(() => sortedTodos(store.todos), [store.todos]);

  const imagePreview = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : ''), [imageFile]);

  useEffect(() => {
    if (!imagePreview) return;
    return () => URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  async function addTask() {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    setStatus('');
    try {
      const attachments = imageFile ? [await uploadTodoAttachment(imageFile)] : undefined;
      const now = new Date().toISOString();
      const todo: TodoItem = {
        id: uid(),
        title: cleanTitle,
        bucket: 'today',
        deadline: endOfDay(today).toISOString(),
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
                    className="ashi-task-btn is-edit"
                    onClick={() => {
                      const next = window.prompt('Edit task', todo.title);
                      if (next === null) return;
                      const trimmed = next.trim();
                      if (!trimmed || trimmed === todo.title) return;
                      void updateTodo(todo.id, (item) => ({ ...item, title: trimmed }));
                    }}
                    aria-label="Edit task"
                    title="Edit"
                  >
                    ✎
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
              {renderStructuredText(message.text)}
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
