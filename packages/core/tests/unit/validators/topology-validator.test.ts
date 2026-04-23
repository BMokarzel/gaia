import { describe, it, expect } from 'vitest';
import { validateTopology } from '../../../src/analysis/topology-validator';
import type {
  SystemTopology, ServiceNode, EndpointNode, FunctionNode,
  DatabaseNode, BrokerNode, Edge, ReturnNode, ThrowNode,
  FlowControlNode, DbProcessNode,
} from '../../../src/types/topology';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTopology(partial: Partial<SystemTopology> = {}): SystemTopology {
  return {
    schemaVersion: '3.0.0',
    analyzedAt: new Date().toISOString(),
    services: [],
    databases: [],
    storages: [],
    brokers: [],
    screens: [],
    edges: [],
    errorFlow: { paths: [], globalHandlers: [] },
    observability: {
      logs: [],
      telemetry: [],
      coverage: {
        endpointsWithTracing: 0, endpointsTotal: 0,
        dbQueriesWithSpans: 0, dbQueriesTotal: 0,
        errorsWithLogging: 0, errorsTotal: 0,
        screensWithAnalytics: 0, screensTotal: 0,
      },
    },
    diagnostics: [],
    ...partial,
  };
}

function makeService(partial: Partial<ServiceNode> = {}): ServiceNode {
  return {
    id: 'svc:test',
    type: 'service',
    name: 'TestService',
    code: 'TST',
    metadata: {},
    endpoints: [],
    functions: [],
    globals: [],
    dependencies: [],
    ...partial,
  };
}

function makeEndpoint(partial: Partial<EndpointNode> = {}): EndpointNode {
  return {
    id: 'ep:test',
    type: 'endpoint',
    name: 'getTest',
    location: { file: 'test.ts', line: 1, column: 0 },
    children: [],
    metadata: {
      method: 'GET',
      path: '/test',
      request: {},
      responses: [],
    },
    ...partial,
  };
}

function makeReturn(partial: Partial<ReturnNode> = {}): ReturnNode {
  return {
    id: 'ret:1',
    type: 'return',
    name: 'return',
    location: { file: 'test.ts', line: 5, column: 0 },
    children: [],
    metadata: { kind: 'explicit', httpStatus: 200 },
    ...partial,
  };
}

function makeDb(partial: Partial<DatabaseNode> = {}): DatabaseNode {
  return {
    id: 'db:test',
    type: 'database',
    name: 'TestDB',
    metadata: {
      engine: 'postgresql',
      category: 'sql',
      connectionAlias: 'default',
    },
    tables: [],
    ...partial,
  };
}

// ── Layer 1: Schema ───────────────────────────────────────────────────────────

describe('Layer 1 — Schema validation', () => {
  it('passes for a minimal valid topology', () => {
    const topology = makeTopology({ services: [makeService()] });
    const diags = validateTopology(topology);
    const errors = diags.filter(d => d.level === 'error');
    expect(errors).toHaveLength(0);
  });

  it('reports error for service missing name', () => {
    const svc = makeService({ name: '' });
    const topology = makeTopology({ services: [svc] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.level === 'error' && d.message.includes('missing name'))).toBe(true);
  });

  it('reports warning for service missing code (sigla)', () => {
    const svc = makeService({ code: '' });
    const topology = makeTopology({ services: [svc] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.message.includes('missing code'))).toBe(true);
  });

  it('reports warning when frontend service has endpoints', () => {
    const ep = makeEndpoint();
    const svc = makeService({ metadata: { kind: 'frontend' }, endpoints: [ep] });
    const topology = makeTopology({ services: [svc] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.message.includes('frontend') && d.message.includes('endpoint'))).toBe(true);
  });

  it('reports error for endpoint missing method', () => {
    const ep = makeEndpoint({ metadata: { method: '' as any, path: '/test', request: {}, responses: [] } });
    const svc = makeService({ endpoints: [ep] });
    const topology = makeTopology({ services: [svc] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.level === 'error' && d.message.includes('missing method'))).toBe(true);
  });

  it('reports error for endpoint with invalid method', () => {
    const ep = makeEndpoint({ metadata: { method: 'INVALID' as any, path: '/test', request: {}, responses: [] } });
    const svc = makeService({ endpoints: [ep] });
    const topology = makeTopology({ services: [svc] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.level === 'error' && d.message.includes('invalid method'))).toBe(true);
  });

  it('reports error for endpoint missing path', () => {
    const ep = makeEndpoint({ metadata: { method: 'GET', path: '', request: {}, responses: [] } });
    const svc = makeService({ endpoints: [ep] });
    const topology = makeTopology({ services: [svc] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.level === 'error' && d.message.includes('missing path'))).toBe(true);
  });

  it('reports error for database missing engine', () => {
    const db = makeDb({ metadata: { engine: '' as any, category: 'sql', connectionAlias: 'default' } });
    const topology = makeTopology({ databases: [db] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.level === 'error' && d.message.includes('missing engine'))).toBe(true);
  });

  it('reports error for database missing connectionAlias', () => {
    const db = makeDb({ metadata: { engine: 'postgresql', category: 'sql', connectionAlias: '' } });
    const topology = makeTopology({ databases: [db] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.level === 'error' && d.message.includes('missing connectionAlias'))).toBe(true);
  });
});

