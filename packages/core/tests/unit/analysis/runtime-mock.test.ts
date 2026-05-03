import { describe, it, expect } from 'vitest';
import { generateMockRuntimeMetrics } from '../../../src/analysis/runtime-mock';
import type {
  SystemTopology, ServiceNode, EndpointNode, Edge,
} from '../../../src/types/topology';

function endpoint(id: string, method = 'GET', path = '/x'): EndpointNode {
  return {
    id, type: 'endpoint', name: id,
    location: { file: 'h.ts', line: 1, column: 0 },
    children: [],
    metadata: { method: method as any, path, request: {}, responses: [] },
  } as EndpointNode;
}

function service(
  id: string, kind?: string, tier?: string, eps: EndpointNode[] = [],
): ServiceNode {
  return {
    id, type: 'service', name: id, code: id,
    metadata: { kind: kind as any, tier: tier as any, language: 'typescript', framework: 'nestjs' },
    endpoints: eps, functions: [], globals: [], dependencies: [],
  } as ServiceNode;
}

function topology(services: ServiceNode[], edges: Edge[] = []): SystemTopology {
  return {
    schemaVersion: '3',
    metadata: { generatedAt: '2026-05-01T00:00:00Z', repoPath: '/t', toolVersion: 't' },
    services, databases: [], storages: [], brokers: [], edges,
  } as unknown as SystemTopology;
}

describe('runtime-mock provider', () => {
  it('is deterministic with the same seed', () => {
    const t = topology(
      [service('a', 'gateway'), service('b', 'backend', 'critical', [endpoint('e1')])],
      [{ source: 'a', target: 'b', kind: 'resolves_to' } as Edge],
    );
    const a = generateMockRuntimeMetrics(t, 'topo', { seed: 42, now: '2026-05-01T12:00:00Z' });
    const b = generateMockRuntimeMetrics(t, 'topo', { seed: 42, now: '2026-05-01T12:00:00Z' });
    expect(a).toEqual(b);
  });

  it('produces different values for different seeds', () => {
    const t = topology([service('a', 'gateway')]);
    const a = generateMockRuntimeMetrics(t, 'topo', { seed: 1, now: '2026-05-01T12:00:00Z' });
    const b = generateMockRuntimeMetrics(t, 'topo', { seed: 999, now: '2026-05-01T12:00:00Z' });
    expect(a.services[0].rps).not.toBe(b.services[0].rps);
  });

  it('emits one ServiceMetrics per service and one EndpointMetrics per endpoint', () => {
    const t = topology([
      service('a', 'gateway'),
      service('b', 'backend', 'standard', [endpoint('e1'), endpoint('e2', 'POST')]),
    ]);
    const r = generateMockRuntimeMetrics(t, 'topo', { seed: 7 });
    expect(r.services).toHaveLength(2);
    expect(r.endpoints).toHaveLength(2);
    expect(r.endpoints.map(e => e.endpointId).sort()).toEqual(['e1', 'e2']);
  });

  it('derives one EdgeMetrics for each resolves_to / depends_on edge only', () => {
    const t = topology(
      [service('a', 'gateway'), service('b', 'backend')],
      [
        { source: 'a', target: 'b', kind: 'resolves_to' } as Edge,
        { source: 'a', target: 'b', kind: 'depends_on' } as Edge,
        { source: 'a', target: 'b', kind: 'unrelated' } as Edge,
      ],
    );
    const r = generateMockRuntimeMetrics(t, 'topo', { seed: 5 });
    expect(r.edges).toHaveLength(2);
    expect(r.edges.every(e => e.kind === 'resolves_to' || e.kind === 'depends_on')).toBe(true);
  });

  it('biases RPS by service kind', () => {
    // Gateways should generally see >> traffic than workers given baseline.
    const t = topology([service('gw', 'gateway'), service('wk', 'worker')]);
    const r = generateMockRuntimeMetrics(t, 'topo', { seed: 11 });
    const gw = r.services.find(s => s.serviceId === 'gw')!;
    const wk = r.services.find(s => s.serviceId === 'wk')!;
    expect(gw.rps).toBeGreaterThan(wk.rps);
  });

  it('emits crit error_rate alerts when chaos pushes errors past 10%', () => {
    const t = topology([service('a', 'gateway'), service('b', 'backend')]);
    // chaos=50 → min errorRate 0.005 * 0.5 * 50 = 0.125 (above CRIT 0.10) for any seed/jitter
    const r = generateMockRuntimeMetrics(t, 'topo', { seed: 13, chaos: 50 });
    const crit = r.alerts.find(a => a.severity === 'crit' && a.kind === 'error_rate');
    expect(crit).toBeDefined();
  });

  it('window math: durationMs matches windowMs and from < to', () => {
    const t = topology([service('a')]);
    const r = generateMockRuntimeMetrics(t, 'topo', {
      seed: 1, now: '2026-05-01T12:00:00Z', windowMs: 60_000,
    });
    expect(r.window.durationMs).toBe(60_000);
    expect(r.window.toIso).toBe('2026-05-01T12:00:00.000Z');
    expect(r.window.fromIso).toBe('2026-05-01T11:59:00.000Z');
  });

  it('endpoint topStatuses always includes a success code', () => {
    const t = topology([service('a', 'backend', 'standard', [endpoint('e1', 'POST')])]);
    const r = generateMockRuntimeMetrics(t, 'topo', { seed: 3 });
    const ep = r.endpoints[0];
    expect(ep.topStatuses).toBeDefined();
    expect(ep.topStatuses!.some(s => s.code === 201)).toBe(true);
  });

  it('all metric fields stay within sane ranges', () => {
    const t = topology([
      service('gw', 'gateway'),
      service('be', 'backend', 'standard', [endpoint('e1'), endpoint('e2')]),
      service('wk', 'worker'),
    ]);
    const r = generateMockRuntimeMetrics(t, 'topo', { seed: 99 });
    for (const s of r.services) {
      expect(s.rps).toBeGreaterThanOrEqual(0);
      expect(s.errorRate).toBeGreaterThanOrEqual(0);
      expect(s.errorRate).toBeLessThanOrEqual(1);
      expect(s.p50LatencyMs).toBeGreaterThan(0);
      expect(s.p95LatencyMs).toBeGreaterThanOrEqual(s.p50LatencyMs);
    }
  });

  it('source is "mock"', () => {
    const t = topology([service('a')]);
    const r = generateMockRuntimeMetrics(t, 'topo', { seed: 1 });
    expect(r.source).toBe('mock');
    expect(r.topologyId).toBe('topo');
  });
});
