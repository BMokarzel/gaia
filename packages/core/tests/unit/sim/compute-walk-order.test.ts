import { describe, it, expect } from 'vitest';
import { computeWalkOrder } from '../../../src/sim/compute-walk-order';
import type { CodeNode, FlowControlNode, ConditionExpr } from '../../../src/types/topology';

// ----- builders -----------------------------------------------------------

let counter = 0;
const nid = (prefix = 'n') => `${prefix}:${++counter}`;

const loc = () => ({ file: 'x.ts', line: 1, column: 0 });

function process(id = nid('p'), children: CodeNode[] = []): CodeNode {
  return {
    id, type: 'process', name: id, location: loc(), children,
    metadata: { kind: 'transform' },
  } as CodeNode;
}

function ret(id = nid('r')): CodeNode {
  return {
    id, type: 'return', name: id, location: loc(), children: [],
    metadata: { kind: 'explicit' },
  } as CodeNode;
}

function thrw(id = nid('t')): CodeNode {
  return {
    id, type: 'throw', name: id, location: loc(), children: [],
    metadata: { kind: 'throw', errorClass: 'Error', propagates: true },
  } as CodeNode;
}

function ifNode(
  id: string,
  ast: ConditionExpr | undefined,
  thenChildren: CodeNode[],
  elseChildren?: CodeNode[],
  outerChildren: CodeNode[] = [],
): FlowControlNode {
  const branches: { label: string; children: CodeNode[] }[] = [
    { label: 'then', children: thenChildren },
  ];
  if (elseChildren) branches.push({ label: 'else', children: elseChildren });
  return {
    id, type: 'flowControl', name: 'if', location: loc(),
    children: outerChildren,
    metadata: { kind: 'if', conditionAst: ast, branches },
  };
}

function fn(id: string, body: CodeNode[]): CodeNode {
  return {
    id, type: 'function', name: id, location: loc(), children: body,
    metadata: { kind: 'method', signature: { params: [], returnType: 'void' }, async: false },
  } as CodeNode;
}

function call(id: string, callee: string, children: CodeNode[]): CodeNode {
  return {
    id, type: 'call', name: callee, location: loc(), children,
    metadata: { callee, kind: 'sync' },
  } as CodeNode;
}

function loopNode(id: string, body: CodeNode[]): FlowControlNode {
  return {
    id, type: 'flowControl', name: 'while', location: loc(),
    children: body,
    metadata: { kind: 'while' },
  };
}

const idExpr = (name: string): ConditionExpr => ({ kind: 'identifier', name });

// ----- tests --------------------------------------------------------------

describe('computeWalkOrder — basic sequencing', () => {
  it('walks linear children in order', () => {
    const a = process('a'), b = process('b'), c = process('c');
    const root = process('root', [a, b, c]);
    const r = computeWalkOrder(root, {});
    expect(r.walkOrder).toEqual(['root', 'a', 'b', 'c']);
    expect(r.decisions).toEqual([]);
    expect(r.terminated).toBe(false);
  });

  it('returns empty walk for undefined root', () => {
    expect(computeWalkOrder(undefined, {})).toEqual({
      walkOrder: [], decisions: [], terminated: false,
    });
  });
});

describe('computeWalkOrder — short-circuit on return/throw', () => {
  it('stops after return', () => {
    const root = process('root', [process('a'), ret('r1'), process('after')]);
    const r = computeWalkOrder(root, {});
    expect(r.walkOrder).toEqual(['root', 'a', 'r1']);
    expect(r.terminated).toBe(true);
  });

  it('stops after throw', () => {
    const root = process('root', [process('a'), thrw('t1'), process('after')]);
    const r = computeWalkOrder(root, {});
    expect(r.walkOrder).toEqual(['root', 'a', 't1']);
    expect(r.terminated).toBe(true);
  });
});

