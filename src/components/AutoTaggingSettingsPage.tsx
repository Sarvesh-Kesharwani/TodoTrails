'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  DEFAULT_ASHI_BASE_PROMPT,
  type AshiCategory,
  type AshiCategoryLayer,
  type TagRule,
  type TagRulesStore,
  type TodoItem,
} from '@/types/todo';
import { buildAutoTagPrompt, getRelevantTagRules } from '@/lib/tag-rules';
import { useTodoStore } from './useTodoStore';

type PlaygroundResult = {
  matchedRules: Record<string, TagRule>;
  hierarchy: Record<string, string[]>;
  finalPrompt: string;
  assignment?: {
    taskTags: string[];
    moveToNextDay: boolean;
    reason?: string;
  };
  error?: string;
};

type ImportExportPayload = {
  basePrompt?: string;
  categories?: AshiCategory[];
  tagRules?: TagRulesStore;
};

const EMPTY_RULES: TagRulesStore = { tags: {}, hierarchy: {} };

function tagKey(value: string) {
  return value.trim().toLowerCase();
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function lines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function textFromList(items: string[] | undefined) {
  return (items ?? []).join('\n');
}

function ruleFor(tag: string, rules: TagRulesStore): TagRule {
  return (
    rules.tags[tagKey(tag)] ?? {
      description: '',
      triggers: [],
      parent_tags: [],
      move_default: 'unclear',
      examples: [],
      priority: 0,
      active: true,
    }
  );
}

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function hasPath(hierarchy: Record<string, string[]>, start: string, target: string) {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    if (current === target) return true;
    seen.add(current);
    stack.push(...(hierarchy[current] ?? []).map(tagKey));
  }
  return false;
}

function wouldCreateCycle(hierarchy: Record<string, string[]>, child: string, parent: string) {
  return child === parent || hasPath(hierarchy, parent, child);
}

function cleanRules(raw: TagRulesStore | undefined): TagRulesStore {
  return raw ?? EMPTY_RULES;
}

