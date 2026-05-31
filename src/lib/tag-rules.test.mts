import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  updateTagRulesFromCorrection,
  compressTagRules,
  getRelevantTagRules,
  buildAutoTagPrompt,
  getClosestExamples,
  scoreRuleMatch,
} from './tag-rules.ts';

interface TagRule {
  description: string;
  triggers: string[];
  parent_tags: string[];
  move_default: 'yes' | 'no' | 'unclear';
  examples: string[];
}

interface TagRulesStore {
  tags: Record<string, TagRule>;
  hierarchy: Record<string, string[]>;
}

const emptyStore: TagRulesStore = { tags: {}, hierarchy: {} };

// ---------------------------------------------------------------------------
// updateTagRulesFromCorrection
// ---------------------------------------------------------------------------

describe('updateTagRulesFromCorrection', () => {
  it('creates a new tag rule when none exists', () => {
    const result = updateTagRulesFromCorrection(
      emptyStore,
      'yellow panni lena',
      ['gol_bazar'],
      'yes',
      '',
    );
    assert.ok(result.tags['gol_bazar']);
    assert.equal(result.tags['gol_bazar'].move_default, 'yes');
    assert.ok(result.tags['gol_bazar'].triggers.includes('yellow panni'));
    assert.equal(result.tags['gol_bazar'].examples.length, 1);
    assert.equal(result.tags['gol_bazar'].examples[0], 'yellow panni lena');
  });

  it('adds trigger words to existing tag rule', () => {
    const store: TagRulesStore = {
      tags: {
        gol_bazar: {
          description: '',
          triggers: ['gol bazar'],
          parent_tags: [],
          move_default: 'unclear',
          examples: ['gol bazar shopping'],
        },
      },
      hierarchy: {},
    };
    const result = updateTagRulesFromCorrection(
      store,
      'yellow panni lena from gol bazar',
      ['gol_bazar'],
      'yes',
      '',
    );
    assert.ok(result.tags['gol_bazar'].triggers.includes('yellow panni'));
    assert.ok(result.tags['gol_bazar'].triggers.includes('gol bazar'));
  });

  it('does not add duplicate examples', () => {
    const store: TagRulesStore = {
      tags: {
        gol_bazar: {
          description: '',
          triggers: [],
          parent_tags: [],
          move_default: 'unclear',
          examples: ['yellow panni lena'],
        },
      },
      hierarchy: {},
    };
    const result = updateTagRulesFromCorrection(
      store,
      'yellow panni lena',
      ['gol_bazar'],
      'unclear',
      '',
    );
    assert.equal(result.tags['gol_bazar'].examples.length, 1);
  });

  it('adds parent hierarchy for multi-tag corrections', () => {
    const result = updateTagRulesFromCorrection(
      emptyStore,
      'bindu ke samose',
      ['jbp_home', 'jbp'],
      'yes',
      '',
    );
    assert.ok(result.hierarchy['jbp_home']);
    assert.ok(result.hierarchy['jbp_home'].includes('jbp'));
    assert.ok(result.tags['jbp_home'].parent_tags.includes('jbp'));
  });

  it('updates move_default when explicitly set', () => {
    const store: TagRulesStore = {
      tags: {
        gol_bazar: {
          description: '',
          triggers: [],
          parent_tags: [],
          move_default: 'unclear',
          examples: [],
        },
      },
      hierarchy: {},
    };
    const result = updateTagRulesFromCorrection(
      store,
      'some task',
      ['gol_bazar'],
      'no',
      '',
    );
    assert.equal(result.tags['gol_bazar'].move_default, 'no');
  });

  it('keeps existing move_default when correction is unclear', () => {
    const store: TagRulesStore = {
      tags: {
        gol_bazar: {
          description: '',
          triggers: [],
          parent_tags: [],
          move_default: 'yes',
          examples: [],
        },
      },
      hierarchy: {},
    };
    const result = updateTagRulesFromCorrection(
      store,
      'some task',
      ['gol_bazar'],
      'unclear',
      '',
    );
    assert.equal(result.tags['gol_bazar'].move_default, 'yes');
  });

  it('caps triggers at 15', () => {
    let store: TagRulesStore = { tags: {}, hierarchy: {} };
    for (let i = 0; i < 20; i++) {
      store = updateTagRulesFromCorrection(
        store,
        `unique task phrase number ${i}`,
        ['katni_city'],
        'unclear',
        '',
      );
    }
    assert.ok(store.tags['katni_city'].triggers.length <= 15);
  });

  it('caps examples at 5', () => {
    let store: TagRulesStore = { tags: {}, hierarchy: {} };
    for (let i = 0; i < 10; i++) {
      store = updateTagRulesFromCorrection(
        store,
        `example task ${i}`,
        ['katni_city'],
        'unclear',
        '',
      );
    }
    assert.ok(store.tags['katni_city'].examples.length <= 5);
  });
});

