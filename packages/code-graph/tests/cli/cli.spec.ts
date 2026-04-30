import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { isTsParserAvailable } from '../../src';

const PARSER_OK = isTsParserAvailable();
const CLI = join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
const FIX_DIR = join(__dirname, '..', 'fixtures', 'api');
const CLI_BUILT = existsSync(CLI);

let tmpDir: string;
let graphFile: string;

function run(...args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? 1 };
}

beforeAll(() => {
  if (!PARSER_OK || !CLI_BUILT) return;
  tmpDir = mkdtempSync(join(tmpdir(), 'code-graph-cli-'));
  graphFile = join(tmpDir, 'graph.json');
});

afterAll(() => {
  if (tmpDir) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe.skipIf(!PARSER_OK || !CLI_BUILT)('CLI — extract/validate/query (smoke)', () => {
  it('extract: gera graph.json válido a partir do fixture api/', () => {
    const r = run('extract', FIX_DIR, '--out', graphFile, '--quiet');
    expect(r.status).toBe(0);
    expect(existsSync(graphFile)).toBe(true);
    const json = JSON.parse(readFileSync(graphFile, 'utf8'));
    expect(json.graphSchemaVersion).toBeTruthy();
    expect(Array.isArray(json.elements)).toBe(true);
    expect(json.elements.length).toBeGreaterThan(0);
    expect(Array.isArray(json.edges)).toBe(true);
  });

  it('validate: aceita graph.json gerado', () => {
    const r = run('validate', graphFile);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.ok).toBe(true);
    expect(out.elements).toBeGreaterThan(0);
  });

  it('query stats: retorna counts por kind', () => {
    const r = run('query', graphFile, 'stats');
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.byKind.class).toBeGreaterThanOrEqual(3);
    expect(out.byKind.method).toBeGreaterThanOrEqual(1);
  });

  it('query find + flow-tree: chain createUser → save', () => {
    const find = run('query', graphFile, 'find', 'createUser');
    expect(find.status).toBe(0);
    const matches = JSON.parse(find.stdout);
    const m = matches.find((x: { name: string }) => x.name === 'createUser');
    expect(m).toBeDefined();

    const flow = run('query', graphFile, 'flow-tree', m.id, '--max-depth', '8');
    expect(flow.status).toBe(0);
    const tree = JSON.parse(flow.stdout);
    expect(tree.stats.totalNodes).toBeGreaterThan(0);

    // a chain de chamadas tem que aparecer no JSON serializado
    const text = JSON.stringify(tree);
    expect(text).toContain('save');
    expect(text).toContain('create');
  });

  it('query unresolved-calls: retorna array', () => {
    const r = run('query', graphFile, 'unresolved-calls');
    expect(r.status).toBe(0);
    expect(Array.isArray(JSON.parse(r.stdout))).toBe(true);
  });

  it('validate: rejeita JSON inválido', () => {
    const bad = join(tmpDir, 'bad.json');
    require('node:fs').writeFileSync(bad, '{ this is not json');
    const r = run('validate', bad);
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.ok).toBe(false);
  });

  it('comando inválido: exit 2 + mensagem', () => {
    const r = run('frob');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Unknown command');
  });
});
