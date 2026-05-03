import { describe, it, expect } from 'vitest';
import { runTopologyQuery } from '../../../src/analysis/topology-query';
import type {
  SystemTopology, ServiceNode, EndpointNode, DatabaseNode, Edge,
  ThrowNode, ExternalCallNode, DbProcessNode, FunctionNode, CodeNode,
} from '../../../src/types/topology';

// ── Fixture helpers ─────────────────────────────────────────────────

function thr(id: string, errorClass: string, httpStatus?: number): ThrowNode {
  return {
    id, type: 'throw', name: errorClass,
    location: { file: 'h.ts', line: 1, column: 0 },
    children: [],
    metadata: { errorClass, httpStatus, message: '' },
  } as ThrowNode;
}

function extCall(id: string, opts: { mergeStatus?: string; method?: string; path?: string } = {}): ExternalCallNode {
  return {
    id, type: 'externalCall', name: 'ext',
    location: { file: 'c.ts', line: 1, column: 0 },
    children: [],
    metadata: {
      method: (opts.method ?? 'GET') as any,
      path: opts.path ?? '/x',
      httpClient: 'axios',
      mergeStatus: opts.mergeStatus,
    },
  } as ExternalCallNode;
}

function dbProc(id: string, db: string, table: string, op: string): DbProcessNode {
  return {
    id, type: 'dbProcess', name: `${op} ${table}`,
    location: { file: 'd.ts', line: 1, column: 0 },
    children: [],
    metadata: { database: db, table, operation: op },
  } as unknown as DbProcessNode;
}

function endpoint(
  id: string, method: string, path: string,
  children: CodeNode[] = [],
  meta: Partial<EndpointNode['metadata']> = {},
): EndpointNode {
  return {
    id, type: 'endpoint', name: id,
    location: { file: 'h.ts', line: 1, column: 0 },
    children,
    metadata: { method: method as any, path, request: {}, responses: [], ...meta },
  } as EndpointNode;
}

function service(
  id: string, name: string, endpoints: EndpointNode[],
  opts: {
    deps?: { id: string; targetKind: 'database' | 'external_http' }[];
    functions?: FunctionNode[];
  } = {},
): ServiceNode {
  return {
    id, type: 'service', name, code: id,
    metadata: { kind: 'service', language: 'typescript', framework: 'nestjs' },
    endpoints,
    functions: opts.functions ?? [],
    globals: [],
    dependencies: (opts.deps ?? []).map(d => ({
      id: d.id, name: d.id, targetKind: d.targetKind,
      callKind: 'sync' as const, critical: false,
    })),
  } as ServiceNode;
}

function database(id: string, name: string): DatabaseNode {
  return {
    id, type: 'database', name,
    metadata: { engine: 'postgresql', category: 'sql', connectionAlias: id },
  } as DatabaseNode;
}

function topology(
  services: ServiceNode[],
  databases: DatabaseNode[] = [],
  edges: Edge[] = [],
  ownership?: SystemTopology['ownership'],
): SystemTopology {
  return {
    schemaVersion: '3',
    metadata: { generatedAt: '2026-05-01T00:00:00Z', repoPath: '/t', toolVersion: 't' },
    services, databases, storages: [], brokers: [], edges, ownership,
  } as unknown as SystemTopology;
}

function resolvesEdge(source: string, targetService: string, targetCall = targetService): Edge {
  return { source, target: targetCall, kind: 'resolves_to', metadata: { targetServiceId: targetService } } as Edge;
}

// ── cycles ───────────────────────────────────────────────────────────

