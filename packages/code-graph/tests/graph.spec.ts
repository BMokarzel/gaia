import { describe, expect, it } from 'vitest';

import {
  ElementGraph,
  makeElementId,
  makeEdgeId,
  serializeGraph,
  deserializeGraph,
  GRAPH_SCHEMA_VERSION,
  labelFor,
  type Element,
  type Edge,
  type BehavioralMeta,
  type CallSiteMeta,
} from '../src';

function mkClass(file: string, line: number): Element {
  return {
    id: makeElementId(file, line, 0, 'class'),
    kind: 'class',
    location: { file, startLine: line, startCol: 0, endLine: line + 5, endCol: 0 },
    name: 'UsersService',
    meta: {
      isAbstract: false,
      decorators: ['Injectable'],
      implementsNames: [],
    },
  };
}

function mkMethod(file: string, line: number, name: string): Element {
  const meta: BehavioralMeta = {
    visibility: 'public',
    isAsync: true,
    isStatic: false,
    decorators: [],
    paramCount: 1,
  };
  return {
    id: makeElementId(file, line, 2, 'method'),
    kind: 'method',
    location: { file, startLine: line, startCol: 2, endLine: line + 3, endCol: 0 },
    name,
    signature: `${name}(dto: CreateUserDto): Promise<User>`,
    meta,
  };
}

function mkCall(file: string, line: number, callee: string): Element {
  const meta: CallSiteMeta = {
    calleeText: callee,
    argsText: ['dto'],
    isAwaited: true,
    isChained: false,
  };
  return {
    id: makeElementId(file, line, 4, 'call_site'),
    kind: 'call_site',
    location: { file, startLine: line, startCol: 4, endLine: line, endCol: 40 },
    name: callee,
    meta,
  };
}

describe('makeElementId', () => {
  it('é determinístico', () => {
    const a = makeElementId('users.ts', 10, 4, 'method');
    const b = makeElementId('users.ts', 10, 4, 'method');
    expect(a).toBe(b);
  });

  it('normaliza separadores de path windows/unix', () => {
    const win = makeElementId('src\\users.ts', 10, 4, 'method');
    const unix = makeElementId('src/users.ts', 10, 4, 'method');
    expect(win).toBe(unix);
  });

  it('diferencia por kind', () => {
    const m = makeElementId('users.ts', 10, 4, 'method');
    const c = makeElementId('users.ts', 10, 4, 'call_site');
    expect(m).not.toBe(c);
  });
});

describe('makeEdgeId', () => {
  it('é determinístico por (from, kind, to)', () => {
    const a = makeEdgeId('a', 'calls', 'b');
    const b = makeEdgeId('a', 'calls', 'b');
    expect(a).toBe(b);
  });

  it('diferencia direção e kind', () => {
    expect(makeEdgeId('a', 'calls', 'b')).not.toBe(makeEdgeId('b', 'calls', 'a'));
    expect(makeEdgeId('a', 'calls', 'b')).not.toBe(makeEdgeId('a', 'imports', 'b'));
  });
});

