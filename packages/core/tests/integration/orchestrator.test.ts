import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { analyzeRepository } from '../../src/core/orchestrator';
import type { SystemTopology } from '../../src/types/topology';

const FIXTURES_DIR = join(__dirname, '../fixtures');

function assertValidTopology(topology: SystemTopology, fixtureName: string): void {
  expect(topology, `${fixtureName}: topology should be defined`).toBeDefined();
  expect(Array.isArray(topology.services), `${fixtureName}: services should be an array`).toBe(true);
  expect(Array.isArray(topology.databases), `${fixtureName}: databases should be an array`).toBe(true);
  expect(Array.isArray(topology.brokers), `${fixtureName}: brokers should be an array`).toBe(true);
  expect(Array.isArray(topology.edges), `${fixtureName}: edges should be an array`).toBe(true);

  // No duplicate node IDs across the entire topology
  const allIds: string[] = [
    ...topology.services.map(s => s.id),
    ...topology.databases.map(d => d.id),
    ...topology.brokers.map(b => b.id),
  ];
  const idSet = new Set(allIds);
  expect(idSet.size, `${fixtureName}: duplicate top-level IDs found`).toBe(allIds.length);

  // All edge source/target IDs must reference existing nodes
  const nodeIds = new Set<string>(allIds);
  for (const service of topology.services) {
    for (const node of [
      ...service.endpoints,
      ...service.functions,
      ...(service.globals ?? []),
    ]) {
      nodeIds.add(node.id);
    }
  }

  for (const edge of topology.edges) {
    expect(nodeIds.has(edge.source), `${fixtureName}: edge source "${edge.source}" not found`).toBe(true);
    expect(nodeIds.has(edge.target), `${fixtureName}: edge target "${edge.target}" not found`).toBe(true);
  }
}

describe('analyzeRepository — fixtures', () => {
  it('analyzes express TypeScript fixture without crashing', async () => {
    const topology = await analyzeRepository(join(FIXTURES_DIR, 'ts/express-app'), {
      skipTests: true,
      onProgress: () => {},
    });
    assertValidTopology(topology, 'ts/express-app');
    expect(topology.services.length).toBeGreaterThanOrEqual(1);
  });

  it('analyzes NestJS TypeScript fixture without crashing', async () => {
    const topology = await analyzeRepository(join(FIXTURES_DIR, 'ts/nest-app'), {
      skipTests: true,
      onProgress: () => {},
    });
    assertValidTopology(topology, 'ts/nest-app');
    expect(topology.services.length).toBeGreaterThanOrEqual(1);
  });

  it('analyzes Go chi fixture without crashing', async () => {
    const topology = await analyzeRepository(join(FIXTURES_DIR, 'go/chi-app'), {
      skipTests: true,
      onProgress: () => {},
    });
    assertValidTopology(topology, 'go/chi-app');
    expect(topology.services.length).toBeGreaterThanOrEqual(1);
  });

  it('analyzes Java Spring fixture without crashing', async () => {
    const topology = await analyzeRepository(join(FIXTURES_DIR, 'java/spring-app'), {
      skipTests: true,
      onProgress: () => {},
    });
    assertValidTopology(topology, 'java/spring-app');
    expect(topology.services.length).toBeGreaterThanOrEqual(1);
  });

  it('analyzes Python FastAPI fixture without crashing', async () => {
    const topology = await analyzeRepository(join(FIXTURES_DIR, 'python/fastapi-app'), {
      skipTests: true,
      onProgress: () => {},
    });
    assertValidTopology(topology, 'python/fastapi-app');
    expect(topology.services.length).toBeGreaterThanOrEqual(1);
  });

  it('completes analysis of express fixture under 30 seconds', async () => {
    const start = Date.now();
    await analyzeRepository(join(FIXTURES_DIR, 'ts/express-app'), { onProgress: () => {} });
    expect(Date.now() - start).toBeLessThan(30_000);
  });

  it('handles non-existent path gracefully (returns empty topology or throws cleanly)', async () => {
    try {
      const topology = await analyzeRepository('/tmp/gaia-nonexistent-' + Date.now(), {
        onProgress: () => {},
      });
      // If it doesn't throw, topology should still be a valid structure
      expect(topology).toBeDefined();
      expect(Array.isArray(topology.services)).toBe(true);
    } catch (err) {
      // A clean Error is acceptable
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('topology services have the required shape', async () => {
    const topology = await analyzeRepository(join(FIXTURES_DIR, 'ts/express-app'), {
      onProgress: () => {},
    });
    for (const service of topology.services) {
      expect(typeof service.id).toBe('string');
      expect(service.id.length).toBeGreaterThan(0);
      expect(typeof service.name).toBe('string');
      expect(service.type).toBe('service');
      expect(Array.isArray(service.endpoints)).toBe(true);
      expect(Array.isArray(service.functions)).toBe(true);
      expect(Array.isArray(service.globals)).toBe(true);
      expect(Array.isArray(service.dependencies)).toBe(true);
    }
  });
});