describe('topology-query / cycles', () => {
  it('returns no cycles when graph is acyclic', () => {
    const t = topology(
      [service('a', 'A', []), service('b', 'B', []), service('c', 'C', [])],
      [],
      [resolvesEdge('a', 'b'), resolvesEdge('b', 'c')],
    );
    const r = runTopologyQuery({ kind: 'cycles' }, t);
    expect(r.kind).toBe('cycles');
    if (r.kind === 'cycles') expect(r.cycles).toEqual([]);
  });

  it('detects a 2-node cycle', () => {
    const t = topology(
      [service('a', 'A', []), service('b', 'B', [])],
      [],
      [resolvesEdge('a', 'b'), resolvesEdge('b', 'a')],
    );
    const r = runTopologyQuery({ kind: 'cycles' }, t);
    if (r.kind !== 'cycles') throw new Error('wrong kind');
    expect(r.cycles).toHaveLength(1);
    expect(new Set(r.cycles[0])).toEqual(new Set(['a', 'b']));
  });

  it('detects a 3-node cycle and excludes the acyclic part', () => {
    const t = topology(
      [service('a', 'A', []), service('b', 'B', []), service('c', 'C', []), service('d', 'D', [])],
      [],
      [
        resolvesEdge('a', 'b'),
        resolvesEdge('b', 'c'),
        resolvesEdge('c', 'a'), // cycle a→b→c→a
        resolvesEdge('a', 'd'), // acyclic branch
      ],
    );
    const r = runTopologyQuery({ kind: 'cycles' }, t);
    if (r.kind !== 'cycles') throw new Error('wrong kind');
    expect(r.cycles).toHaveLength(1);
    expect(new Set(r.cycles[0])).toEqual(new Set(['a', 'b', 'c']));
  });
});

// ── orphan_services ──────────────────────────────────────────────────

describe('topology-query / orphan_services', () => {
  it('reports services with no incoming resolves_to', () => {
    const t = topology(
      [service('a', 'A', []), service('b', 'B', []), service('c', 'C', [])],
      [],
      [resolvesEdge('a', 'b')],
    );
    const r = runTopologyQuery({ kind: 'orphan_services' }, t);
    if (r.kind !== 'orphan_services') throw new Error('wrong kind');
    const ids = r.services.map(s => s.id).sort();
    expect(ids).toEqual(['a', 'c']);
  });
});

// ── endpoints_without_auth ───────────────────────────────────────────

describe('topology-query / endpoints_without_auth', () => {
  it('flags endpoints with no auth metadata', () => {
    const e1 = endpoint('e1', 'GET', '/public');
    const e2 = endpoint('e2', 'GET', '/private', [], { auth: 'jwt' } as any);
    const e3 = endpoint('e3', 'GET', '/none', [], { auth: 'none' } as any);
    const t = topology([service('s1', 'svc-1', [e1, e2, e3])]);
    const r = runTopologyQuery({ kind: 'endpoints_without_auth' }, t);
    if (r.kind !== 'endpoints_without_auth') throw new Error('wrong kind');
    const paths = r.endpoints.map(h => h.path).sort();
    expect(paths).toEqual(['/none', '/public']);
  });

  it('treats {required:false} as no auth', () => {
    const e1 = endpoint('e1', 'GET', '/x', [], { auth: { required: false } } as any);
    const t = topology([service('s1', 'svc-1', [e1])]);
    const r = runTopologyQuery({ kind: 'endpoints_without_auth' }, t);
    if (r.kind !== 'endpoints_without_auth') throw new Error('wrong kind');
    expect(r.endpoints).toHaveLength(1);
  });
});

// ── endpoints_throwing ───────────────────────────────────────────────

describe('topology-query / endpoints_throwing', () => {
  it('finds endpoints whose subtree contains a throw with the given status', () => {
    const e1 = endpoint('e1', 'GET', '/a', [thr('th1', 'Unauthorized', 401)]);
    const e2 = endpoint('e2', 'GET', '/b', [thr('th2', 'NotFound', 404)]);
    const e3 = endpoint('e3', 'GET', '/c', []);
    const t = topology([service('s1', 'svc-1', [e1, e2, e3])]);
    const r = runTopologyQuery({ kind: 'endpoints_throwing', status: 401 }, t);
    if (r.kind !== 'endpoints_throwing') throw new Error('wrong kind');
    expect(r.status).toBe(401);
    expect(r.endpoints.map(h => h.endpointId)).toEqual(['e1']);
  });
});

// ── services_using_database ─────────────────────────────────────────