describe('ElementGraph', () => {
  it('mantém índices byKind e byFile', () => {
    const g = new ElementGraph();
    const cls = mkClass('users.ts', 1);
    const m1 = mkMethod('users.ts', 5, 'create');
    const m2 = mkMethod('users.ts', 12, 'find');
    g.addElement(cls);
    g.addElement(m1);
    g.addElement(m2);

    expect(g.size.elements).toBe(3);
    expect(g.getElementsByKind('method')).toHaveLength(2);
    expect(g.getElementsByKind('class')).toHaveLength(1);
    expect(g.getElementsInFile('users.ts')).toHaveLength(3);
  });

  it('mantém childrenOf/parentOf via edges contains', () => {
    const g = new ElementGraph();
    const cls = mkClass('users.ts', 1);
    const m1 = mkMethod('users.ts', 5, 'create');
    g.addElement(cls);
    g.addElement(m1);

    const containsEdge: Edge = {
      id: makeEdgeId(cls.id, 'contains', m1.id),
      from: cls.id,
      to: m1.id,
      kind: 'contains',
    };
    g.addEdge(containsEdge);

    expect(g.getChildren(cls.id)).toHaveLength(1);
    expect(g.getChildren(cls.id)[0].id).toBe(m1.id);
    expect(g.getParent(m1.id)?.id).toBe(cls.id);
  });

  it('rastreia outgoing/incoming por kind', () => {
    const g = new ElementGraph();
    const m = mkMethod('users.ts', 5, 'create');
    const call = mkCall('users.ts', 7, 'this.repo.save');
    g.addElement(m);
    g.addElement(call);

    const callEdge: Edge = {
      id: makeEdgeId(call.id, 'calls', m.id),
      from: call.id,
      to: m.id,
      kind: 'calls',
    };
    g.addEdge(callEdge);

    expect(g.getOutgoing(call.id, 'calls')).toHaveLength(1);
    expect(g.getIncoming(m.id, 'calls')).toHaveLength(1);
    expect(g.getIncoming(m.id, 'contains')).toHaveLength(0);
  });

  it('add idempotente: re-adicionar Element/Edge é no-op', () => {
    const g = new ElementGraph();
    const cls = mkClass('users.ts', 1);
    g.addElement(cls);
    g.addElement(cls);
    expect(g.size.elements).toBe(1);

    const m1 = mkMethod('users.ts', 5, 'create');
    g.addElement(m1);
    const e: Edge = {
      id: makeEdgeId(cls.id, 'contains', m1.id),
      from: cls.id,
      to: m1.id,
      kind: 'contains',
    };
    g.addEdge(e);
    g.addEdge(e);
    expect(g.size.edges).toBe(1);
  });

  it('rejeita edge com endpoint inexistente', () => {
    const g = new ElementGraph();
    const cls = mkClass('users.ts', 1);
    g.addElement(cls);
    const bad: Edge = {
      id: makeEdgeId(cls.id, 'calls', 'not-there'),
      from: cls.id,
      to: 'not-there',
      kind: 'calls',
    };
    expect(() => g.addEdge(bad)).toThrow(/element inexistente/);
  });
});

describe('serializer', () => {
  it('round-trip preserva todos os índices', () => {
    const g = new ElementGraph();
    const cls = mkClass('users.ts', 1);
    const m1 = mkMethod('users.ts', 5, 'create');
    const call = mkCall('users.ts', 7, 'this.repo.save');
    g.addElement(cls);
    g.addElement(m1);
    g.addElement(call);
    g.addEdge({
      id: makeEdgeId(cls.id, 'contains', m1.id),
      from: cls.id,
      to: m1.id,
      kind: 'contains',
    });
    g.addEdge({
      id: makeEdgeId(m1.id, 'contains', call.id),
      from: m1.id,
      to: call.id,
      kind: 'contains',
    });

    const json = serializeGraph(g);
    expect(json.graphSchemaVersion).toBe(GRAPH_SCHEMA_VERSION);
    const restored = deserializeGraph(json);

    expect(restored.size).toEqual(g.size);
    expect(restored.getChildren(cls.id).map(e => e.id).sort()).toEqual(
      g.getChildren(cls.id).map(e => e.id).sort(),
    );
    expect(restored.getParent(call.id)?.id).toBe(m1.id);
    expect(restored.getElementsByKind('method')).toHaveLength(1);
  });

  it('rejeita major version incompatível', () => {
    expect(() =>
      deserializeGraph({
        graphSchemaVersion: '2.0.0',
        elements: [],
        edges: [],
      }),
    ).toThrow(/incompat/);
  });
});

describe('labelFor', () => {
  it('formata classe e método', () => {
    expect(labelFor(mkClass('u.ts', 1))).toBe('class UsersService');
    const m = mkMethod('u.ts', 5, 'create');
    expect(labelFor(m)).toContain('create(dto: CreateUserDto)');
  });

  it('formata call_site com await', () => {
    expect(labelFor(mkCall('u.ts', 7, 'this.repo.save'))).toBe('await this.repo.save(dto)');
  });
});