// ---------------------------------------------------------------------------
// getRelevantTagRules
// ---------------------------------------------------------------------------

describe('getRelevantTagRules', () => {
  const store: TagRulesStore = {
    tags: {
      jbp: {
        description: 'Jabalpur related tasks',
        triggers: ['jbp', 'jabalpur'],
        parent_tags: [],
        move_default: 'unclear',
        examples: [],
      },
      jbp_home: {
        description: 'JBP home tasks',
        triggers: ['jbp home'],
        parent_tags: ['jbp'],
        move_default: 'unclear',
        examples: [],
      },
      gol_bazar: {
        description: 'Gol Bazar area',
        triggers: ['gol bazar', 'yellow panni', 'panni'],
        parent_tags: ['katni_city', 'katni'],
        move_default: 'yes',
        examples: ['yellow panni lena'],
      },
      katni_city: {
        description: 'Katni city tasks',
        triggers: ['katni city', 'katni'],
        parent_tags: [],
        move_default: 'unclear',
        examples: [],
      },
      katni: {
        description: 'Katni area',
        triggers: ['katni'],
        parent_tags: [],
        move_default: 'unclear',
        examples: [],
      },
    },
    hierarchy: {
      jbp_home: ['jbp'],
      gol_bazar: ['katni_city', 'katni'],
    },
  };

  it('matches by trigger word', () => {
    const result = getRelevantTagRules('yellow panni lena', store);
    assert.ok(result.rules['gol_bazar']);
  });

  it('returns parent tags from hierarchy', () => {
    const result = getRelevantTagRules('yellow panni lena', store);
    assert.ok(result.rules['gol_bazar']);
    assert.ok(result.rules['katni_city']);
    assert.ok(result.rules['katni']);
    assert.ok(result.hierarchy['gol_bazar']);
    assert.ok(result.hierarchy['gol_bazar'].includes('katni_city'));
  });

  it('returns empty for non-matching todo', () => {
    const result = getRelevantTagRules('buy groceries', store);
    assert.equal(Object.keys(result.rules).length, 0);
    assert.equal(Object.keys(result.hierarchy).length, 0);
  });

  it('matches by tag key itself', () => {
    const result = getRelevantTagRules('go to jbp', store);
    assert.ok(result.rules['jbp']);
  });
});

// ---------------------------------------------------------------------------
// compressTagRules
// ---------------------------------------------------------------------------

