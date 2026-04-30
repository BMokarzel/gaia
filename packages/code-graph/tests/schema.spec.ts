import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  validateGraphJSON,
  serializeGraph,
  ElementGraph,
  makeElementId,
  makeEdgeId,
  GRAPH_SCHEMA_VERSION,
  type Element,
  type Edge,
} from '../src';

const SCHEMA_PATH = join(__dirname, '..', 'schema', 'element-graph.schema.json');

function smallGraph(): ElementGraph {
  const g = new ElementGraph();
  const cls: Element = {
    id: makeElementId('a.ts', 1, 0, 'class'),
    kind: 'class',
    location: { file: 'a.ts', startLine: 1, startCol: 0, endLine: 5, endCol: 0 },
    name: 'Foo',
    meta: { isAbstract: false, decorators: [], implementsNames: [] },
  };
  const m: Element = {
    id: makeElementId('a.ts', 2, 2, 'method'),
    kind: 'method',
    location: { file: 'a.ts', startLine: 2, startCol: 2, endLine: 4, endCol: 0 },
    name: 'bar',
    meta: { visibility: 'public', isAsync: false, isStatic: false, decorators: [], paramCount: 0 },
  };
  g.addElement(cls);
  g.addElement(m);
  const e: Edge = {
    id: makeEdgeId(cls.id, 'contains', m.id),
    from: cls.id,
    to: m.id,
    kind: 'contains',
  };
  g.addEdge(e);
  return g;
}

describe('JSON Schema (file)', () => {
  it('schema/element-graph.schema.json existe e tem $id e enums esperados', () => {
    expect(existsSync(SCHEMA_PATH)).toBe(true);
    const raw = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    expect(raw.$id).toContain('element-graph');
    expect(raw.$defs.ElementKind.enum).toContain('module');
    expect(raw.$defs.ElementKind.enum).toContain('call_site');
    expect(raw.$defs.EdgeKind.enum).toContain('calls');
    expect(raw.$defs.EdgeKind.enum).toContain('contains');
  });
});

describe('validateGraphJSON', () => {
  it('aceita graph serializado de smallGraph()', () => {
    const json = serializeGraph(smallGraph());
    const r = validateGraphJSON(json);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('rejeita versão major incompatível', () => {
    const r = validateGraphJSON({
      graphSchemaVersion: '99.0.0',
      elements: [],
      edges: [],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.path === 'graphSchemaVersion')).toBe(true);
  });

  it('rejeita kind inválido em element', () => {
    const r = validateGraphJSON({
      graphSchemaVersion: GRAPH_SCHEMA_VERSION,
      elements: [
        {
          id: 'x',
          kind: 'frob',
          location: { file: 'a.ts', startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
          meta: {},
        },
      ],
      edges: [],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.message.includes('kind inválido'))).toBe(true);
  });

  it('rejeita edge cujo endpoint aponta para id inexistente', () => {
    const r = validateGraphJSON({
      graphSchemaVersion: GRAPH_SCHEMA_VERSION,
      elements: [
        {
          id: 'a',
          kind: 'class',
          location: { file: 'x.ts', startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
          meta: {},
        },
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'missing', kind: 'contains' },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.message.includes('id inexistente'))).toBe(true);
  });

  it('rejeita id duplicado em elements', () => {
    const r = validateGraphJSON({
      graphSchemaVersion: GRAPH_SCHEMA_VERSION,
      elements: [
        { id: 'dup', kind: 'class', location: { file: 'a.ts', startLine: 0, startCol: 0, endLine: 0, endCol: 0 }, meta: {} },
        { id: 'dup', kind: 'method', location: { file: 'a.ts', startLine: 1, startCol: 0, endLine: 1, endCol: 0 }, meta: {} },
      ],
      edges: [],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.message.includes('duplicado'))).toBe(true);
  });

  it('rejeita payload não-objeto', () => {
    const r = validateGraphJSON('nope');
    expect(r.ok).toBe(false);
  });
});
