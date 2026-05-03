// =============================================================================
// evaluate-condition — deterministically evaluate a ConditionExpr against a scope.
// =============================================================================
//
// Pure, browser-safe (no node deps). Used by the web simulator to pick the
// branch a given input would actually trigger, without an LLM.
//
// Returns:
//   true       — condition holds for the given scope
//   false      — condition does not hold
//   undefined  — couldn't decide (unbound identifier, unsupported AST shape,
//                or a member access into a missing object). Lets callers treat
//                "unknown" branches by exploring both arms.
//
// Scope shape: a plain object whose keys mirror the identifiers a developer
// would write in an `if (...)` — typically `req`, `body`, `params`, `query`,
// `headers`, plus feature flags (`features`, `flags`, `process`, `config`).
// =============================================================================

import type { ConditionExpr } from '../types/topology';

export type Scope = Record<string, unknown>;

export type EvalResult = boolean | undefined;

export function evaluateCondition(ast: ConditionExpr | undefined, scope: Scope): EvalResult {
  const value = evalExpr(ast, scope);
  if (value === SYM_UNKNOWN) return undefined;
  return Boolean(value);
}

// Evaluate to a JS value (or SYM_UNKNOWN). Truthiness conversion is delayed to
// `evaluateCondition` so callers can use this for non-boolean comparisons too.
const SYM_UNKNOWN = Symbol('unknown');
type EvalValue = unknown | typeof SYM_UNKNOWN;

function evalExpr(ast: ConditionExpr | undefined, scope: Scope): EvalValue {
  if (!ast) return SYM_UNKNOWN;

  switch (ast.kind) {
    case 'literal':
      return ast.value;

    case 'identifier':
      // `undefined` literal-ish identifier
      if (ast.name === 'undefined') return undefined;
      if (ast.name === 'NaN') return NaN;
      if (ast.name === 'Infinity') return Infinity;
      if (ast.name in scope) return scope[ast.name];
      return SYM_UNKNOWN;

    case 'member': {
      const obj = evalExpr(ast.object, scope);
      if (obj === SYM_UNKNOWN) return SYM_UNKNOWN;
      if (obj == null) {
        // Optional chain on null/undefined yields undefined.
        if (ast.optional) return undefined;
        return SYM_UNKNOWN;
      }
      if (typeof obj !== 'object' && typeof obj !== 'function' && typeof obj !== 'string') {
        return SYM_UNKNOWN;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (obj as any)[ast.property];
    }

    case 'unary': {
      const inner = evalExpr(ast.operand, scope);
      if (inner === SYM_UNKNOWN) return SYM_UNKNOWN;
      switch (ast.op) {
        case '!':       return !inner;
        case '-':       return -(inner as number);
        case '+':       return +(inner as number);
        case 'typeof':  return typeof inner;
        case 'void':    return undefined;
      }
      return SYM_UNKNOWN;
    }

    case 'binary': {
      const left  = evalExpr(ast.left, scope);
      const right = evalExpr(ast.right, scope);
      if (left === SYM_UNKNOWN || right === SYM_UNKNOWN) return SYM_UNKNOWN;
      switch (ast.op) {
        // eslint-disable-next-line eqeqeq
        case '==':  return left == right;
        // eslint-disable-next-line eqeqeq
        case '!=':  return left != right;
        case '===': return left === right;
        case '!==': return left !== right;
        case '<':   return (left as number) <  (right as number);
        case '<=':  return (left as number) <= (right as number);
        case '>':   return (left as number) >  (right as number);
        case '>=':  return (left as number) >= (right as number);
        case '+':   return (left as number) +  (right as number);
        case '-':   return (left as number) -  (right as number);
        case '*':   return (left as number) *  (right as number);
        case '/':   return (left as number) /  (right as number);
        case '%':   return (left as number) %  (right as number);
        case 'in':
          if (right == null || (typeof right !== 'object' && typeof right !== 'function')) return SYM_UNKNOWN;
          return (left as PropertyKey) in (right as object);
        case 'instanceof':
          // Without runtime constructors in scope this rarely resolves.
          return SYM_UNKNOWN;
      }
      return SYM_UNKNOWN;
    }

    case 'logical': {
      // Short-circuit semantics — match JS: && / || / ??
      const left = evalExpr(ast.left, scope);
      switch (ast.op) {
        case '&&':
          if (left === SYM_UNKNOWN) return SYM_UNKNOWN;
          if (!left) return left;
          return evalExpr(ast.right, scope);
        case '||':
          if (left === SYM_UNKNOWN) return SYM_UNKNOWN;
          if (left) return left;
          return evalExpr(ast.right, scope);
        case '??':
          if (left === SYM_UNKNOWN) return SYM_UNKNOWN;
          if (left != null) return left;
          return evalExpr(ast.right, scope);
      }
      return SYM_UNKNOWN;
    }

    case 'call': {
      // Limited subset: well-known pure helpers we recognize from the codebase.
      // Anything else returns UNKNOWN — the simulator will explore both arms.
      const callee = ast.callee;
      // Array.isArray(x)
      if (
        callee.kind === 'member' &&
        callee.property === 'isArray' &&
        callee.object.kind === 'identifier' &&
        callee.object.name === 'Array'
      ) {
        const a = evalExpr(ast.args[0], scope);
        if (a === SYM_UNKNOWN) return SYM_UNKNOWN;
        return Array.isArray(a);
      }
      // Number.isFinite / Number.isNaN / Number.isInteger
      if (
        callee.kind === 'member' &&
        callee.object.kind === 'identifier' &&
        callee.object.name === 'Number' &&
        (callee.property === 'isFinite' || callee.property === 'isNaN' || callee.property === 'isInteger')
      ) {
        const a = evalExpr(ast.args[0], scope);
        if (a === SYM_UNKNOWN) return SYM_UNKNOWN;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (Number as any)[callee.property](a);
      }
      // Object.keys(x).length / Object.values(x).length style — not supported
      return SYM_UNKNOWN;
    }

    case 'template': {
      // `${a}-${b}` → concatenate string parts, return UNKNOWN if any expr is unknown
      const parts: string[] = [];
      for (let i = 0; i < ast.quasis.length; i++) {
        parts.push(ast.quasis[i]);
        if (i < ast.expressions.length) {
          const v = evalExpr(ast.expressions[i], scope);
          if (v === SYM_UNKNOWN) return SYM_UNKNOWN;
          parts.push(String(v ?? ''));
        }
      }
      return parts.join('');
    }

    case 'unknown':
      return SYM_UNKNOWN;
  }
}
