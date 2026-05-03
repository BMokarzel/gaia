import { describe, it, expect } from 'vitest';
import { evaluateCondition } from '../../../src/sim/evaluate-condition';
import type { ConditionExpr } from '../../../src/types/topology';

const id = (name: string): ConditionExpr => ({ kind: 'identifier', name });
const lit = (value: string | number | boolean | null): ConditionExpr => ({
  kind: 'literal', value, raw: typeof value === 'string' ? `'${value}'` : String(value),
});
const member = (object: ConditionExpr, property: string, optional = false): ConditionExpr =>
  ({ kind: 'member', object, property, optional });

describe('evaluateCondition — primitives', () => {
  it('literal true → true', () => {
    expect(evaluateCondition({ kind: 'literal', value: true, raw: 'true' }, {})).toBe(true);
  });
  it('literal 0 → false', () => {
    expect(evaluateCondition({ kind: 'literal', value: 0, raw: '0' }, {})).toBe(false);
  });
  it('identifier present → truthy', () => {
    expect(evaluateCondition(id('user'), { user: { id: 1 } })).toBe(true);
  });
  it('identifier absent → undefined', () => {
    expect(evaluateCondition(id('missing'), {})).toBeUndefined();
  });
  it('identifier explicitly undefined in scope → false (defined but falsy)', () => {
    // Note: when a key exists in scope and holds undefined, we still return false
    // (it's "decided"). When the key isn't in scope at all, it's undefined.
    expect(evaluateCondition(id('x'), { x: undefined })).toBe(false);
  });
});

describe('evaluateCondition — member access', () => {
  it('reads nested object', () => {
    expect(evaluateCondition(member(member(id('req'), 'body'), 'force'), {
      req: { body: { force: true } },
    })).toBe(true);
  });
  it('returns undefined for missing root', () => {
    expect(evaluateCondition(member(id('req'), 'body'), {})).toBeUndefined();
  });
  it('optional chain on null returns undefined → falsy decided', () => {
    expect(evaluateCondition(member(id('req'), 'body', true), { req: null })).toBe(false);
  });
});

describe('evaluateCondition — binary', () => {
  it('=== string literal', () => {
    const ast: ConditionExpr = {
      kind: 'binary', op: '===',
      left: member(id('user'), 'role'),
      right: lit('admin'),
    };
    expect(evaluateCondition(ast, { user: { role: 'admin' } })).toBe(true);
    expect(evaluateCondition(ast, { user: { role: 'user'  } })).toBe(false);
  });
  it('numeric comparison', () => {
    const ast: ConditionExpr = {
      kind: 'binary', op: '>',
      left: id('n'), right: lit(0),
    };
    expect(evaluateCondition(ast, { n: 5  })).toBe(true);
    expect(evaluateCondition(ast, { n: -3 })).toBe(false);
  });
  it('returns undefined when either side is unknown', () => {
    const ast: ConditionExpr = {
      kind: 'binary', op: '===',
      left: id('unknown'), right: lit('x'),
    };
    expect(evaluateCondition(ast, {})).toBeUndefined();
  });
});

describe('evaluateCondition — logical', () => {
  it('&& short-circuits on falsy left', () => {
    const ast: ConditionExpr = { kind: 'logical', op: '&&', left: id('a'), right: id('missing') };
    expect(evaluateCondition(ast, { a: false })).toBe(false);
  });
  it('|| short-circuits on truthy left', () => {
    const ast: ConditionExpr = { kind: 'logical', op: '||', left: id('a'), right: id('missing') };
    expect(evaluateCondition(ast, { a: true })).toBe(true);
  });
  it('?? returns left when not nullish', () => {
    const ast: ConditionExpr = { kind: 'logical', op: '??', left: id('a'), right: lit('fallback') };
    expect(evaluateCondition(ast, { a: 0 })).toBe(false); // 0 is not nullish, returns 0 → falsy
  });
  it('&& with both true → true', () => {
    const ast: ConditionExpr = { kind: 'logical', op: '&&', left: id('a'), right: id('b') };
    expect(evaluateCondition(ast, { a: 1, b: 1 })).toBe(true);
  });
  it('&& with unknown left bubbles up', () => {
    const ast: ConditionExpr = { kind: 'logical', op: '&&', left: id('missing'), right: id('b') };
    expect(evaluateCondition(ast, { b: true })).toBeUndefined();
  });
});