// ── Layer 2: Graph integrity ──────────────────────────────────────────────────

describe('Layer 2 — Graph integrity', () => {
  it('reports warning for edge with unknown source', () => {
    const svc = makeService();
    const edge: Edge = { source: 'nonexistent:123', target: svc.id, kind: 'calls' };
    const topology = makeTopology({ services: [svc], edges: [edge] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.message.includes('not found in topology node index') && d.message.includes('nonexistent:123'))).toBe(true);
  });

  it('reports warning for edge with unknown target', () => {
    const svc = makeService();
    const edge: Edge = { source: svc.id, target: 'nonexistent:456', kind: 'calls' };
    const topology = makeTopology({ services: [svc], edges: [edge] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.message.includes('not found in topology node index') && d.message.includes('nonexistent:456'))).toBe(true);
  });

  it('reports warning for self-loop edge', () => {
    const svc = makeService();
    const edge: Edge = { source: svc.id, target: svc.id, kind: 'calls' };
    const topology = makeTopology({ services: [svc], edges: [edge] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.message.includes('Self-loop'))).toBe(true);
  });

  it('reports info for duplicate edges', () => {
    const svc1 = makeService({ id: 'svc:a', name: 'A' });
    const svc2 = makeService({ id: 'svc:b', name: 'B' });
    const edge: Edge = { source: 'svc:a', target: 'svc:b', kind: 'calls' };
    const topology = makeTopology({ services: [svc1, svc2], edges: [edge, edge] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.level === 'info' && d.message.includes('Duplicate edge'))).toBe(true);
  });

  it('reports info for reads_from/writes_to edge missing operation', () => {
    const svc = makeService({ id: 'svc:a', name: 'A' });
    const db = makeDb();
    const edge: Edge = { source: 'svc:a', target: 'db:test', kind: 'reads_from', metadata: {} };
    const topology = makeTopology({ services: [svc], databases: [db], edges: [edge] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.message.includes('missing metadata.operation'))).toBe(true);
  });

  it('passes valid edges between known nodes', () => {
    const svc1 = makeService({ id: 'svc:a', name: 'A' });
    const svc2 = makeService({ id: 'svc:b', name: 'B' });
    const edge: Edge = { source: 'svc:a', target: 'svc:b', kind: 'depends_on' };
    const topology = makeTopology({ services: [svc1, svc2], edges: [edge] });
    const diags = validateTopology(topology);
    // No referential integrity errors
    expect(diags.filter(d => d.message.includes('not found in topology node index'))).toHaveLength(0);
  });

  it('reports info for endpoint with no outgoing edges', () => {
    const ep = makeEndpoint({ id: 'ep:1', children: [makeReturn()] });
    const svc = makeService({ endpoints: [ep] });
    const topology = makeTopology({ services: [svc], edges: [] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.level === 'info' && d.message.includes('no outgoing edges'))).toBe(true);
  });

  it('does not flag endpoint when it has outgoing edges', () => {
    const ep = makeEndpoint({ id: 'ep:1', children: [makeReturn()] });
    const svc = makeService({ id: 'svc:1', endpoints: [ep] });
    const svc2 = makeService({ id: 'svc:2', name: 'OtherSvc' });
    const edge: Edge = { source: 'ep:1', target: 'svc:2', kind: 'calls' };
    const topology = makeTopology({ services: [svc, svc2], edges: [edge] });
    const diags = validateTopology(topology);
    expect(diags.filter(d => d.level === 'info' && d.message.includes('ep:1') && d.message.includes('no outgoing'))).toHaveLength(0);
  });
});