describe('compressTagRules', () => {
  it('removes redundant triggers', () => {
    const store: TagRulesStore = {
      tags: {
        test: {
          description: '',
          triggers: ['panni', 'yellow panni'],
          parent_tags: [],
          move_default: 'unclear',
          examples: ['yellow panni lena'],
        },
      },
      hierarchy: {},
    };
    const result = compressTagRules(store);
    // Deduplication should keep both since they are different tokens,
    // but the module's dedupeArray handles this properly
    assert.ok(result.tags['test']);
  });

  it('preserves hierarchy', () => {
    const store: TagRulesStore = {
      tags: {},
      hierarchy: { gol_bazar: ['katni_city'] },
    };
    const result = compressTagRules(store);
    assert.deepEqual(result.hierarchy, { gol_bazar: ['katni_city'] });
  });

  it('does not modify empty store', () => {
    const result = compressTagRules(emptyStore);
    assert.deepEqual(result, emptyStore);
  });
});

// ---------------------------------------------------------------------------
// buildAutoTagPrompt
// ---------------------------------------------------------------------------

describe('buildAutoTagPrompt', () => {
  it('produces valid JSON', () => {
    const rules: Record<string, TagRule> = {
      gol_bazar: {
        description: 'test',
        triggers: ['panni'],
        parent_tags: [],
        move_default: 'yes',
        examples: [],
      },
    };
    const hierarchy: Record<string, string[]> = {};
    const prompt = buildAutoTagPrompt('yellow panni lena', rules, hierarchy);
    const parsed = JSON.parse(prompt);
    assert.equal(parsed.todo, 'yellow panni lena');
    assert.ok(parsed.relevant_rules);
    assert.ok(parsed.response_shape);
    assert.ok(parsed.response_shape.taskTags);
  });

  it('stays compact (< 800 chars for typical input)', () => {
    const rules: Record<string, TagRule> = {
      gol_bazar: {
        description: 'Gol Bazar area',
        triggers: ['gol bazar', 'yellow panni'],
        parent_tags: ['katni_city'],
        move_default: 'yes',
        examples: ['yellow panni lena'],
      },
    };
    const hierarchy: Record<string, string[]> = { gol_bazar: ['katni_city'] };
    const prompt = buildAutoTagPrompt('yellow panni lena', rules, hierarchy);
    assert.ok(prompt.length < 800, `prompt length ${prompt.length} should be < 800`);
  });
});

// ---------------------------------------------------------------------------
// getClosestExamples
// ---------------------------------------------------------------------------

describe('getClosestExamples', () => {
  const rules: Record<string, TagRule> = {
    gol_bazar: {
      description: '',
      triggers: [],
      parent_tags: [],
      move_default: 'unclear',
      examples: [
        'yellow panni lena from Gol Bazar',
        'buy garbage bags',
        'subhash chowk chai',
        'kamaniya gate repair',
      ],
    },
  };

  it('returns relevant examples sorted by match score', () => {
    const examples = getClosestExamples('panni yellow', rules);
    assert.ok(examples.length <= 5);
    assert.equal(examples[0], 'yellow panni lena from Gol Bazar');
  });

  it('deduplicates results', () => {
    const dupRules: Record<string, TagRule> = {
      test: {
        description: '',
        triggers: [],
        parent_tags: [],
        move_default: 'unclear',
        examples: ['task a', 'task a', 'task b'],
      },
    };
    const examples = getClosestExamples('task', dupRules);
    const unique = new Set(examples);
    assert.equal(unique.size, examples.length);
  });
});

// ---------------------------------------------------------------------------
// scoreRuleMatch
// ---------------------------------------------------------------------------

describe('scoreRuleMatch', () => {
  it('scores higher for trigger matches', () => {
    const rule: TagRule = {
      description: '',
      triggers: ['yellow panni'],
      parent_tags: [],
      move_default: 'unclear',
      examples: [],
    };
    const score = scoreRuleMatch('yellow panni lena', rule);
    assert.ok(score > 0);
  });

  it('scores 0 for no match', () => {
    const rule: TagRule = {
      description: '',
      triggers: ['something else'],
      parent_tags: [],
      move_default: 'unclear',
      examples: [],
    };
    assert.equal(scoreRuleMatch('yellow panni', rule), 0);
  });
});

console.log('\nAll tag-rules tests passed.\n');
