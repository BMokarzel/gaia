import { describe, it, expect } from 'vitest';
import { detectFeatureFlag } from '../../../src/analysis/feature-flag-detector';
import type { ConditionExpr } from '../../../src/types/topology';

const id = (name: string): ConditionExpr => ({ kind: 'identifier', name });
const lit = (value: string | number | boolean): ConditionExpr => ({
  kind: 'literal', value, raw: typeof value === 'string' ? `'${value}'` : String(value),
});
const member = (object: ConditionExpr, property: string): ConditionExpr => ({
  kind: 'member', object, property, optional: false,
});

describe('detectFeatureFlag', () => {
  it('detects process.env.X', () => {
    const ast = member(member(id('process'), 'env'), 'NEW_CHECKOUT');
    expect(detectFeatureFlag(ast)).toEqual({ name: 'NEW_CHECKOUT', source: 'env' });
  });

  it('detects config.features.X', () => {
    const ast = member(member(id('config'), 'features'), 'BETA');
    expect(detectFeatureFlag(ast)).toEqual({ name: 'BETA', source: 'config' });
  });

  it('detects config.flags.X', () => {
    const ast = member(member(id('config'), 'flags'), 'PRICING_V2');
    expect(detectFeatureFlag(ast)).toEqual({ name: 'PRICING_V2', source: 'config' });
  });

  it('detects features.X (root identifier)', () => {
    const ast = member(id('features'), 'X');
    expect(detectFeatureFlag(ast)).toEqual({ name: 'X', source: 'config' });
  });

  it('detects featureFlags.X', () => {
    const ast = member(id('featureFlags'), 'NEW');
    expect(detectFeatureFlag(ast)).toEqual({ name: 'NEW', source: 'config' });
  });

  it('detects unleash.isEnabled("flag-name")', () => {
    const ast: ConditionExpr = {
      kind: 'call',
      callee: member(id('unleash'), 'isEnabled'),
      args: [lit('new-checkout')],
    };
    expect(detectFeatureFlag(ast)).toEqual({ name: 'new-checkout', source: 'sdk', provider: 'unleash' });
  });

  it('detects launchDarkly.variation', () => {
    const ast: ConditionExpr = {
      kind: 'call',
      callee: member(id('launchDarkly'), 'variation'),
      args: [lit('killswitch'), lit(false)],
    };
    expect(detectFeatureFlag(ast)).toEqual({ name: 'killswitch', source: 'sdk', provider: 'launchdarkly' });
  });

  it('detects bare isFeatureEnabled("X")', () => {
    const ast: ConditionExpr = {
      kind: 'call',
      callee: id('isFeatureEnabled'),
      args: [lit('flag1')],
    };
    expect(detectFeatureFlag(ast)).toEqual({ name: 'flag1', source: 'sdk', provider: undefined });
  });

  it('looks through unary not — !flag', () => {
    const inner = member(member(id('process'), 'env'), 'X');
    const ast: ConditionExpr = { kind: 'unary', op: '!', operand: inner };
    expect(detectFeatureFlag(ast)).toEqual({ name: 'X', source: 'env' });
  });

  it('looks into logical && — flag && other', () => {
    const flag = member(member(id('config'), 'features'), 'BETA');
    const other = id('user');
    const ast: ConditionExpr = { kind: 'logical', op: '&&', left: flag, right: other };
    expect(detectFeatureFlag(ast)).toEqual({ name: 'BETA', source: 'config' });
  });

  it('looks into binary === — process.env.X === "true"', () => {
    const ast: ConditionExpr = {
      kind: 'binary', op: '===',
      left:  member(member(id('process'), 'env'), 'X'),
      right: lit('true'),
    };
    expect(detectFeatureFlag(ast)).toEqual({ name: 'X', source: 'env' });
  });

  it('returns undefined for non-flag conditions', () => {
    expect(detectFeatureFlag(id('user'))).toBeUndefined();
    expect(detectFeatureFlag(member(id('user'), 'role'))).toBeUndefined();
    expect(detectFeatureFlag({ kind: 'literal', value: true, raw: 'true' })).toBeUndefined();
  });

  it('returns undefined for SDK call without string-literal arg', () => {
    const ast: ConditionExpr = {
      kind: 'call',
      callee: member(id('unleash'), 'isEnabled'),
      args: [id('dynamicFlagName')],
    };
    expect(detectFeatureFlag(ast)).toBeUndefined();
  });

  it('returns undefined for unrelated function calls', () => {
    const ast: ConditionExpr = {
      kind: 'call',
      callee: id('Array'),
      args: [lit('foo')],
    };
    expect(detectFeatureFlag(ast)).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(detectFeatureFlag(undefined)).toBeUndefined();
  });
});
