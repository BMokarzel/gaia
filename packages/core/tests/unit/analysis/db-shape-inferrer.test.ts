import { describe, it, expect } from 'vitest';
import { inferDbReturnShape } from '../../../src/analysis/db-shape-inferrer';
import type { DbProcessNode, TableNode, ColumnDef, ResolvedShape } from '../../../src/types/topology';

function makeDbProcess(operation: DbProcessNode['metadata']['operation']): DbProcessNode {
  return {
    id: 'db:1',
    type: 'dbProcess',
    name: 'q',
    location: { file: 'a.ts', line: 1, column: 0 },
    children: [],
    metadata: { operation, databaseId: 'pg', tableId: 'users' },
  };
}

function col(name: string, type: string, opts: Partial<ColumnDef> = {}): ColumnDef {
  return {
    name, type,
    nullable: false,
    unique: false,
    primaryKey: false,
    sourceKind: 'entity',
    ...opts,
  };
}

const usersTable: TableNode = {
  id: 't:users',
  type: 'table',
  name: 'users',
  metadata: {
    kind: 'table',
    databaseId: 'pg',
    columns: [
      col('id', 'uuid', { primaryKey: true }),
      col('email', 'varchar(255)'),
      col('age', 'int', { nullable: true }),
      col('active', 'boolean', { defaultValue: 'true' }),
      col('created_at', 'timestamp'),
      col('role', 'enum', { enumValues: ['admin', 'user'] }),
    ],
    hasTimestamps: true,
    hasSoftDelete: false,
  },
};

describe('inferDbReturnShape', () => {
  it('findMany → array of object', () => {
    const r = inferDbReturnShape(makeDbProcess('findMany'), usersTable);
    expect(r.kind).toBe('array');
    if (r.kind === 'array') {
      expect(r.element.kind).toBe('object');
    }
  });

  it('findUnique → union of object and null', () => {
    const r = inferDbReturnShape(makeDbProcess('findUnique'), usersTable) as Extract<ResolvedShape, { kind: 'union' }>;
    expect(r.kind).toBe('union');
    expect(r.options[0].kind).toBe('object');
    expect(r.options[1]).toEqual({ kind: 'primitive', type: 'null', raw: 'null' });
  });

  it('create → object', () => {
    const r = inferDbReturnShape(makeDbProcess('create'), usersTable) as Extract<ResolvedShape, { kind: 'object' }>;
    expect(r.kind).toBe('object');
    expect(r.fields.find(f => f.name === 'email')?.shape).toEqual({ kind: 'primitive', type: 'string', raw: 'varchar(255)' });
    expect(r.fields.find(f => f.name === 'age')?.shape).toEqual({ kind: 'primitive', type: 'number', raw: 'int' });
    expect(r.fields.find(f => f.name === 'active')?.required).toBe(false);
  });

  it('count → number', () => {
    expect(inferDbReturnShape(makeDbProcess('count'), usersTable)).toEqual({ kind: 'primitive', type: 'number', raw: 'number' });
  });

  it('updateMany → { count: number }', () => {
    const r = inferDbReturnShape(makeDbProcess('updateMany'), usersTable) as Extract<ResolvedShape, { kind: 'object' }>;
    expect(r.kind).toBe('object');
    expect(r.fields).toEqual([{ name: 'count', required: true, shape: { kind: 'primitive', type: 'number', raw: 'number' } }]);
  });

  it('aggregate → unknown', () => {
    expect(inferDbReturnShape(makeDbProcess('aggregate'), usersTable).kind).toBe('unknown');
  });

  it('expands enum columns into a union of literals', () => {
    const r = inferDbReturnShape(makeDbProcess('findUnique'), usersTable) as Extract<ResolvedShape, { kind: 'union' }>;
    const obj = r.options[0] as Extract<ResolvedShape, { kind: 'object' }>;
    const role = obj.fields.find(f => f.name === 'role')!;
    expect(role.shape).toEqual({
      kind: 'union',
      options: [
        { kind: 'literal', value: 'admin' },
        { kind: 'literal', value: 'user' },
      ],
    });
  });

  it('returns unknown row when table is missing', () => {
    const r = inferDbReturnShape(makeDbProcess('findMany'), undefined);
    expect(r.kind).toBe('array');
    if (r.kind === 'array') expect(r.element.kind).toBe('unknown');
  });

  it('handles Mongo fields[] when columns is empty', () => {
    const mongoTable: TableNode = {
      id: 'm:posts', type: 'table', name: 'posts',
      metadata: {
        kind: 'collection', databaseId: 'mongo',
        fields: [
          { path: 'title',     type: 'string', required: true, indexed: false },
          { path: 'createdAt', type: 'Date',   required: true, indexed: true  },
          { path: 'views',     type: 'number', required: false, indexed: false },
        ],
        hasTimestamps: true, hasSoftDelete: false,
      },
    };
    const r = inferDbReturnShape(makeDbProcess('findMany'), mongoTable);
    if (r.kind === 'array' && r.element.kind === 'object') {
      expect(r.element.fields[0]).toMatchObject({ name: 'title', required: true });
      expect(r.element.fields[1].shape).toEqual({ kind: 'primitive', type: 'date', raw: 'Date' });
    } else {
      throw new Error('expected array<object>');
    }
  });
});
