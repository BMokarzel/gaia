import { describe, it, expect } from 'vitest';
import {
  parseCodeOwnersText,
  compilePattern,
  matchOwners,
} from '../../../src/analysis/codeowners-parser';
import { analyzeOwnership } from '../../../src/analysis/ownership';
import type { ServiceNode, EndpointNode } from '../../../src/types/topology';

// ── Helpers ───────────────────────────────────────────────

function endpoint(file: string, id = file): EndpointNode {
  return {
    id,
    type: 'endpoint',
    name: id,
    location: { file, line: 1, column: 0 },
    children: [],
    metadata: {
      method: 'GET',
      path: '/' + id,
      request: {},
      responses: [],
    },
  } as EndpointNode;
}

function service(id: string, endpoints: EndpointNode[]): ServiceNode {
  return {
    id,
    type: 'service',
    name: id,
    code: id,
    metadata: {},
    endpoints,
    functions: [],
    globals: [],
    dependencies: [],
  } as ServiceNode;
}

// ── parseCodeOwnersText ────────────────────────────────────

describe('parseCodeOwnersText', () => {
  it('skips comments and blank lines', () => {
    const rules = parseCodeOwnersText(`
      # comment
      *.ts @user

      /api/  @org/api-team
    `);
    expect(rules).toHaveLength(2);
    expect(rules[0].pattern).toBe('*.ts');
    expect(rules[0].owners).toEqual(['@user']);
    expect(rules[1].pattern).toBe('/api/');
    expect(rules[1].owners).toEqual(['@org/api-team']);
  });

  it('strips inline comments', () => {
    const rules = parseCodeOwnersText('src/  @core   # core team');
    expect(rules).toHaveLength(1);
    expect(rules[0].owners).toEqual(['@core']);
  });

  it('records line numbers for diagnostics', () => {
    const rules = parseCodeOwnersText('\n\n*.go @gophers\n');
    expect(rules[0].line).toBe(3);
  });

  it('ignores rules without owners', () => {
    const rules = parseCodeOwnersText('orphan-pattern\n*.ts @ok');
    expect(rules).toHaveLength(1);
    expect(rules[0].pattern).toBe('*.ts');
  });
});

// ── compilePattern ─────────────────────────────────────────

describe('compilePattern', () => {
  it('matches bare extensions at any depth', () => {
    const re = compilePattern('*.ts');
    expect(re.test('a.ts')).toBe(true);
    expect(re.test('src/lib/a.ts')).toBe(true);
    expect(re.test('a.go')).toBe(false);
  });

  it('anchors leading-slash patterns to the root', () => {
    const re = compilePattern('/api/');
    expect(re.test('api/foo.ts')).toBe(true);
    expect(re.test('packages/api/foo.ts')).toBe(false);
  });

  it('matches directory contents with trailing slash', () => {
    const re = compilePattern('src/');
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/lib/a.ts')).toBe(true);
    expect(re.test('src')).toBe(false);
  });

  it('treats ** as zero-or-more segments', () => {
    const re = compilePattern('docs/**/*.md');
    expect(re.test('docs/a.md')).toBe(true);
    expect(re.test('docs/x/y/a.md')).toBe(true);
    expect(re.test('other/a.md')).toBe(false);
  });

  it('escapes regex meta characters', () => {
    const re = compilePattern('config.json');
    expect(re.test('config.json')).toBe(true);
    expect(re.test('configXjson')).toBe(false);
  });
});

// ── matchOwners (last-match-wins) ──────────────────────────

describe('matchOwners', () => {
  it('returns the last matching rule', () => {
    const parsed = {
      source: 'CODEOWNERS',
      rules: parseCodeOwnersText(`
        *           @default
        *.ts        @ts-team
        /apps/web/  @web-team
      `),
    };
    expect(matchOwners(parsed, 'apps/web/index.ts')!.owners).toEqual(['@web-team']);
    expect(matchOwners(parsed, 'apps/api/foo.ts')!.owners).toEqual(['@ts-team']);
    expect(matchOwners(parsed, 'README.md')!.owners).toEqual(['@default']);
  });

  it('normalizes Windows separators', () => {
    const parsed = {
      source: 'CODEOWNERS',
      rules: parseCodeOwnersText('src/ @core'),
    };
    expect(matchOwners(parsed, 'src\\lib\\a.ts')!.owners).toEqual(['@core']);
  });

  it('returns null when no rule matches', () => {
    const parsed = {
      source: 'CODEOWNERS',
      rules: parseCodeOwnersText('/api/ @api'),
    };
    expect(matchOwners(parsed, 'docs/x.md')).toBeNull();
  });
});

// ── analyzeOwnership ──────────────────────────────────────

describe('analyzeOwnership', () => {
  const parsed = {
    source: 'CODEOWNERS',
    rules: parseCodeOwnersText(`
      *.ts             @platform
      /apps/orders/    @org/orders-team
      /apps/users/     alice@example.com
    `),
  };

  it('classifies team handles, user handles, and emails distinctly', () => {
    const services = [
      service('svc:orders', [endpoint('apps/orders/foo.ts', 'ep:o1')]),
      service('svc:users',  [endpoint('apps/users/bar.ts',  'ep:u1')]),
      service('svc:misc',   [endpoint('lib/helper.ts',      'ep:m1')]),
    ];
    const map = analyzeOwnership(services, '/repo', parsed);
    expect(map).not.toBeNull();
    const ownerKinds = new Map(map!.owners.map(o => [o.id, o.metadata.kind]));
    expect(ownerKinds.get('team:org/orders-team')).toBe('team');
    expect(ownerKinds.get('person:alice@example.com')).toBe('person');
    expect(ownerKinds.get('person:platform')).toBe('person');
  });

  it('emits per-endpoint edges and a single dominant service edge', () => {
    const services = [
      service('svc:orders', [
        endpoint('apps/orders/a.ts', 'ep:1'),
        endpoint('apps/orders/b.ts', 'ep:2'),
        endpoint('lib/shared.ts',    'ep:3'), // matches *.ts → @platform
      ]),
    ];
    const map = analyzeOwnership(services, '/repo', parsed)!;
    const epEdges = map.edges.filter(e => e.targetKind === 'endpoint');
    const svcEdges = map.edges.filter(e => e.targetKind === 'service');
    expect(epEdges).toHaveLength(3);
    expect(svcEdges).toHaveLength(1);
    // orders-team wins (2 endpoints vs 1)
    expect(svcEdges[0].ownerId).toBe('team:org/orders-team');
  });

  it('skips endpoints without a file location', () => {
    const ep = endpoint('apps/orders/a.ts', 'ep:1');
    (ep as { location?: unknown }).location = undefined;
    const map = analyzeOwnership([service('svc', [ep])], '/repo', parsed);
    expect(map).not.toBeNull();
    expect(map!.edges).toHaveLength(0);
  });

  it('returns null when CODEOWNERS has no rules', () => {
    const map = analyzeOwnership(
      [service('svc', [endpoint('a.ts')])],
      '/repo',
      { source: 'CODEOWNERS', rules: [] },
    );
    expect(map).toBeNull();
  });
});
