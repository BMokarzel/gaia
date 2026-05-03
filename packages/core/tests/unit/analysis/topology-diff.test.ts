import { describe, it, expect } from 'vitest';
import { computeTopologyDiff } from '../../../src/analysis/topology-diff';
import type {
  SystemTopology, ServiceNode, EndpointNode, FunctionNode,
  ThrowNode, ExternalCallNode, DatabaseNode, Edge,
} from '../../../src/types/topology';

// ── Fixture helpers (kept local — independent of doc-generator tests) ──

function thr(id: string, errorClass: string, httpStatus?: number): ThrowNode {
  return {
    id,
    type: 'throw',
    name: errorClass,
    location: { file: 'h.ts', line: 1, column: 0 },
    children: [],
    metadata: { errorClass, httpStatus, message: '' },
  } as ThrowNode;
}

function extCall(id: string, opts: { resolvedEndpointId?: string; method?: string; path?: string } = {}): ExternalCallNode {
  return {
    id,
    type: 'externalCall',
    name: 'ext',
    location: { file: 'c.ts', line: 1, column: 0 },
    children: [],
    metadata: {
      method: (opts.method ?? 'GET') as any,
      path: opts.path ?? '/x',
      httpClient: 'axios',
      resolvedEndpointId: opts.resolvedEndpointId,
    },
  } as ExternalCallNode;
}

function endpoint(
  id: string, method: string, path: string,
  children: any[] = [],
): EndpointNode {
  return {
    id,
    type: 'endpoint',
    name: id,
    location: { file: 'h.ts', line: 1, column: 0 },
    children,
    metadata: { method: method as any, path, request: {}, responses: [] },
  } as EndpointNode;
}