describe('computeWalkOrder — if branches', () => {
  it('takes then when condition is truthy', () => {
    const tThen = process('then-only');
    const tElse = process('else-only');
    const fc = ifNode('if1', idExpr('admin'), [tThen], [tElse]);
    const root = process('root', [fc]);
    const r = computeWalkOrder(root, { admin: true });
    expect(r.walkOrder).toEqual(['root', 'if1', 'then-only']);
    expect(r.decisions).toEqual([
      { nodeId: 'if1', branchLabel: 'then', outcome: 'true', skippedLabels: ['else'] },
    ]);
  });

  it('takes else when condition is falsy', () => {
    const fc = ifNode('if1', idExpr('admin'), [process('t')], [process('e')]);
    const root = process('root', [fc]);
    const r = computeWalkOrder(root, { admin: false });
    expect(r.walkOrder).toEqual(['root', 'if1', 'e']);
    expect(r.decisions[0]).toMatchObject({ branchLabel: 'else', outcome: 'false' });
  });

  it('skips body entirely when false and no else branch', () => {
    const fc = ifNode('if1', idExpr('flag'), [process('then-only')]);
    const root = process('root', [fc, process('after')]);
    const r = computeWalkOrder(root, { flag: false });
    expect(r.walkOrder).toEqual(['root', 'if1', 'after']);
    expect(r.decisions[0]).toMatchObject({
      branchLabel: null, outcome: 'false', skippedLabels: ['then'],
    });
  });

  it('defaults to truthy lane when condition is unknown', () => {
    const fc = ifNode('if1', idExpr('unboundFlag'), [process('t')], [process('e')]);
    const root = process('root', [fc]);
    const r = computeWalkOrder(root, {});
    expect(r.walkOrder).toEqual(['root', 'if1', 't']);
    expect(r.decisions[0]).toMatchObject({ branchLabel: 'then', outcome: 'unknown' });
  });

  it('continues sequentially after the branch finishes', () => {
    const fc = ifNode('if1', idExpr('x'), [process('t')], [process('e')]);
    const root = process('root', [process('before'), fc, process('after')]);
    const r = computeWalkOrder(root, { x: 1 });
    expect(r.walkOrder).toEqual(['root', 'before', 'if1', 't', 'after']);
  });

  it('return inside a branch terminates the whole walk', () => {
    const fc = ifNode('if1', idExpr('x'), [process('t1'), ret('r1')], [process('e')]);
    const root = process('root', [fc, process('after')]);
    const r = computeWalkOrder(root, { x: true });
    expect(r.walkOrder).toEqual(['root', 'if1', 't1', 'r1']);
    expect(r.terminated).toBe(true);
  });
});

describe('computeWalkOrder — nested flowControl', () => {
  it('descends into nested ifs and picks per-condition', () => {
    const inner = ifNode('if2', idExpr('inner'), [process('inner-t')], [process('inner-e')]);
    const outer = ifNode('if1', idExpr('outer'), [inner], [process('outer-e')]);
    const root = process('root', [outer]);
    const r = computeWalkOrder(root, { outer: true, inner: false });
    expect(r.walkOrder).toEqual(['root', 'if1', 'if2', 'inner-e']);
    expect(r.decisions.map(d => d.branchLabel)).toEqual(['then', 'else']);
  });
});

describe('computeWalkOrder — loops & try', () => {
  it('walks loop body once', () => {
    const loop = loopNode('w1', [process('body')]);
    const root = process('root', [loop, process('after')]);
    const r = computeWalkOrder(root, {});
    expect(r.walkOrder).toEqual(['root', 'w1', 'body', 'after']);
    expect(r.decisions).toEqual([]);
  });
});

