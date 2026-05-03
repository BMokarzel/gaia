import { describe, it, expect } from 'vitest';
import { formatPrDiffComment, ownersByServiceFromTopology } from '../../../src/analysis/pr-comment-formatter';
import type { TopologyDiff } from '../../../src/analysis/topology-diff';
import type { SystemTopology } from '../../../src/types/topology';

function emptyDiff(): TopologyDiff {
  return {
    from: { sha: 'aaaaaaaaaaaa', analyzedAt: '2026-04-30T00:00:00Z' },
    to:   { sha: 'bbbbbbbbbbbb', analyzedAt: '2026-05-01T00:00:00Z' },
    services:  { added: [], removed: [], modified: [] },
    databases: { added: [], removed: [] },
    edges:     { added: [], removed: [] },
    summary: {
      totalChanges: 0,
      servicesAdded: 0, servicesRemoved: 0, servicesModified: 0,
      endpointsAdded: 0, endpointsRemoved: 0, endpointsModified: 0,
    },
  };
}

describe('formatPrDiffComment', () => {
  it('renders an "no changes" message when the diff is empty', () => {
    const out = formatPrDiffComment(emptyDiff(), { topologyName: 'demo-svc' });
    expect(out).toContain('Topology impact');
    expect(out).toContain('demo-svc');
    expect(out).toContain('No structural changes detected');
    // Includes ref line with 7-char SHAs
    expect(out).toMatch(/`aaaaaaa`.*`bbbbbbb`/);
  });

  it('renders a summary chip line when there are counts', () => {
    const diff = emptyDiff();
    diff.services.added.push({ id: 's1', name: 'svc-1' });
    diff.summary = {
      totalChanges: 1,
      servicesAdded: 1, servicesRemoved: 0, servicesModified: 0,
      endpointsAdded: 0, endpointsRemoved: 0, endpointsModified: 0,
    };
    const out = formatPrDiffComment(diff);
    expect(out).toContain('`+1 service(s)`');
    expect(out).toContain('**New services**');
    expect(out).toContain('`svc-1` (`s1`)');
  });

  it('flags removed services and endpoints as breaking', () => {
    const diff = emptyDiff();
    diff.services.removed.push({ id: 's-old', name: 'old-svc' });
    diff.services.modified.push({
      id: 's-keep', name: 'keep',
      endpoints: {
        added: [],
        removed: [{ id: 'e-rm', method: 'DELETE', path: '/users/:id' }],
        modified: [],
      },
      databases: { added: [], removed: [] },
      changes: [],
    });
    diff.summary = {
      totalChanges: 2,
      servicesAdded: 0, servicesRemoved: 1, servicesModified: 1,
      endpointsAdded: 0, endpointsRemoved: 1, endpointsModified: 0,
    };
    const out = formatPrDiffComment(diff);
    expect(out).toContain('Possibly breaking');
    expect(out).toContain('service removed: `old-svc`');
    expect(out).toContain('endpoint removed: `DELETE /users/:id`');
  });

  it('flags an auth tightening as breaking', () => {
    const diff = emptyDiff();
    diff.services.modified.push({
      id: 's1', name: 's1',
      endpoints: {
        added: [], removed: [],
        modified: [{
          id: 'e1', method: 'GET', path: '/secret',
          changes: ['auth: none → required'],
        }],
      },
      databases: { added: [], removed: [] },
      changes: [],
    });
    diff.summary = {
      totalChanges: 1,
      servicesAdded: 0, servicesRemoved: 0, servicesModified: 1,
      endpointsAdded: 0, endpointsRemoved: 0, endpointsModified: 1,
    };
    const out = formatPrDiffComment(diff);
    expect(out).toContain('endpoint auth changed: `GET /secret`');
  });

  it('annotates modified services with owner names and emits a reviewer suggestion', () => {
    const diff = emptyDiff();
    diff.services.modified.push({
      id: 's-x', name: 'svc-x',
      endpoints: { added: [], removed: [], modified: [] },
      databases: { added: [], removed: [] },
      changes: ['language: typescript → python'],
    });
    diff.summary = {
      totalChanges: 1,
      servicesAdded: 0, servicesRemoved: 0, servicesModified: 1,
      endpointsAdded: 0, endpointsRemoved: 0, endpointsModified: 0,
    };
    const out = formatPrDiffComment(diff, {
      ownersByService: { 's-x': ['@org/team-alpha', '@alice'] },
    });
    expect(out).toContain('owners: @org/team-alpha, @alice');
    expect(out).toContain('Suggested reviewers');
    expect(out).toContain('`@org/team-alpha`');
  });

  it('does not emit a reviewer suggestion when no owners map for changed services', () => {
    const diff = emptyDiff();
    diff.services.modified.push({
      id: 's-x', name: 'svc-x',
      endpoints: { added: [], removed: [], modified: [] },
      databases: { added: [], removed: [] },
      changes: ['language: typescript → python'],
    });
    diff.summary = {
      totalChanges: 1,
      servicesAdded: 0, servicesRemoved: 0, servicesModified: 1,
      endpointsAdded: 0, endpointsRemoved: 0, endpointsModified: 0,
    };
    // ownersByService passed but with NO entry for s-x
    const out = formatPrDiffComment(diff, { ownersByService: { 'other': ['@bob'] } });
    expect(out).not.toContain('Suggested reviewers');
  });

  it('embeds a hidden marker when prNumber is provided (lets the bot find prior comments)', () => {
    const diff = emptyDiff();
    diff.services.added.push({ id: 's1', name: 's1' });
    diff.summary.servicesAdded = 1;
    diff.summary.totalChanges = 1;
    const out = formatPrDiffComment(diff, { prNumber: 42 });
    expect(out).toContain('<!-- topology-bot pr=42 -->');
  });

  it('skips the breaking section when highlightBreaking is false', () => {
    const diff = emptyDiff();
    diff.services.removed.push({ id: 's', name: 's' });
    diff.summary.servicesRemoved = 1;
    diff.summary.totalChanges = 1;
    const out = formatPrDiffComment(diff, { highlightBreaking: false });
    expect(out).not.toContain('Possibly breaking');
    // But still lists the removed service
    expect(out).toContain('Removed services');
  });
});