describe('topology-query / services_using_database', () => {
  it('finds services with a dependency on the given database id', () => {
    const t = topology([
      service('a', 'A', [], { deps: [{ id: 'db-1', targetKind: 'database' }] }),
      service('b', 'B', [], { deps: [{ id: 'db-2', targetKind: 'database' }] }),
      service('c', 'C', [], { deps: [{ id: 'db-1', targetKind: 'database' }] }),
    ], [database('db-1', 'main'), database('db-2', 'cache')]);
    const r = runTopologyQuery({ kind: 'services_using_database', databaseId: 'db-1' }, t);
    if (r.kind !== 'services_using_database') throw new Error('wrong kind');
    expect(r.services.map(s => s.id).sort()).toEqual(['a', 'c']);
  });
});

// ── services_without_owners ─────────────────────────────────────────

describe('topology-query / services_without_owners', () => {
  it('reports services not present in ownership.edges', () => {
    const t = topology(
      [service('a', 'A', []), service('b', 'B', []), service('c', 'C', [])],
      [], [],
      {
        owners: [{ id: 'o1', name: '@team', metadata: { kind: 'team' } } as any],
        edges: [
          { ownerId: 'o1', targetId: 'a', targetKind: 'service' } as any,
        ],
      } as any,
    );
    const r = runTopologyQuery({ kind: 'services_without_owners' }, t);
    if (r.kind !== 'services_without_owners') throw new Error('wrong kind');
    expect(r.services.map(s => s.id).sort()).toEqual(['b', 'c']);
  });

  it('reports all services when topology has no ownership', () => {
    const t = topology([service('a', 'A', []), service('b', 'B', [])]);
    const r = runTopologyQuery({ kind: 'services_without_owners' }, t);
    if (r.kind !== 'services_without_owners') throw new Error('wrong kind');
    expect(r.services).toHaveLength(2);
  });
});

// ── unresolved_external_calls ───────────────────────────────────────

describe('topology-query / unresolved_external_calls', () => {
  it('reports external calls that are not resolved', () => {
    const e1 = endpoint('e1', 'GET', '/x', [
      extCall('ec-1', { mergeStatus: 'resolved' }),
      extCall('ec-2', { mergeStatus: 'unresolvable' }),
      extCall('ec-3'), // no mergeStatus → unknown
    ]);
    const t = topology([service('s1', 'svc-1', [e1])]);
    const r = runTopologyQuery({ kind: 'unresolved_external_calls' }, t);
    if (r.kind !== 'unresolved_external_calls') throw new Error('wrong kind');
    const ids = r.calls.map(c => c.externalCallId).sort();
    expect(ids).toEqual(['ec-2', 'ec-3']);
  });
});

// ── duplicate_db_operations ─────────────────────────────────────────

describe('topology-query / duplicate_db_operations', () => {
  it('groups same (db, table, op) across services', () => {
    const e1 = endpoint('e1', 'POST', '/users', [dbProc('p1', 'main', 'users', 'insert')]);
    const e2 = endpoint('e2', 'POST', '/admin/users', [dbProc('p2', 'main', 'users', 'insert')]);
    const e3 = endpoint('e3', 'GET', '/products', [dbProc('p3', 'main', 'products', 'select')]);
    const t = topology([
      service('a', 'A', [e1]),
      service('b', 'B', [e2]),
      service('c', 'C', [e3]),
    ]);
    const r = runTopologyQuery({ kind: 'duplicate_db_operations' }, t);
    if (r.kind !== 'duplicate_db_operations') throw new Error('wrong kind');
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]).toMatchObject({ database: 'main', table: 'users', operation: 'insert' });
    expect(r.duplicates[0].occurrences.map(o => o.serviceId).sort()).toEqual(['a', 'b']);
  });

  it('does not flag duplicates inside the same service', () => {
    const e1 = endpoint('e1', 'POST', '/a', [dbProc('p1', 'main', 'users', 'insert')]);
    const e2 = endpoint('e2', 'POST', '/b', [dbProc('p2', 'main', 'users', 'insert')]);
    const t = topology([service('s1', 'svc-1', [e1, e2])]);
    const r = runTopologyQuery({ kind: 'duplicate_db_operations' }, t);
    if (r.kind !== 'duplicate_db_operations') throw new Error('wrong kind');
    expect(r.duplicates).toEqual([]);
  });
});