describe('evaluateCondition — unary', () => {
  it('!truthy → false', () => {
    expect(evaluateCondition({ kind: 'unary', op: '!', operand: id('a') }, { a: 1 })).toBe(false);
  });
  it('!falsy → true', () => {
    expect(evaluateCondition({ kind: 'unary', op: '!', operand: id('a') }, { a: '' })).toBe(true);
  });
  it('typeof check', () => {
    const ast: ConditionExpr = {
      kind: 'binary', op: '===',
      left:  { kind: 'unary', op: 'typeof', operand: id('x') },
      right: lit('string'),
    };
    expect(evaluateCondition(ast, { x: 'hi' })).toBe(true);
    expect(evaluateCondition(ast, { x: 42   })).toBe(false);
  });
});

describe('evaluateCondition — calls', () => {
  it('Array.isArray(x)', () => {
    const ast: ConditionExpr = {
      kind: 'call',
      callee: member(id('Array'), 'isArray'),
      args: [id('xs')],
    };
    expect(evaluateCondition(ast, { xs: [1,2,3] })).toBe(true);
    expect(evaluateCondition(ast, { xs: 'no'    })).toBe(false);
  });
  it('Number.isFinite(x)', () => {
    const ast: ConditionExpr = {
      kind: 'call',
      callee: member(id('Number'), 'isFinite'),
      args: [id('n')],
    };
    expect(evaluateCondition(ast, { n: 42       })).toBe(true);
    expect(evaluateCondition(ast, { n: Infinity })).toBe(false);
  });
  it('unknown function → undefined', () => {
    const ast: ConditionExpr = {
      kind: 'call', callee: id('myCustomFn'), args: [id('x')],
    };
    expect(evaluateCondition(ast, { x: 1 })).toBeUndefined();
  });
});

describe('evaluateCondition — feature flag patterns', () => {
  it('process.env.NEW === "true"', () => {
    const ast: ConditionExpr = {
      kind: 'binary', op: '===',
      left: member(member(id('process'), 'env'), 'NEW'),
      right: lit('true'),
    };
    expect(evaluateCondition(ast, { process: { env: { NEW: 'true' } } })).toBe(true);
  });
  it('config.features.X', () => {
    const ast = member(member(id('config'), 'features'), 'BETA');
    expect(evaluateCondition(ast, { config: { features: { BETA: true } } })).toBe(true);
    expect(evaluateCondition(ast, { config: { features: { BETA: false } } })).toBe(false);
  });
});

describe('evaluateCondition — template strings', () => {
  it('builds string and compares', () => {
    const tpl: ConditionExpr = {
      kind: 'template',
      quasis: ['user-', '!'],
      expressions: [id('name')],
    };
    const ast: ConditionExpr = {
      kind: 'binary', op: '===', left: tpl, right: lit('user-bob!'),
    };
    expect(evaluateCondition(ast, { name: 'bob' })).toBe(true);
  });
  it('returns undefined when an expression is unknown', () => {
    const tpl: ConditionExpr = {
      kind: 'template', quasis: ['x-', ''], expressions: [id('missing')],
    };
    expect(evaluateCondition(tpl, {})).toBeUndefined();
  });
});

describe('evaluateCondition — fallbacks', () => {
  it("kind 'unknown' → undefined", () => {
    expect(evaluateCondition({ kind: 'unknown', text: '???' }, {})).toBeUndefined();
  });
  it('undefined ast → undefined', () => {
    expect(evaluateCondition(undefined, {})).toBeUndefined();
  });
});