export function AutoTaggingSettingsPage() {
  const { store, loaded, persist } = useTodoStore();
  const [selectedTag, setSelectedTag] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagLayer, setNewTagLayer] = useState<AshiCategoryLayer>('specific');
  const [childTag, setChildTag] = useState('');
  const [parentTag, setParentTag] = useState('');
  const [basePromptDraft, setBasePromptDraft] = useState('');
  const [playgroundTodo, setPlaygroundTodo] = useState('');
  const [playgroundResult, setPlaygroundResult] = useState<PlaygroundResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [backupDraft, setBackupDraft] = useState('');
  const [status, setStatus] = useState('');

  const tagRules = cleanRules(store.ashiSettings.tagRules);
  const basePrompt = store.ashiSettings.basePrompt ?? DEFAULT_ASHI_BASE_PROMPT;
  const enabledCategories = useMemo(() => store.ashiSettings.categories.filter((category) => !category.disabled), [store.ashiSettings.categories]);
  const allTagNames = useMemo(
    () =>
      Array.from(
        new Set([
          ...store.ashiSettings.categories.map((category) => category.name),
          ...Object.keys(tagRules.tags),
          ...Object.keys(tagRules.hierarchy),
        ]),
      ).sort((a, b) => a.localeCompare(b)),
    [store.ashiSettings.categories, tagRules],
  );
  const activeSelectedTag = selectedTag || allTagNames[0] || '';
  const selectedRule = activeSelectedTag ? ruleFor(activeSelectedTag, tagRules) : null;

  async function save(next: Partial<{ categories: AshiCategory[]; tagRules: TagRulesStore; basePrompt: string }>, message: string) {
    const now = new Date().toISOString();
    await persist({
      ...store,
      ashiSettings: {
        ...store.ashiSettings,
        categories: next.categories ?? store.ashiSettings.categories,
        tagRules: next.tagRules ?? store.ashiSettings.tagRules ?? EMPTY_RULES,
        basePrompt: next.basePrompt ?? store.ashiSettings.basePrompt ?? DEFAULT_ASHI_BASE_PROMPT,
      },
      updatedAt: now,
    });
    setStatus(message);
  }

  async function addTag() {
    const name = newTagName.trim();
    if (!name) return;
    if (store.ashiSettings.categories.some((category) => tagKey(category.name) === tagKey(name))) {
      setStatus('Tag already exists.');
      return;
    }
    const now = new Date().toISOString();
    await save(
      {
        categories: [
          ...store.ashiSettings.categories,
          { id: `ashi-cat-${tagKey(name).replace(/[^a-z0-9]+/g, '-') || 'tag'}-${uid()}`, name, layer: newTagLayer, createdAt: now },
        ],
        tagRules: {
          ...tagRules,
          tags: {
            ...tagRules.tags,
            [tagKey(name)]: ruleFor(name, tagRules),
          },
        },
      },
      `Added tag "${name}".`,
    );
    setSelectedTag(name);
    setNewTagName('');
  }

  async function updateTag(category: AshiCategory, patch: Partial<AshiCategory>) {
    const renamed = typeof patch.name === 'string' && tagKey(patch.name) && tagKey(patch.name) !== tagKey(category.name);
    if (renamed) {
      const oldKey = tagKey(category.name);
      const newName = patch.name!.trim();
      const newKey = tagKey(newName);
      const nextTags = { ...tagRules.tags };
      if (nextTags[oldKey]) {
        nextTags[newKey] = nextTags[oldKey];
        delete nextTags[oldKey];
      }
      const nextHierarchy: Record<string, string[]> = {};
      for (const [child, parents] of Object.entries(tagRules.hierarchy)) {
        const nextChild = child === oldKey ? newKey : child;
        nextHierarchy[nextChild] = parents.map((parent) => (parent === oldKey ? newKey : parent));
      }
      const nextTodos = store.todos.map((todo) => ({
        ...todo,
        ashiTags: todo.ashiTags?.map((tag) => (tagKey(tag) === oldKey ? newName : tag)),
        ashiTaskJson: todo.ashiTaskJson
          ? {
              ...todo.ashiTaskJson,
              taskCategory: tagKey(todo.ashiTaskJson.taskCategory) === oldKey ? newName : todo.ashiTaskJson.taskCategory,
              taskTags: todo.ashiTaskJson.taskTags.map((tag) => (tagKey(tag) === oldKey ? newName : tag)),
            }
          : undefined,
      }));
      const now = new Date().toISOString();
      await persist({
        ...store,
        todos: nextTodos,
        ashiSettings: {
          ...store.ashiSettings,
          categories: store.ashiSettings.categories.map((item) => (item.id === category.id ? { ...item, ...patch, name: newName } : item)),
          tagRules: { tags: nextTags, hierarchy: nextHierarchy },
        },
        updatedAt: now,
      });
      setSelectedTag(newName);
      setStatus(`Renamed "${category.name}" to "${newName}".`);
      return;
    }

    const key = tagKey(category.name);
    const nextRule =
      typeof patch.disabled === 'boolean'
        ? { ...ruleFor(category.name, tagRules), active: !patch.disabled }
        : tagRules.tags[key];
    await save(
      {
        categories: store.ashiSettings.categories.map((item) => (item.id === category.id ? { ...item, ...patch } : item)),
        tagRules: nextRule
          ? {
              ...tagRules,
              tags: {
                ...tagRules.tags,
                [key]: nextRule,
              },
            }
          : tagRules,
      },
      `Updated "${category.name}".`,
    );
  }

  async function deleteTag(category: AshiCategory) {
    if (!window.confirm(`Delete tag "${category.name}"? Existing todos lose this tag.`)) return;
    const key = tagKey(category.name);
    const nextTags = { ...tagRules.tags };
    delete nextTags[key];
    const nextHierarchy = Object.fromEntries(
      Object.entries(tagRules.hierarchy)
        .filter(([child]) => child !== key)
        .map(([child, parents]) => [child, parents.filter((parent) => parent !== key)]),
    );
    const nextTodos = store.todos.map((todo) => ({
      ...todo,
      ashiCategoryId: todo.ashiCategoryId === category.id ? undefined : todo.ashiCategoryId,
      ashiTags: todo.ashiTags?.filter((tag) => tagKey(tag) !== key),
      ashiTaskJson: todo.ashiTaskJson
        ? { ...todo.ashiTaskJson, taskTags: todo.ashiTaskJson.taskTags.filter((tag) => tagKey(tag) !== key) }
        : undefined,
    }));
    const now = new Date().toISOString();
    await persist({
      ...store,
      todos: nextTodos,
      ashiSettings: {
        ...store.ashiSettings,
        categories: store.ashiSettings.categories.filter((item) => item.id !== category.id),
        tagRules: { tags: nextTags, hierarchy: nextHierarchy },
      },
      updatedAt: now,
    });
    if (tagKey(activeSelectedTag) === key) setSelectedTag('');
    setStatus(`Deleted "${category.name}".`);
  }

  async function updateRule(tag: string, patch: Partial<TagRule>) {
    const key = tagKey(tag);
    const current = ruleFor(tag, tagRules);
    await save(
      {
        tagRules: {
          ...tagRules,
          tags: {
            ...tagRules.tags,
            [key]: { ...current, ...patch },
          },
        },
      },
      `Saved rules for "${tag}".`,
    );
  }

  async function addHierarchy() {
    const child = tagKey(childTag);
    const parent = tagKey(parentTag);
    if (!child || !parent) return;
    if (wouldCreateCycle(tagRules.hierarchy, child, parent)) {
      setStatus('Cannot add hierarchy because it creates a circular parent-child loop.');
      return;
    }
    const parents = Array.from(new Set([...(tagRules.hierarchy[child] ?? []), parent]));
    await save(
      {
        tagRules: {
          ...tagRules,
          hierarchy: { ...tagRules.hierarchy, [child]: parents },
          tags: {
            ...tagRules.tags,
            [child]: { ...ruleFor(child, tagRules), parent_tags: parents },
          },
        },
      },
      `Added hierarchy ${child} -> ${parent}.`,
    );
  }

  async function removeHierarchy(child: string, parent: string) {
    const nextParents = (tagRules.hierarchy[child] ?? []).filter((item) => item !== parent);
    const nextHierarchy = { ...tagRules.hierarchy, [child]: nextParents };
    if (!nextParents.length) delete nextHierarchy[child];
    await save(
      {
        tagRules: {
          ...tagRules,
          hierarchy: nextHierarchy,
          tags: {
            ...tagRules.tags,
            [child]: { ...ruleFor(child, tagRules), parent_tags: nextParents },
          },
        },
      },
      `Removed ${child} -> ${parent}.`,
    );
  }

  async function saveBasePrompt() {
    const clean = (basePromptDraft || basePrompt).trim();
    if (!clean) {
      setStatus('Base prompt cannot be empty.');
      return;
    }
    await save({ basePrompt: clean }, 'Base prompt saved.');
  }

  async function runPlayground() {
    const text = playgroundTodo.trim();
    if (!text) return;
    setTesting(true);
    setPlaygroundResult(null);
    const relevant = getRelevantTagRules(text, tagRules, enabledCategories);
    const finalPrompt = buildAutoTagPrompt(text, relevant.rules, relevant.hierarchy, basePrompt);
    try {
      const now = new Date().toISOString();
      const todo: TodoItem = {
        id: `playground-${uid()}`,
        title: text,
        bucket: 'today',
        done: false,
        dimensionValues: {},
        createdAt: now,
        updatedAt: now,
      };
      const response = await fetch('/api/ashi/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          todos: [todo],
          categories: enabledCategories,
          tagRules,
          basePrompt,
          rulesPrompt: store.ashiSettings.rulesPrompt,
        }),
      });
      const data = (await response.json()) as { assignments?: PlaygroundResult['assignment'][]; error?: string };
      setPlaygroundResult({
        matchedRules: relevant.rules,
        hierarchy: relevant.hierarchy,
        finalPrompt,
        assignment: data.assignments?.[0],
        error: response.ok ? undefined : data.error || 'Playground request failed.',
      });
    } catch (error) {
      setPlaygroundResult({
        matchedRules: relevant.rules,
        hierarchy: relevant.hierarchy,
        finalPrompt,
        error: error instanceof Error ? error.message : 'Playground failed.',
      });
    } finally {
      setTesting(false);
    }
  }

  function exportConfig() {
    const content = JSON.stringify(
      {
        basePrompt,
        categories: store.ashiSettings.categories,
        tagRules,
      },
      null,
      2,
    );
    setBackupDraft(content);
    downloadFile('todotrails-auto-tagging-config.json', content);
  }

  async function importConfig() {
    try {
      const parsed = JSON.parse(backupDraft) as ImportExportPayload;
      await save(
        {
          categories: Array.isArray(parsed.categories) ? parsed.categories : store.ashiSettings.categories,
          tagRules: parsed.tagRules ?? tagRules,
          basePrompt: typeof parsed.basePrompt === 'string' ? parsed.basePrompt : basePrompt,
        },
        'Auto-tagging config imported.',
      );
    } catch {
      setStatus('Import JSON is invalid.');
    }
  }

  if (!loaded) return <section className="panel">Loading auto-tagging settings...</section>;

  return (
    <div className="board-wrap auto-tagging-page">
      <section className="panel settings-panel settings-page-panel">
        <div className="panel-head">
          <div>
            <span className="section-eyebrow">Settings</span>
            <h1 className="settings-title">Auto-Tagging Settings</h1>
          </div>
          <Link href="/settings" className="btn-ghost">Board settings</Link>
        </div>
        {status ? <p className="ashi-status">{status}</p> : null}

        <div className="auto-tagging-grid">
          <section className="settings-card auto-settings-section">
            <div className="panel-head">
              <div>
                <span className="section-eyebrow">1. Tags</span>
                <h2>Tag Library</h2>
              </div>
            </div>
            <div className="auto-add-row">
              <input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="New tag name" />
              <select value={newTagLayer} onChange={(event) => setNewTagLayer(event.target.value as AshiCategoryLayer)}>
                <option value="generic">Generic</option>
                <option value="specific">Specific</option>
              </select>
              <button type="button" className="btn-3d" onClick={() => void addTag()}>Add tag</button>
            </div>
            <div className="auto-tag-list">
              {store.ashiSettings.categories.map((category) => (
                <article key={category.id} className={`auto-tag-row${category.disabled ? ' is-disabled' : ''}`}>
                  <input
                    defaultValue={category.name}
                    onBlur={(event) => {
                      const next = event.target.value.trim();
                      if (next && next !== category.name) void updateTag(category, { name: next });
                    }}
                  />
                  <input defaultValue={category.description ?? ''} onBlur={(event) => void updateTag(category, { description: event.target.value })} placeholder="Description" />
                  <select value={category.layer ?? 'specific'} onChange={(event) => void updateTag(category, { layer: event.target.value as AshiCategoryLayer })}>
                    <option value="generic">Generic</option>
                    <option value="specific">Specific</option>
                  </select>
                  <label className="inline-check">
                    <input type="checkbox" checked={!category.disabled} onChange={(event) => void updateTag(category, { disabled: !event.target.checked })} />
                    Active
                  </label>
                  <button type="button" className="btn-ghost" onClick={() => setSelectedTag(category.name)}>Rules</button>
                  <button type="button" className="btn-ghost" onClick={() => void deleteTag(category)}>Delete</button>
                </article>
              ))}
            </div>
          </section>

          <section className="settings-card auto-settings-section">
            <div className="panel-head">
              <div>
                <span className="section-eyebrow">2. Tag Hierarchy</span>
                <h2>Parent Tags</h2>
              </div>
            </div>
            <div className="auto-add-row">
              <select value={childTag} onChange={(event) => setChildTag(event.target.value)}>
                <option value="">Child tag</option>
                {allTagNames.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
              </select>
              <select value={parentTag} onChange={(event) => setParentTag(event.target.value)}>
                <option value="">Parent tag</option>
                {allTagNames.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
              </select>
              <button type="button" className="btn-3d" onClick={() => void addHierarchy()}>Add parent</button>
            </div>
            <div className="auto-hierarchy-list">
              {Object.entries(tagRules.hierarchy).length ? Object.entries(tagRules.hierarchy).map(([child, parents]) => (
                <article key={child} className="auto-hierarchy-row">
                  <strong>{child}</strong>
                  <span>adds</span>
                  <div className="auto-chip-row">
                    {parents.map((parent) => (
                      <button key={parent} type="button" className="ashi-tag-chip" onClick={() => void removeHierarchy(child, parent)}>
                        {parent} x
                      </button>
                    ))}
                  </div>
                </article>
              )) : <p className="ashi-empty">No hierarchy yet.</p>}
            </div>
          </section>

          <section className="settings-card auto-settings-section">
            <div className="panel-head">
              <div>
                <span className="section-eyebrow">3. Rules / Triggers</span>
                <h2>Per-Tag Rules</h2>
              </div>
              <select value={activeSelectedTag} onChange={(event) => setSelectedTag(event.target.value)}>
                {allTagNames.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
              </select>
            </div>
            {selectedRule && activeSelectedTag ? (
              <div className="auto-rule-editor">
                <label>Description<input key={`${activeSelectedTag}-description`} defaultValue={selectedRule.description} onBlur={(event) => void updateRule(activeSelectedTag, { description: event.target.value })} /></label>
                <label>Trigger words<textarea key={`${activeSelectedTag}-triggers`} defaultValue={textFromList(selectedRule.triggers)} onBlur={(event) => void updateRule(activeSelectedTag, { triggers: lines(event.target.value) })} /></label>
                <label>Examples<textarea key={`${activeSelectedTag}-examples`} defaultValue={textFromList(selectedRule.examples)} onBlur={(event) => void updateRule(activeSelectedTag, { examples: lines(event.target.value).slice(0, 5) })} /></label>
                <div className="auto-rule-controls">
                  <label>Move default
                    <select value={selectedRule.move_default} onChange={(event) => void updateRule(activeSelectedTag, { move_default: event.target.value as TagRule['move_default'] })}>
                      <option value="unclear">Unclear</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                  <label>Priority<input type="number" value={selectedRule.priority ?? 0} onChange={(event) => void updateRule(activeSelectedTag, { priority: Number(event.target.value) || 0 })} /></label>
                  <label className="inline-check"><input type="checkbox" checked={selectedRule.active !== false} onChange={(event) => void updateRule(activeSelectedTag, { active: event.target.checked })} />Active</label>
                </div>
              </div>
            ) : <p className="ashi-empty">Add a tag first.</p>}
          </section>

          <section className="settings-card auto-settings-section">
            <div className="panel-head">
              <div>
                <span className="section-eyebrow">4. Base Prompt</span>
                <h2>Runtime Instruction</h2>
              </div>
              <button type="button" className="btn-ghost" onClick={() => setBasePromptDraft(basePrompt)}>Load current</button>
            </div>
            <textarea className="auto-large-textarea" value={basePromptDraft || basePrompt} onChange={(event) => setBasePromptDraft(event.target.value)} />
            <div className="ashi-rules-actions">
              <button type="button" className="btn-ghost" onClick={() => setBasePromptDraft(DEFAULT_ASHI_BASE_PROMPT)}>Default</button>
              <button type="button" className="btn-3d" onClick={() => void saveBasePrompt()}>Save base prompt</button>
            </div>
          </section>

          <section className="settings-card auto-settings-section">
            <div className="panel-head">
              <div>
                <span className="section-eyebrow">5. Test Playground</span>
                <h2>Preview Tagging</h2>
              </div>
            </div>
            <div className="auto-add-row">
              <input value={playgroundTodo} onChange={(event) => setPlaygroundTodo(event.target.value)} placeholder="yellow panni lena" />
              <button type="button" className="btn-3d" onClick={() => void runPlayground()} disabled={testing}>{testing ? 'Testing...' : 'Test'}</button>
            </div>
            {playgroundResult ? (
              <div className="auto-playground-output">
                <div><span className="section-eyebrow">Matched rules</span><pre>{JSON.stringify(playgroundResult.matchedRules, null, 2)}</pre></div>
                <div><span className="section-eyebrow">Relevant hierarchy</span><pre>{JSON.stringify(playgroundResult.hierarchy, null, 2)}</pre></div>
                <div><span className="section-eyebrow">Generated</span><pre>{JSON.stringify(playgroundResult.assignment ?? { error: playgroundResult.error }, null, 2)}</pre></div>
                <div><span className="section-eyebrow">Final prompt</span><pre>{playgroundResult.finalPrompt}</pre></div>
              </div>
            ) : null}
          </section>

          <section className="settings-card auto-settings-section">
            <div className="panel-head">
              <div>
                <span className="section-eyebrow">6. Import / Export</span>
                <h2>Backup Config</h2>
              </div>
              <button type="button" className="btn-ghost" onClick={exportConfig}>Export JSON</button>
            </div>
            <textarea className="auto-large-textarea" value={backupDraft} onChange={(event) => setBackupDraft(event.target.value)} placeholder="Paste auto-tagging config JSON here." />
            <div className="ashi-rules-actions">
              <button type="button" className="btn-3d" onClick={() => void importConfig()}>Import JSON</button>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
