// =============================================================================
// feature-flag-detector — recognize branch conditions that gate feature flags.
// =============================================================================
//
// Pure function. Given a `ConditionExpr` (the structured AST attached to a
// branch by the walker), returns a `{ name, source, provider? }` descriptor
// when the condition matches a known feature-flag pattern, or `undefined`.
//
// Recognized patterns:
//
//   process.env.NEW_CHECKOUT          → env, name="NEW_CHECKOUT"
//   config.features.NEW_CHECKOUT      → config, name="NEW_CHECKOUT"
//   features.NEW_CHECKOUT             → config, name="NEW_CHECKOUT"
//   flags.NEW_CHECKOUT                → config, name="NEW_CHECKOUT"
//   isFeatureEnabled('new-checkout')  → sdk
//   unleash.isEnabled('new-checkout') → sdk, provider="unleash"
//   posthog.isFeatureEnabled('x')     → sdk, provider="posthog"
//   launchDarkly.variation('x', …)    → sdk, provider="launchdarkly"
//   flagsmith.hasFeature('x')         → sdk, provider="flagsmith"
//   ldClient.variation('x', …)        → sdk, provider="launchdarkly"
//
// Looks through `!` (Unary not) and through `&&` / `||` (Logical) operands —
// a flag inside a compound condition still counts.
// =============================================================================

import type { ConditionExpr, FlowControlNode } from '../types/topology';

export type FeatureFlagInfo = NonNullable<FlowControlNode['metadata']['featureFlag']>;

const SDK_FUNCTIONS = new Set([
  'isFeatureEnabled', 'isEnabled', 'hasFeature', 'variation',
  'getFeatureFlag', 'getVariant', 'getValue',
]);

const SDK_PROVIDERS: Record<string, string> = {
  unleash:      'unleash',
  posthog:      'posthog',
  launchdarkly: 'launchdarkly',
  ldclient:     'launchdarkly',
  ld:           'launchdarkly',
  flagsmith:    'flagsmith',
  optimizely:   'optimizely',
  growthbook:   'growthbook',
  split:        'split',
  configcat:    'configcat',
  statsig:      'statsig',
};

/**
 * Try to detect a feature-flag pattern in a condition AST. Returns
 * `undefined` when nothing matches.
 */
export function detectFeatureFlag(ast: ConditionExpr | undefined): FeatureFlagInfo | undefined {
  if (!ast) return undefined;

  switch (ast.kind) {
    case 'unary':
      // `!flag` — look through the negation
      return detectFeatureFlag(ast.operand);

    case 'logical':
      // `flag && other` / `flag || other` — first operand wins, fall through to second
      return detectFeatureFlag(ast.left) ?? detectFeatureFlag(ast.right);

    case 'binary':
      // `flag === true` / `process.env.X === 'true'` — first operand wins, fall through
      return detectFeatureFlag(ast.left) ?? detectFeatureFlag(ast.right);

    case 'member':
      return detectFromMember(ast);

    case 'call':
      return detectFromCall(ast);

    default:
      return undefined;
  }
}

// --- helpers ----------------------------------------------------------------

function detectFromMember(ast: Extract<ConditionExpr, { kind: 'member' }>): FeatureFlagInfo | undefined {
  // process.env.X
  if (
    ast.object.kind === 'member' &&
    ast.object.property === 'env' &&
    ast.object.object.kind === 'identifier' &&
    ast.object.object.name === 'process'
  ) {
    return { name: ast.property, source: 'env' };
  }

  // config.features.X / config.flags.X
  if (
    ast.object.kind === 'member' &&
    (ast.object.property === 'features' || ast.object.property === 'flags') &&
    ast.object.object.kind === 'identifier' &&
    ast.object.object.name === 'config'
  ) {
    return { name: ast.property, source: 'config' };
  }

  // features.X / flags.X (root-level config object imported as `features`)
  if (
    ast.object.kind === 'identifier' &&
    (ast.object.name === 'features' || ast.object.name === 'flags' || ast.object.name === 'featureFlags')
  ) {
    return { name: ast.property, source: 'config' };
  }

  return undefined;
}

function detectFromCall(ast: Extract<ConditionExpr, { kind: 'call' }>): FeatureFlagInfo | undefined {
  // Extract function name + provider from the callee.
  let fnName: string | undefined;
  let providerKey: string | undefined;

  if (ast.callee.kind === 'identifier') {
    fnName = ast.callee.name;
  } else if (ast.callee.kind === 'member') {
    fnName = ast.callee.property;
    if (ast.callee.object.kind === 'identifier') {
      providerKey = ast.callee.object.name.toLowerCase();
    }
  }

  if (!fnName || !SDK_FUNCTIONS.has(fnName)) return undefined;

  // Need a string-literal first argument to know the flag name.
  const firstArg = ast.args[0];
  if (!firstArg || firstArg.kind !== 'literal' || typeof firstArg.value !== 'string') {
    return undefined;
  }

  const provider = providerKey ? SDK_PROVIDERS[providerKey] : undefined;
  return {
    name: firstArg.value,
    source: 'sdk',
    provider,
  };
}