describe('computeWalkOrder — function-frame depth (controller vs callee)', () => {
  it('return inside a called function does NOT terminate the controller walk', () => {
    // Mirrors `controller { call(svc); return; }` where `svc` itself returns.
    const svc = fn('svc-fn', [process('svc-stmt'), ret('svc-ret')]);
    const c   = call('c1', 'svc.method', [svc]);
    const ctrlReturn = ret('ctrl-ret');
    const root = process('endpoint', [process('mw'), c, ctrlReturn]);

    const r = computeWalkOrder(root, {});
    expect(r.walkOrder).toEqual([
      'endpoint', 'mw', 'c1', 'svc-fn', 'svc-stmt', 'svc-ret',
      'ctrl-ret',
    ]);
    expect(r.terminated).toBe(true); // ctrl-ret is the actual terminator
  });

  it('throw inside a called function unwinds that frame and continues at the controller', () => {
    const svc = fn('svc-fn', [thrw('svc-throw'), process('after-throw')]);
    const c   = call('c1', 'svc.method', [svc]);
    const root = process('endpoint', [c, process('ctrl-after'), ret('ctrl-ret')]);

    const r = computeWalkOrder(root, {});
    // `after-throw` inside svc-fn must be skipped (frame exited),
    // but the controller's `ctrl-after` and `ctrl-ret` are still walked.
    expect(r.walkOrder).toEqual([
      'endpoint', 'c1', 'svc-fn', 'svc-throw',
      'ctrl-after', 'ctrl-ret',
    ]);
    expect(r.terminated).toBe(true);
  });

  it('controller-layer return terminates immediately (depth 0)', () => {
    const root = process('endpoint', [process('a'), ret('top-ret'), process('after')]);
    const r = computeWalkOrder(root, {});
    expect(r.walkOrder).toEqual(['endpoint', 'a', 'top-ret']);
    expect(r.terminated).toBe(true);
  });

  it('return in a deep service does not stop the controller from continuing', () => {
    // endpoint → call → svc → call → repo (returns) → svc continues → ctrl continues
    const repo = fn('repo-fn', [process('repo-q'), ret('repo-ret')]);
    const repoCall = call('rc', 'repo.find', [repo]);
    const svc  = fn('svc-fn', [repoCall, process('svc-after')]);
    const svcCall = call('sc', 'svc.do', [svc]);
    const root = process('endpoint', [svcCall, ret('ctrl-ret')]);

    const r = computeWalkOrder(root, {});
    expect(r.walkOrder).toEqual([
      'endpoint',
      'sc', 'svc-fn',
      'rc', 'repo-fn', 'repo-q', 'repo-ret',
      'svc-after',
      'ctrl-ret',
    ]);
    expect(r.terminated).toBe(true);
  });

  it('return inside a branch of a callee unwinds the callee, not the walk', () => {
    const branchRet = ifNode('svc-if', idExpr('flag'),
      [process('then'), ret('inner-ret')],
      [process('else')]);
    const svc = fn('svc-fn', [branchRet, process('svc-after')]);
    const root = process('endpoint', [call('c1', 'svc.do', [svc]), ret('ctrl-ret')]);

    const r = computeWalkOrder(root, { flag: true });
    expect(r.walkOrder).toEqual([
      'endpoint', 'c1', 'svc-fn', 'svc-if', 'then', 'inner-ret',
      'ctrl-ret',
    ]);
    expect(r.terminated).toBe(true);
  });
});

describe('computeWalkOrder — switch fallback', () => {
  it('prefers default when no per-case AST', () => {
    const fc: FlowControlNode = {
      id: 'sw1', type: 'flowControl', name: 'switch', location: loc(),
      children: [],
      metadata: {
        kind: 'switch',
        branches: [
          { label: 'case', children: [process('c1')] },
          { label: 'default', children: [process('def')] },
        ],
      },
    };
    const r = computeWalkOrder(process('root', [fc]), {});
    expect(r.walkOrder).toEqual(['root', 'sw1', 'def']);
    expect(r.decisions[0]).toMatchObject({ branchLabel: 'default', outcome: 'unknown' });
  });

  it('falls back to first case when no default', () => {
    const fc: FlowControlNode = {
      id: 'sw1', type: 'flowControl', name: 'switch', location: loc(),
      children: [],
      metadata: {
        kind: 'switch',
        branches: [
          { label: 'case', children: [process('c1')] },
          { label: 'case', children: [process('c2')] },
        ],
      },
    };
    const r = computeWalkOrder(process('root', [fc]), {});
    expect(r.walkOrder).toEqual(['root', 'sw1', 'c1']);
  });
});
