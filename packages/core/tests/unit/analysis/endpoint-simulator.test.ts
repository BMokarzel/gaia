import { describe, it, expect } from 'vitest';
import { simulateEndpoint } from '../../../src/analysis/endpoint-simulator';
import type {
  EndpointNode, ServiceNode, FunctionNode, ThrowNode,
  ExternalCallNode, DbProcessNode, MiddlewareNode,
  FlowControlNode, ReturnNode, CallNode, CodeNode,
} from '../../../src/types/topology';

// ── Fixture helpers ─────────────────────────────────────────────────

function thr(id: string, errorClass: string, httpStatus?: number, propagates = true): ThrowNode {
  return {
    id, type: 'throw', name: errorClass,
    location: { file: 'h.ts', line: 1, column: 0 },
    children: [],
    metadata: { kind: 'throw', errorClass, httpStatus, propagates },
  } as ThrowNode;
}

function ext(id: string, method = 'GET', path = '/x'): ExternalCallNode {
  return {
    id, type: 'externalCall', name: 'ext',
    location: { file: 'c.ts', line: 1, column: 0 },
    children: [],
    metadata: { method: method as any, path, httpClient: 'axios' },
  } as ExternalCallNode;
}

function dbp(id: string, op = 'find', databaseId = 'db-1', tableId = 'users'): DbProcessNode {
  return {
    id, type: 'dbProcess', name: `${op} ${tableId}`,
    location: { file: 'd.ts', line: 1, column: 0 },
    children: [],
    metadata: { operation: op as any, databaseId, tableId },
  } as DbProcessNode;
}

function mw(id: string, name: string, kind = 'guard', order = 0): MiddlewareNode {
  return {
    id, type: 'middleware', name,
    location: { file: 'm.ts', line: 1, column: 0 },
    children: [],
    metadata: { kind: kind as any, framework: 'nest', name, order },
  } as MiddlewareNode;
}

function tryNode(id: string, body: CodeNode[], catchBody: CodeNode[] = []): FlowControlNode {
  return {
    id, type: 'flowControl', name: 'try',
    location: { file: 'f.ts', line: 1, column: 0 },
    children: [],
    metadata: {
      kind: 'try',
      branches: [
        { label: 'try', children: body },
        ...(catchBody.length ? [{ label: 'catch', children: catchBody }] : []),
      ],
    },
  } as FlowControlNode;
}

function ifNode(id: string, body: CodeNode[]): FlowControlNode {
  return {
    id, type: 'flowControl', name: 'if',
    location: { file: 'f.ts', line: 1, column: 0 },
    children: body,
    metadata: { kind: 'if', condition: 'x' },
  } as FlowControlNode;
}

function ret(id: string, httpStatus?: number): ReturnNode {
  return {
    id, type: 'return', name: 'return',
    location: { file: 'r.ts', line: 1, column: 0 },
    children: [],
    metadata: { kind: 'explicit', httpStatus },
  } as ReturnNode;
}

function call(id: string, resolvedTo?: string, children: CodeNode[] = []): CallNode {
  return {
    id, type: 'call', name: 'call',
    location: { file: 'c.ts', line: 1, column: 0 },
    children,
    metadata: { callee: resolvedTo ?? 'fn', arguments: [], awaited: true, chained: false, optional: false, resolvedTo },
  } as CallNode;
}

function fn(id: string, children: CodeNode[]): FunctionNode {
  return {
    id, type: 'function', name: id,
    location: { file: 'fn.ts', line: 1, column: 0 },
    children,
    metadata: { kind: 'function', async: true, exported: false, params: [] },
  } as unknown as FunctionNode;
}

function endpoint(
  id: string, children: CodeNode[],
  meta: Partial<EndpointNode['metadata']> = {},
): EndpointNode {
  return {
    id, type: 'endpoint', name: id,
    location: { file: 'e.ts', line: 1, column: 0 },
    children,
    metadata: { method: 'GET', path: '/x', request: {}, responses: [], ...meta },
  } as EndpointNode;
}

function service(id: string, endpoints: EndpointNode[], functions: FunctionNode[] = []): ServiceNode {
  return {
    id, type: 'service', name: id, code: id,
    metadata: { kind: 'service', language: 'typescript', framework: 'nestjs' },
    endpoints, functions, globals: [], dependencies: [],
  } as ServiceNode;
}

// ── tests ────────────────────────────────────────────────────────────