function service(
  id: string, name: string, endpoints: EndpointNode[],
  opts: {
    language?: string; framework?: string; team?: string;
    deps?: { id: string; targetKind: 'database' | 'external_http' }[];
    functions?: FunctionNode[];
  } = {},
): ServiceNode {
  return {
    id,
    type: 'service',
    name,
    code: id,
    metadata: {
      kind: 'service',
      language: opts.language ?? 'typescript',
      framework: opts.framework ?? 'nestjs',
      team: opts.team,
    },
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
): SystemTopology {
  return {
    schemaVersion: '3',
    metadata: { generatedAt: '2026-05-01T00:00:00Z', repoPath: '/t', toolVersion: 't' },
    services,
    databases,
    storages: [],
    brokers: [],
    edges,
  } as unknown as SystemTopology;
}

// ────────────────────────────────────────────────────────────────────

describe('computeTopologyDiff — services', () => {
  it('reports empty diff for identical topologies', () => {
    const a = topology([service('s1', 'svc-1', [endpoint('e1', 'GET', '/x')])]);
    const b = topology([service('s1', 'svc-1', [endpoint('e1', 'GET', '/x')])]);
    const diff = computeTopologyDiff(a, b, { fromSha: 'a', toSha: 'b' });
    expect(diff.services.added).toEqual([]);
    expect(diff.services.removed).toEqual([]);
    expect(diff.services.modified).toEqual([]);
    expect(diff.summary.totalChanges).toBe(0);
  });

  it('detects added and removed services', () => {
    const a = topology([service('s1', 'svc-1', [])]);
    const b = topology([service('s2', 'svc-2', [])]);
    const diff = computeTopologyDiff(a, b, { fromSha: 'a', toSha: 'b' });
    expect(diff.services.added).toEqual([{ id: 's2', name: 'svc-2' }]);
    expect(diff.services.removed).toEqual([{ id: 's1', name: 'svc-1' }]);
    expect(diff.summary.servicesAdded).toBe(1);
    expect(diff.summary.servicesRemoved).toBe(1);
  });

  it('detects service metadata changes (language, framework, team, name)', () => {
    const a = topology([service('s1', 'svc-1', [], { language: 'typescript', framework: 'nestjs', team: 'platform' })]);
    const b = topology([service('s1', 'svc-renamed', [], { language: 'go', framework: 'gin', team: 'core' })]);
    const diff = computeTopologyDiff(a, b, { fromSha: 'a', toSha: 'b' });
    expect(diff.services.modified).toHaveLength(1);
    const changes = diff.services.modified[0].changes;
    expect(changes.some(c => c.startsWith('language:'))).toBe(true);
    expect(changes.some(c => c.startsWith('framework:'))).toBe(true);
    expect(changes.some(c => c.startsWith('team:'))).toBe(true);
    expect(changes.some(c => c.startsWith('name:'))).toBe(true);
  });
});

describe('computeTopologyDiff — endpoints', () => {
  it('detects added/removed endpoints within a service', () => {
    const a = topology([service('s1', 'svc-1', [endpoint('e1', 'GET', '/x')])]);
    const b = topology([service('s1', 'svc-1', [endpoint('e1', 'GET', '/x'), endpoint('e2', 'POST', '/y')])]);
    const diff = computeTopologyDiff(a, b, { fromSha: 'a', toSha: 'b' });
    expect(diff.services.modified).toHaveLength(1);
    const m = diff.services.modified[0];
    expect(m.endpoints.added).toEqual([{ id: 'e2', method: 'POST', path: '/y' }]);
    expect(m.endpoints.removed).toEqual([]);
    expect(diff.summary.endpointsAdded).toBe(1);
  });

  it('detects path/method changes', () => {
    const a = topology([service('s1', 'svc-1', [endpoint('e1', 'GET', '/x')])]);
    const b = topology([service('s1', 'svc-1', [endpoint('e1', 'POST', '/y')])]);
    const diff = computeTopologyDiff(a, b, { fromSha: 'a', toSha: 'b' });
    const mod = diff.services.modified[0].endpoints.modified[0];
    expect(mod.changes).toContain('method: GET → POST');
    expect(mod.changes).toContain('path: /x → /y');
  });

  it('detects new throw status codes', () => {
    const a = topology([service('s1', 'svc-1', [endpoint('e1', 'GET', '/x', [thr('t1', 'NotFound', 404)])])]);
    const b = topology([service('s1', 'svc-1', [endpoint('e1', 'GET', '/x', [thr('t1', 'NotFound', 404), thr('t2', 'Unauthorized', 401)])])]);
    const diff = computeTopologyDiff(a, b, { fromSha: 'a', toSha: 'b' });
    const mod = diff.services.modified[0].endpoints.modified[0];
    expect(mod.changes.some(c => c.startsWith('throws:') && c.includes('+[401]'))).toBe(true);
  });

  it('detects new external call targets', () => {
    const a = topology([service('s1', 'svc-1', [
      endpoint('e1', 'GET', '/x', [extCall('c1', { resolvedEndpointId: 'svc-2:get-y' })]),
    ])]);
    const b = topology([service('s1', 'svc-1', [
      endpoint('e1', 'GET', '/x', [
        extCall('c1', { resolvedEndpointId: 'svc-2:get-y' }),
        extCall('c2', { resolvedEndpointId: 'svc-3:post-z' }),
      ]),
    ])]);
    const diff = computeTopologyDiff(a, b, { fromSha: 'a', toSha: 'b' });
    const mod = diff.services.modified[0].endpoints.modified[0];
    expect(mod.changes.some(c => c.startsWith('externals:') && c.includes('+[svc-3:post-z]'))).toBe(true);
  });
});

describe('computeTopologyDiff — databases & edges', () => {
  it('detects database additions/removals at the topology level', () => {
    const a = topology([service('s1', 'svc-1', [])], [database('db-pg', 'users')]);
    const b = topology([service('s1', 'svc-1', [])], [database('db-redis', 'cache')]);
    const diff = computeTopologyDiff(a, b, { fromSha: 'a', toSha: 'b' });
    expect(diff.databases.added).toEqual([{ id: 'db-redis', name: 'cache' }]);
    expect(diff.databases.removed).toEqual([{ id: 'db-pg', name: 'users' }]);
  });

  it('detects service-level database dependency changes', () => {
    const a = topology([service('s1', 'svc-1', [], { deps: [{ id: 'db-pg', targetKind: 'database' }] })]);
    const b = topology([service('s1', 'svc-1', [], { deps: [{ id: 'db-pg', targetKind: 'database' }, { id: 'db-redis', targetKind: 'database' }] })]);
    const diff = computeTopologyDiff(a, b, { fromSha: 'a', toSha: 'b' });
    expect(diff.services.modified[0].databases.added).toEqual(['db-redis']);
    expect(diff.services.modified[0].databases.removed).toEqual([]);
  });

  it('detects edge additions/removals', () => {
    const e: Edge = { source: 's1', target: 's2', kind: 'resolves_to' };
    const a = topology([service('s1', 'svc-1', []), service('s2', 'svc-2', [])], [], []);
    const b = topology([service('s1', 'svc-1', []), service('s2', 'svc-2', [])], [], [e]);
    const diff = computeTopologyDiff(a, b, { fromSha: 'a', toSha: 'b' });
    expect(diff.edges.added).toEqual([{ source: 's1', target: 's2', kind: 'resolves_to' }]);
    expect(diff.edges.removed).toEqual([]);
  });
});

describe('computeTopologyDiff — meta passthrough', () => {
  it('echoes provided sha and analyzedAt timestamps', () => {
    const a = topology([]); const b = topology([]);
    const diff = computeTopologyDiff(a, b, {
      fromSha: 'aaa', toSha: 'bbb',
      fromAnalyzedAt: '2026-05-01T00:00:00Z',
      toAnalyzedAt:   '2026-05-02T00:00:00Z',
    });
    expect(diff.from).toEqual({ sha: 'aaa', analyzedAt: '2026-05-01T00:00:00Z' });
    expect(diff.to).toEqual({ sha: 'bbb', analyzedAt: '2026-05-02T00:00:00Z' });
  });
});