describe('ownersByServiceFromTopology', () => {
  it('returns {} when topology has no ownership', () => {
    const t = { services: [], databases: [], edges: [] } as unknown as SystemTopology;
    expect(ownersByServiceFromTopology(t)).toEqual({});
  });

  it('groups owners per service using owner names', () => {
    const t = {
      services: [],
      databases: [],
      edges: [],
      ownership: {
        owners: [
          { id: 'o1', name: '@org/platform', metadata: { kind: 'team' } },
          { id: 'o2', name: '@alice',         metadata: { kind: 'person' } },
        ],
        edges: [
          { ownerId: 'o1', targetId: 's1', targetKind: 'service' },
          { ownerId: 'o2', targetId: 's1', targetKind: 'service' },
          { ownerId: 'o1', targetId: 's2', targetKind: 'service' },
          // db edge is ignored
          { ownerId: 'o1', targetId: 'db1', targetKind: 'database' },
        ],
      },
    } as unknown as SystemTopology;
    const result = ownersByServiceFromTopology(t);
    expect(result['s1']).toEqual(['@org/platform', '@alice']);
    expect(result['s2']).toEqual(['@org/platform']);
    expect(result['db1']).toBeUndefined();
  });

  it('deduplicates duplicate owner edges for the same service', () => {
    const t = {
      services: [], databases: [], edges: [],
      ownership: {
        owners: [{ id: 'o1', name: '@bob', metadata: { kind: 'person' } }],
        edges: [
          { ownerId: 'o1', targetId: 's1', targetKind: 'service' },
          { ownerId: 'o1', targetId: 's1', targetKind: 'service' },
        ],
      },
    } as unknown as SystemTopology;
    expect(ownersByServiceFromTopology(t)).toEqual({ s1: ['@bob'] });
  });
});
