import { describe, expect, it, beforeAll } from 'vitest';
import {
  TsAstWalker,
  isTsParserAvailable,
  type ElementBatch,
  type SourceFile,
  type BranchMeta,
  type ConditionExpr,
} from '../../src';

const PARSER_OK = isTsParserAvailable();

beforeAll(() => {
  if (!PARSER_OK) {
    // eslint-disable-next-line no-console
    console.warn('tree-sitter TS parser unavailable — condition-ast suite skipped');
  }
});

function walkSnippet(snippet: string): ElementBatch {
  const walker = new TsAstWalker();
  const file: SourceFile = {
    path: 'snippet.ts',
    content: snippet,
    extension: '.ts',
    language: 'typescript',
  };
  const result = walker.walk(file);
  if (!result) throw new Error('walk returned null');
  return result;
}

function firstBranchAst(snippet: string): ConditionExpr | undefined {
  const batch = walkSnippet(snippet);
  const branch = batch.elements.find(e => e.kind === 'branch');
  if (!branch) return undefined;
  return (branch.meta as BranchMeta).conditionAst;
}

describe('serializeConditionExpr', () => {
  it.skipIf(!PARSER_OK)('serializes a bare identifier', () => {
    const ast = firstBranchAst(`function f(user: any) { if (user) { return 1 } return 0 }`);
    expect(ast).toEqual({ kind: 'identifier', name: 'user' });
  });

  it.skipIf(!PARSER_OK)('serializes a member access', () => {
    const ast = firstBranchAst(`function f(req: any) { if (req.body.id) { return 1 } return 0 }`);
    expect(ast).toEqual({
      kind: 'member',
      object: { kind: 'member', object: { kind: 'identifier', name: 'req' }, property: 'body', optional: false },
      property: 'id',
      optional: false,
    });
  });

  it.skipIf(!PARSER_OK)('serializes equality with a string literal', () => {
    const ast = firstBranchAst(`function f(user: any) { if (user.role === 'admin') { return 1 } return 0 }`);
    expect(ast).toEqual({
      kind: 'binary',
      op: '===',
      left:  { kind: 'member', object: { kind: 'identifier', name: 'user' }, property: 'role', optional: false },
      right: { kind: 'literal', value: 'admin', raw: "'admin'" },
    });
  });

  it.skipIf(!PARSER_OK)('serializes a logical AND', () => {
    const ast = firstBranchAst(`function f(a: any, b: any) { if (a && b) { return 1 } return 0 }`);
    expect(ast).toEqual({
      kind: 'logical',
      op: '&&',
      left:  { kind: 'identifier', name: 'a' },
      right: { kind: 'identifier', name: 'b' },
    });
  });

  it.skipIf(!PARSER_OK)('serializes a unary not', () => {
    const ast = firstBranchAst(`function f(ready: any) { if (!ready) { return 1 } return 0 }`);
    expect(ast).toEqual({
      kind: 'unary',
      op: '!',
      operand: { kind: 'identifier', name: 'ready' },
    });
  });

  it.skipIf(!PARSER_OK)('serializes a function call (Array.isArray(x))', () => {
    const ast = firstBranchAst(`function f(x: any) { if (Array.isArray(x)) { return 1 } return 0 }`);
    expect(ast).toEqual({
      kind: 'call',
      callee: {
        kind: 'member',
        object: { kind: 'identifier', name: 'Array' },
        property: 'isArray',
        optional: false,
      },
      args: [{ kind: 'identifier', name: 'x' }],
    });
  });

  it.skipIf(!PARSER_OK)('serializes a numeric literal comparison', () => {
    const ast = firstBranchAst(`function f(n: number) { if (n > 0) { return 1 } return 0 }`);
    expect(ast).toEqual({
      kind: 'binary',
      op: '>',
      left:  { kind: 'identifier', name: 'n' },
      right: { kind: 'literal', value: 0, raw: '0' },
    });
  });

  it.skipIf(!PARSER_OK)('strips parentheses and as-cast wrappers', () => {
    const ast = firstBranchAst(`function f(x: any) { if (((x as any) === 'foo')) { return 1 } return 0 }`);
    expect(ast).toEqual({
      kind: 'binary',
      op: '===',
      left:  { kind: 'identifier', name: 'x' },
      right: { kind: 'literal', value: 'foo', raw: "'foo'" },
    });
  });

  it.skipIf(!PARSER_OK)('handles deeply nested logical chains', () => {
    const ast = firstBranchAst(`function f(a: any, b: any, c: any) { if (a && b && c) { return 1 } return 0 }`);
    // Tree-sitter parses left-associatively: ((a && b) && c)
    expect(ast?.kind).toBe('logical');
    if (ast?.kind === 'logical') {
      expect(ast.op).toBe('&&');
      expect(ast.right).toEqual({ kind: 'identifier', name: 'c' });
      expect(ast.left.kind).toBe('logical');
    }
  });

  it.skipIf(!PARSER_OK)('falls back to unknown for unsupported shapes', () => {
    // arrow function expression as condition — not in our subset
    const ast = firstBranchAst(`function f() { if ((() => true)()) { return 1 } return 0 }`);
    // Outermost is a call_expression, callee is a parenthesized arrow → call kind
    // but arrow_function callee should fall back to unknown
    expect(ast?.kind).toBe('call');
    if (ast?.kind === 'call') {
      expect(ast.callee.kind).toBe('unknown');
    }
  });
});