// ── Layer 3: Flow graph ───────────────────────────────────────────────────────

describe('Layer 3 — Flow graph validation', () => {
  it('passes for endpoint with return node', () => {
    const ret = makeReturn();
    const ep = makeEndpoint({ id: 'ep:1', children: [ret] });
    const svc = makeService({ endpoints: [ep] });
    const topology = makeTopology({ services: [svc] });
    const diags = validateTopology(topology);
    expect(diags.filter(d => d.message.includes('no return or throw nodes'))).toHaveLength(0);
  });

  it('passes for endpoint with throw node', () => {
    const thr: ThrowNode = {
      id: 'thr:1', type: 'throw', name: 'throw',
      location: { file: 'test.ts', line: 3, column: 0 },
      children: [],
      metadata: { kind: 'throw', errorClass: 'Error', propagates: true },
    };
    const ep = makeEndpoint({ id: 'ep:1', children: [thr] });
    const svc = makeService({ endpoints: [ep] });
    const topology = makeTopology({ services: [svc] });
    const diags = validateTopology(topology);
    expect(diags.filter(d => d.message.includes('no return or throw nodes'))).toHaveLength(0);
  });

  it('warns for endpoint whose only leaf is a call node (no termination)', () => {
    const callNode = {
      id: 'call:1', type: 'call' as const, name: 'doSomething',
      location: { file: 'test.ts', line: 2, column: 0 },
      children: [],
      metadata: { callee: 'service.doSomething', arguments: [], awaited: true, chained: false, optional: false },
    };
    const ep = makeEndpoint({ id: 'ep:1', children: [callNode] });
    const svc = makeService({ endpoints: [ep] });
    const topology = makeTopology({ services: [svc] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.message.includes('no return or throw nodes'))).toBe(true);
  });

  it('passes for endpoint with no children (stub — not flagged as flow issue)', () => {
    const ep = makeEndpoint({ id: 'ep:1', children: [] });
    const svc = makeService({ endpoints: [ep] });
    const topology = makeTopology({ services: [svc] });
    const diags = validateTopology(topology);
    // Flow check skips empty endpoints; no "no return or throw" warning
    expect(diags.filter(d => d.message.includes('no return or throw nodes'))).toHaveLength(0);
  });

  it('passes when return is inside a flowControl branch', () => {
    const ret = makeReturn({ id: 'ret:inner' });
    const fc: FlowControlNode = {
      id: 'fc:1', type: 'flowControl', name: 'if',
      location: { file: 'test.ts', line: 2, column: 0 },
      children: [ret],
      metadata: { kind: 'if', condition: 'x > 0' },
    };
    const ep = makeEndpoint({ id: 'ep:1', children: [fc] });
    const svc = makeService({ endpoints: [ep] });
    const topology = makeTopology({ services: [svc] });
    const diags = validateTopology(topology);
    expect(diags.filter(d => d.message.includes('no return or throw nodes'))).toHaveLength(0);
  });

  it('detects try block without catch', () => {
    const tryBlock: FlowControlNode = {
      id: 'fc:try', type: 'flowControl', name: 'try',
      location: { file: 'test.ts', line: 2, column: 0 },
      children: [makeReturn()],
      metadata: { kind: 'try' },
    };
    const ep = makeEndpoint({ id: 'ep:1', children: [tryBlock] });
    const svc = makeService({ endpoints: [ep] });
    const topology = makeTopology({ services: [svc] });
    const diags = validateTopology(topology);
    expect(diags.some(d => d.message.includes('no corresponding catch'))).toBe(true);
  });

  it('passes for try block with catch as sibling', () => {
    const ret = makeReturn({ id: 'ret:try' });
    const tryBlock: FlowControlNode = {
      id: 'fc:try', type: 'flowControl', name: 'try',
      location: { file: 'test.ts', line: 2, column: 0 },
      children: [ret],
      metadata: { kind: 'try' },
    };
    const catchBlock: FlowControlNode = {
      id: 'fc:catch', type: 'flowControl', name: 'catch',
      location: { file: 'test.ts', line: 5, column: 0 },
      children: [],
      metadata: { kind: 'catch' },
    };
    const ep = makeEndpoint({ id: 'ep:1', children: [tryBlock, catchBlock] });
    const svc = makeService({ endpoints: [ep] });
    const topology = makeTopology({ services: [svc] });
    const diags = validateTopology(topology);
    expect(diags.filter(d => d.message.includes('no corresponding catch'))).toHaveLength(0);
  });
});
