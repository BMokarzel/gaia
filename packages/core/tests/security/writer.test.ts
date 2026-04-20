import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeTopology } from '../../src/output/writer';
import type { SystemTopology } from '../../src/types/topology';

function minimalTopology(): SystemTopology {
  return {
    version: '3',
    generatedAt: new Date().toISOString(),
    repoPath: '/tmp',
    services: [],
    databases: [],
    brokers: [],
    storages: [],
    screens: [],
    edges: [],
    diagnostics: [],
    observability: { coverage: { endpointsWithTracing: 0, endpointsTotal: 0, dbQueriesWithSpans: 0, dbQueriesTotal: 0 } },
  } as unknown as SystemTopology;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gaia-writer-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('writeTopology — output path containment', () => {
  it('writes inside repo path by default', () => {
    const path = writeTopology(minimalTopology(), tmpDir);
    expect(path.startsWith(tmpDir)).toBe(true);
  });

  it('throws when outputPath escapes repo root and cwd', () => {
    const outsidePath = join(tmpdir(), `gaia-escape-${Date.now()}.json`);
    expect(() => writeTopology(minimalTopology(), tmpDir, { outputPath: outsidePath }))
      .toThrow('outside the repository root');
  });

  it('allows outputPath within repo subdir', () => {
    const subPath = join(tmpDir, 'output', 'topology.json');
    expect(() => writeTopology(minimalTopology(), tmpDir, { outputPath: subPath }))
      .not.toThrow();
  });
});
