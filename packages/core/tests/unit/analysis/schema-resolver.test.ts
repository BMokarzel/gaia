import { describe, it, expect } from 'vitest';
import { resolveSchema, attachEndpointSchemas } from '../../../src/analysis/schema-resolver';
import type { DataNode, EndpointNode, ResolvedShape } from '../../../src/types/topology';

function makeDataNode(name: string, kind: DataNode['metadata']['kind'], fields: DataNode['metadata']['fields']): DataNode {
  return {
    id: `data:${name}`,
    type: 'data',
    name,
    location: { file: 'x.ts', line: 1, column: 0 },
    children: [],
    metadata: { kind, mutable: false, scope: 'module', exported: true, fields },
  };
}

describe('resolveSchema — primitives & literals', () => {
  it('resolves bare primitives', () => {
    expect(resolveSchema('string', { dataNodes: [] })).toEqual({ kind: 'primitive', type: 'string', raw: 'string' });
    expect(resolveSchema('number', { dataNodes: [] })).toEqual({ kind: 'primitive', type: 'number', raw: 'number' });
    expect(resolveSchema('boolean', { dataNodes: [] })).toEqual({ kind: 'primitive', type: 'boolean', raw: 'boolean' });
    expect(resolveSchema('Date', { dataNodes: [] })).toEqual({ kind: 'primitive', type: 'date', raw: 'Date' });
  });

  it('returns unknown for empty/missing input', () => {
    expect(resolveSchema(undefined, { dataNodes: [] })).toEqual({ kind: 'unknown', raw: '' });
    expect(resolveSchema('', { dataNodes: [] })).toEqual({ kind: 'unknown', raw: '' });
  });

  it('resolves string and numeric literals', () => {
    expect(resolveSchema("'admin'", { dataNodes: [] })).toEqual({ kind: 'literal', value: 'admin' });
    expect(resolveSchema('42', { dataNodes: [] })).toEqual({ kind: 'literal', value: 42 });
    expect(resolveSchema('true', { dataNodes: [] })).toEqual({ kind: 'literal', value: true });
  });
});

describe('resolveSchema — arrays & generics', () => {
  it('resolves T[]', () => {
    expect(resolveSchema('string[]', { dataNodes: [] })).toEqual({
      kind: 'array',
      element: { kind: 'primitive', type: 'string', raw: 'string' },
    });
  });

  it('resolves Array<T> and ReadonlyArray<T>', () => {
    expect(resolveSchema('Array<number>', { dataNodes: [] })).toEqual({
      kind: 'array',
      element: { kind: 'primitive', type: 'number', raw: 'number' },
    });
    expect(resolveSchema('ReadonlyArray<boolean>', { dataNodes: [] })).toEqual({
      kind: 'array',
      element: { kind: 'primitive', type: 'boolean', raw: 'boolean' },
    });
  });

  it('unwraps Promise<T>', () => {
    expect(resolveSchema('Promise<string>', { dataNodes: [] })).toEqual({
      kind: 'primitive', type: 'string', raw: 'string',
    });
  });
});

describe('resolveSchema — unions', () => {
  it('splits top-level unions', () => {
    const r = resolveSchema("'a' | 'b' | 'c'", { dataNodes: [] });
    expect(r).toEqual({
      kind: 'union',
      options: [
        { kind: 'literal', value: 'a' },
        { kind: 'literal', value: 'b' },
        { kind: 'literal', value: 'c' },
      ],
    });
  });

  it("doesn't split unions inside generics", () => {
    const r = resolveSchema('Array<string | number>', { dataNodes: [] });
    expect(r.kind).toBe('array');
    if (r.kind === 'array') expect(r.element.kind).toBe('union');
  });
});

