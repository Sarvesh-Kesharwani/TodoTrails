import type { TagRulesStore, TagRule, AshiCategory } from '@/types/todo';

const MAX_TRIGGERS = 15;
const MAX_EXAMPLES = 5;

export function normalizeRuleKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, '');
}

function tagStoreKey(tagName: string): string {
  return tagName.toLowerCase().trim();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u0900-\u097f]+/i)
    .filter((token) => token.length >= 3);
}

function extractTriggersFromTodo(todoText: string): string[] {
  const tokens = tokenize(todoText);
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  // Prefer longer multi-word phrases first, then single tokens
  return [...new Set([...bigrams, ...tokens])];
}

function dedupeArray(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = normalizeRuleKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
      if (result.length >= max) break;
    }
  }
  return result;
}

function matchScore(todoText: string, triggers: string[]): number {
  const text = normalizeRuleKey(todoText);
  let score = 0;
  for (const trigger of triggers) {
    const key = normalizeRuleKey(trigger);
    if (text.includes(key)) score += 1;
  }
  return score;
}

/**
 * Retrieves only relevant tag rules for a given todo text.
 * Matches against triggers and tag names, returns matched rules + hierarchy.
 */
export function getRelevantTagRules(
  todoText: string,
  tagRules: TagRulesStore,
  categories?: AshiCategory[],
): { rules: Record<string, TagRule>; hierarchy: Record<string, string[]> } {
  if (!todoText.trim() || !tagRules.tags) return { rules: {}, hierarchy: {} };

  const text = normalizeRuleKey(todoText);
  const matchedTagKeys: string[] = [];

  // Match against triggers and tag key names
  for (const [tagKey, rule] of Object.entries(tagRules.tags)) {
    const triggers = [tagKey, ...rule.triggers];
    const matched = triggers.some((trigger) => text.includes(normalizeRuleKey(trigger)));
    if (matched) {
      matchedTagKeys.push(tagKey);
    }
  }

  // Also match against category names
  if (categories) {
    for (const category of categories) {
      const catKey = normalizeRuleKey(category.name);
      if (text.includes(catKey) && !matchedTagKeys.includes(catKey)) {
        const existsInRules = tagRules.tags[catKey];
        if (existsInRules) {
          matchedTagKeys.push(catKey);
        }
      }
    }
  }

  if (!matchedTagKeys.length) return { rules: {}, hierarchy: {} };

  // Collect matched rules + parent tags
  const relevantRules: Record<string, TagRule> = {};
  const relevantHierarchy: Record<string, string[]> = {};
  const visited = new Set<string>();

  function addTag(tagKey: string) {
    if (visited.has(tagKey)) return;
    visited.add(tagKey);
    const rule = tagRules.tags[tagKey];
    if (rule) {
      relevantRules[tagKey] = rule;
      // Add parent hierarchy
      if (tagRules.hierarchy[tagKey]) {
        relevantHierarchy[tagKey] = tagRules.hierarchy[tagKey];
        for (const parentKey of tagRules.hierarchy[tagKey]) {
          addTag(parentKey);
        }
      }
    }
  }

  for (const tagKey of matchedTagKeys) {
    addTag(tagKey);
  }

  return { rules: relevantRules, hierarchy: relevantHierarchy };
}

/**
 * Updates the tagRules store from a user correction.
 * Always returns a new TagRulesStore object.
 */
export function updateTagRulesFromCorrection(
  tagRules: TagRulesStore,
  todoText: string,
  correctedTags: string[],
  moveDecision: 'yes' | 'no' | 'unclear',
  note?: string,
): TagRulesStore {
  const cleanTodo = todoText.trim();
  if (!cleanTodo || !correctedTags.length) return tagRules;

  const nextTags = { ...tagRules.tags };
  const nextHierarchy = { ...tagRules.hierarchy };
  const todoTriggers = extractTriggersFromTodo(cleanTodo);

  for (const tagName of correctedTags) {
    const tagKey = tagStoreKey(tagName);
    const existing = nextTags[tagKey];

    if (existing) {
      // Update existing rule
      const newTriggers = dedupeArray(
        [...existing.triggers, ...todoTriggers],
        MAX_TRIGGERS,
      );
      const newExamples = dedupeArray(
        [...existing.examples, cleanTodo],
        MAX_EXAMPLES,
      );
      nextTags[tagKey] = {
        ...existing,
        triggers: newTriggers,
        examples: newExamples,
        move_default: moveDecision !== 'unclear' ? moveDecision : existing.move_default,
        description: note ? note : existing.description,
      };
    } else {
      // Create new rule
      nextTags[tagKey] = {
        description: note || '',
        triggers: dedupeArray(todoTriggers, MAX_TRIGGERS),
        parent_tags: [],
        move_default: moveDecision,
        examples: [cleanTodo],
      };
    }
  }

  // Update hierarchy: each corrected tag after the first is a parent of previous tags
  // This is a simple heuristic - the user explicitly chose this hierarchy
  if (correctedTags.length > 1) {
    const normalizedTags = correctedTags.map((t) => tagStoreKey(t));
    // The last tag is the most general (parent), earlier ones are specific (children)
    for (let i = 0; i < normalizedTags.length - 1; i++) {
      const childKey = normalizedTags[i];
      const parentKeys = normalizedTags.slice(i + 1);
      if (!nextHierarchy[childKey]) {
        nextHierarchy[childKey] = [];
      }
      for (const pk of parentKeys) {
        if (!nextHierarchy[childKey].includes(pk)) {
          nextHierarchy[childKey].push(pk);
        }
      }
      // Also update the rule's parent_tags field
      if (nextTags[childKey]) {
        nextTags[childKey] = {
          ...nextTags[childKey],
          parent_tags: dedupeArray([...nextTags[childKey].parent_tags, ...parentKeys], 10),
        };
      }
    }
  }

  return { tags: nextTags, hierarchy: nextHierarchy };
}