describe('endpoint-simulator', () => {
  it('reports a direct throw as escaping (uncaught)', () => {
    const e = endpoint('e1', [thr('t1', 'Unauthorized', 401)]);
    const s = service('svc', [e]);
    const r = simulateEndpoint(e, s);
    expect(r.throws).toHaveLength(1);
    expect(r.throws[0]).toMatchObject({ errorClass: 'Unauthorized', httpStatus: 401, caught: false });
    expect(r.likelyResponses).toEqual([
      { kind: 'throw', httpStatus: 401, errorClass: 'Unauthorized', reason: 'naturally reachable' },
    ]);
  });

  it('marks throw inside try as caught', () => {
    const e = endpoint('e1', [tryNode('try1', [thr('t1', 'Err', 500)])]);
    const s = service('svc', [e]);
    const r = simulateEndpoint(e, s);
    expect(r.throws).toHaveLength(1);
    expect(r.throws[0].caught).toBe(true);
    // caught throw shouldn't appear in likelyResponses
    expect(r.likelyResponses.find(x => x.kind === 'throw')).toBeUndefined();
  });

  it('records external calls and respects failing-external toggle', () => {
    const e = endpoint('e1', [ext('ec1', 'POST', '/users')]);
    const s = service('svc', [e]);
    const r = simulateEndpoint(e, s, { toggles: { failingExternalIds: ['ec1'] } });
    expect(r.externals).toHaveLength(1);
    expect(r.externals[0].forcedFailure).toBe(true);
    // Forced failure injects a 502 throw
    const forced = r.throws.find(t => t.triggeredBy === 'external');
    expect(forced).toBeDefined();
    expect(forced!.httpStatus).toBe(502);
  });

  it('records db ops and respects failing-db toggle', () => {
    const e = endpoint('e1', [dbp('d1', 'find')]);
    const s = service('svc', [e]);
    const r = simulateEndpoint(e, s, { toggles: { failingDbIds: ['d1'] } });
    expect(r.dbOps).toHaveLength(1);
    expect(r.dbOps[0].forcedFailure).toBe(true);
    const forced = r.throws.find(t => t.triggeredBy === 'db');
    expect(forced).toBeDefined();
    expect(forced!.httpStatus).toBe(503);
  });

  it('records middlewares from endpoint metadata and respects failing-middleware toggle', () => {
    const e = endpoint('e1', [], {
      middleware: [
        { kind: 'guard', framework: 'nest', name: 'AuthGuard', order: 0 },
        { kind: 'pipe', framework: 'nest', name: 'ValidationPipe', order: 1 },
      ],
    });
    const s = service('svc', [e]);
    const r = simulateEndpoint(e, s, { toggles: { failingMiddleware: ['AuthGuard'] } });
    expect(r.middlewares).toHaveLength(2);
    const guard = r.middlewares.find(m => m.name === 'AuthGuard')!;
    expect(guard.forcedFailure).toBe(true);
    // 403 (guard) injected
    const forced = r.throws.find(t => t.triggeredBy === 'middleware');
    expect(forced).toBeDefined();
    expect(forced!.httpStatus).toBe(403);
  });

  it('expands transitively-reachable functions via call.metadata.resolvedTo', () => {
    const helper = fn('helper', [thr('t1', 'BadRequest', 400)]);
    const e = endpoint('e1', [call('c1', 'helper')]);
    const s = service('svc', [e], [helper]);
    const r = simulateEndpoint(e, s);
    expect(r.throws).toHaveLength(1);
    expect(r.throws[0].errorClass).toBe('BadRequest');
  });

  it('prevents infinite recursion for mutually-recursive functions', () => {
    const a = fn('fa', [call('cb', 'fb')]);
    const b = fn('fb', [call('ca', 'fa'), thr('t1', 'Boom', 500)]);
    const e = endpoint('e1', [call('c1', 'fa')]);
    const s = service('svc', [e], [a, b]);
    const r = simulateEndpoint(e, s);
    // Should still pick up the throw despite mutual recursion
    expect(r.throws.find(t => t.errorClass === 'Boom')).toBeDefined();
  });

  it('flags conditional vs unconditional returns', () => {
    const e = endpoint('e1', [
      ifNode('if1', [ret('r1', 200)]),
      ret('r2', 204),
    ]);
    const s = service('svc', [e]);
    const r = simulateEndpoint(e, s);
    expect(r.returns).toHaveLength(2);
    const conditional = r.returns.find(x => x.nodeId === 'r1');
    const unconditional = r.returns.find(x => x.nodeId === 'r2');
    expect(conditional!.conditional).toBe(true);
    expect(unconditional!.conditional).toBe(false);
    // likelyResponses only includes the unconditional return
    const likely = r.likelyResponses.filter(x => x.kind === 'return');
    expect(likely).toEqual([{ kind: 'return', httpStatus: 204 }]);
  });

  it('records branch points', () => {
    const e = endpoint('e1', [ifNode('if1', [ret('r1', 200)])]);
    const s = service('svc', [e]);
    const r = simulateEndpoint(e, s);
    expect(r.branches).toHaveLength(1);
    expect(r.branches[0]).toMatchObject({ nodeId: 'if1', kind: 'if' });
  });

  it('returns empty result for an empty endpoint', () => {
    const e = endpoint('e1', []);
    const s = service('svc', [e]);
    const r = simulateEndpoint(e, s);
    expect(r.throws).toHaveLength(0);
    expect(r.externals).toHaveLength(0);
    expect(r.dbOps).toHaveLength(0);
    expect(r.returns).toHaveLength(0);
    expect(r.likelyResponses).toEqual([]);
  });
});