describe('resolveSchema — DTO lookup', () => {
  it('resolves a simple DTO from the data pool', () => {
    const User = makeDataNode('User', 'interface', [
      { name: 'id', type: 'string', required: true },
      { name: 'age', type: 'number', required: false },
    ]);
    const r = resolveSchema('User', { dataNodes: [User] });
    expect(r).toEqual({
      kind: 'object',
      name: 'User',
      sourceNodeId: 'data:User',
      fields: [
        { name: 'id', required: true, shape: { kind: 'primitive', type: 'string', raw: 'string' }, defaultValue: undefined, description: undefined, validation: undefined },
        { name: 'age', required: false, shape: { kind: 'primitive', type: 'number', raw: 'number' }, defaultValue: undefined, description: undefined, validation: undefined },
      ],
    });
  });

  it('expands nested DTOs recursively', () => {
    const Address = makeDataNode('Address', 'interface', [
      { name: 'city', type: 'string', required: true },
    ]);
    const User = makeDataNode('User', 'interface', [
      { name: 'addr', type: 'Address', required: true },
    ]);
    const r = resolveSchema('User', { dataNodes: [User, Address] }) as Extract<ResolvedShape, { kind: 'object' }>;
    expect(r.kind).toBe('object');
    expect(r.fields[0].shape.kind).toBe('object');
    if (r.fields[0].shape.kind === 'object') {
      expect(r.fields[0].shape.name).toBe('Address');
      expect(r.fields[0].shape.fields[0].name).toBe('city');
    }
  });

  it('expands DTO arrays', () => {
    const Tag = makeDataNode('Tag', 'interface', [
      { name: 'label', type: 'string', required: true },
    ]);
    const Post = makeDataNode('Post', 'interface', [
      { name: 'tags', type: 'Tag[]', required: true },
    ]);
    const r = resolveSchema('Post', { dataNodes: [Post, Tag] }) as Extract<ResolvedShape, { kind: 'object' }>;
    expect(r.fields[0].shape.kind).toBe('array');
    if (r.fields[0].shape.kind === 'array') {
      expect(r.fields[0].shape.element.kind).toBe('object');
    }
  });

  it('breaks cycles with kind=cycle marker', () => {
    const Person = makeDataNode('Person', 'interface', [
      { name: 'name', type: 'string', required: true },
      { name: 'friend', type: 'Person', required: false },
    ]);
    const r = resolveSchema('Person', { dataNodes: [Person] }) as Extract<ResolvedShape, { kind: 'object' }>;
    expect(r.kind).toBe('object');
    expect(r.fields[1].shape).toEqual({ kind: 'cycle', ref: 'Person' });
  });

  it('falls back to unknown for unresolvable types', () => {
    expect(resolveSchema('NotInPool', { dataNodes: [] })).toEqual({ kind: 'unknown', raw: 'NotInPool' });
  });

  it('resolves enum DataNodes', () => {
    const Role = makeDataNode('Role', 'enum', [
      { name: 'ADMIN', type: 'string', required: true, defaultValue: "'admin'" },
      { name: 'USER',  type: 'string', required: true, defaultValue: "'user'" },
    ]);
    const r = resolveSchema('Role', { dataNodes: [Role] });
    expect(r).toEqual({
      kind: 'enum',
      name: 'Role',
      sourceNodeId: 'data:Role',
      values: ['admin', 'user'],
    });
  });
});

describe('resolveSchema — inline objects', () => {
  it('parses { a: string; b?: number }', () => {
    const r = resolveSchema('{ a: string; b?: number }', { dataNodes: [] }) as Extract<ResolvedShape, { kind: 'object' }>;
    expect(r.kind).toBe('object');
    expect(r.fields).toHaveLength(2);
    expect(r.fields[0]).toMatchObject({ name: 'a', required: true });
    expect(r.fields[1]).toMatchObject({ name: 'b', required: false });
  });
});

describe('attachEndpointSchemas', () => {
  it('attaches bodySchema and querySchema to an endpoint', () => {
    const Dto = makeDataNode('CreateUserDto', 'interface', [
      { name: 'email', type: 'string', required: true },
      { name: 'age', type: 'number', required: false },
    ]);
    const ep: EndpointNode = {
      id: 'ep:1',
      type: 'endpoint',
      name: 'UsersController.create',
      location: { file: 'a.ts', line: 1, column: 0 },
      children: [],
      metadata: {
        method: 'POST',
        path: '/users',
        bodyType: 'CreateUserDto',
        request: {
          bodyType: 'CreateUserDto',
          query: [{ name: 'limit', type: 'number', required: false }],
        },
        responses: [],
      },
    };
    attachEndpointSchemas(ep, [Dto]);
    expect(ep.metadata.request.bodySchema).toBeDefined();
    expect(ep.metadata.request.bodySchema?.kind).toBe('object');
    if (ep.metadata.request.bodySchema?.kind === 'object') {
      expect(ep.metadata.request.bodySchema.name).toBe('CreateUserDto');
    }
    expect(ep.metadata.request.querySchema?.kind).toBe('object');
  });

  it('does not overwrite an existing bodySchema', () => {
    const ep: EndpointNode = {
      id: 'ep:1', type: 'endpoint', name: 'x', location: { file: 'a.ts', line: 1, column: 0 }, children: [],
      metadata: {
        method: 'POST', path: '/x', responses: [],
        request: { bodyType: 'string', bodySchema: { kind: 'primitive', type: 'string', raw: 'string' } },
      },
    };
    attachEndpointSchemas(ep, []);
    expect(ep.metadata.request.bodySchema).toEqual({ kind: 'primitive', type: 'string', raw: 'string' });
  });
});