/**
 * Compresses tag rules: removes redundant triggers, prunes excess examples.
 */
export function compressTagRules(tagRules: TagRulesStore): TagRulesStore {
  const nextTags: Record<string, TagRule> = {};

  for (const [tagKey, rule] of Object.entries(tagRules.tags)) {
    // Keep only most useful examples (shortest ones that introduce new triggers)
    const sortedExamples = [...rule.examples].sort(
      (a, b) => a.length - b.length,
    );
    const usefulExamples: string[] = [];
    const coveredTriggers = new Set<string>();

    for (const example of sortedExamples) {
      const trigs = extractTriggersFromTodo(example);
      const newTrigs = trigs.filter((t) => !coveredTriggers.has(normalizeRuleKey(t)));
      if (newTrigs.length > 0 || usefulExamples.length === 0) {
        usefulExamples.push(example);
        for (const t of trigs) coveredTriggers.add(normalizeRuleKey(t));
      }
      if (usefulExamples.length >= MAX_EXAMPLES) break;
    }

    // Merge examples into triggers where they imply the same thing
    const compactTriggers = dedupeArray(rule.triggers, MAX_TRIGGERS);

    nextTags[tagKey] = {
      ...rule,
      triggers: compactTriggers,
      examples: usefulExamples,
    };
  }

  return { tags: nextTags, hierarchy: tagRules.hierarchy };
}

/**
 * Builds a compact prompt for the LLM with only relevant rules.
 */
export function buildAutoTagPrompt(
  todoText: string,
  relevantRules: Record<string, TagRule>,
  relevantHierarchy: Record<string, string[]>,
): string {
  const rulesJson = JSON.stringify(relevantRules);
  const hierarchyJson = JSON.stringify(relevantHierarchy);

  return JSON.stringify({
    instructions:
      'Assign the most relevant tags to the todo. Use parent tags from hierarchy. Decide whether it should move to next day. Return JSON only.',
    todo: todoText,
    relevant_rules: JSON.parse(rulesJson),
    relevant_hierarchy: JSON.parse(hierarchyJson),
    response_shape: {
      taskTags: ['tag name 1', 'tag name 2'],
      moveToNextDay: true,
      reason: 'short reason',
    },
  });
}

/**
 * Scores how well a rule matches a todo, for sorting best matches first.
 */
export function scoreRuleMatch(todoText: string, rule: TagRule): number {
  const text = normalizeRuleKey(todoText);
  let score = 0;
  for (const trigger of rule.triggers) {
    if (text.includes(normalizeRuleKey(trigger))) score += 2;
  }
  for (const example of rule.examples) {
    if (text.includes(normalizeRuleKey(example))) score += 1;
  }
  return score;
}

/**
 * Gets the closest 3-5 examples from matched rules.
 */
export function getClosestExamples(
  todoText: string,
  rules: Record<string, TagRule>,
  maxCount = 5,
): string[] {
  const text = normalizeRuleKey(todoText);
  const scored: Array<{ example: string; score: number }> = [];

  for (const rule of Object.values(rules)) {
    for (const example of rule.examples) {
      const tokens = tokenize(example);
      let score = 0;
      for (const token of tokens) {
        if (text.includes(normalizeRuleKey(token))) score += 1;
      }
      if (score > 0 || rule.examples.length <= 3) {
        scored.push({ example, score });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return dedupeArray(
    scored.slice(0, maxCount).map((s) => s.example),
    maxCount,
  );
}
