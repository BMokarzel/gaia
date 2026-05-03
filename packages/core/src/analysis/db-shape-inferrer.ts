// =============================================================================
// db-shape-inferrer — predict the return shape of a DbProcessNode.
// =============================================================================
//
// Pure function. Given a `DbProcessNode` (e.g. `prisma.user.findMany(...)`),
// the corresponding `TableNode` (carrying columns / fields), and an optional
// ORM hint, returns a `ResolvedShape` describing what the call resolves to.
//
// Used by:
//   - The simulator, so a `const users = await prisma.user.findMany()` tracked
//     via `DataNode.metadata.sourceNodeId` can be expanded into a real shape
//     without re-reading source.
//   - The web UI to show "this query returns User[]" inline.
//
// Subset only — covers the canonical CRUD operations across SQL/Prisma-like
// and NoSQL/Mongoose-like ORMs. Everything else falls back to `unknown`.
// =============================================================================

import type { DbProcessNode, TableNode, ColumnDef, FieldDef, ResolvedShape, ResolvedField } from '../types/topology';

/**
 * Infer the resolved shape of a DbProcessNode's return value.
 *
 *   findMany          → array of row
 *   find/findFirst/   → row | null
 *   findUnique
 *   create/upsert/
 *   update            → row
 *   delete            → row | null
 *   createMany/
 *   updateMany/
 *   deleteMany        → { count: number }
 *   count             → number
 *   aggregate/groupBy → unknown (depends on aggregation pipeline)
 *   raw/transaction/
 *   migrate           → unknown
 */
export function inferDbReturnShape(
  dbProcess: DbProcessNode,
  table: TableNode | undefined,
): ResolvedShape {
  const op = dbProcess.metadata.operation;

  switch (op) {
    case 'count':
      return { kind: 'primitive', type: 'number', raw: 'number' };

    case 'createMany':
    case 'updateMany':
    case 'deleteMany':
      return countResultShape();

    case 'findMany':
    case 'groupBy': {
      const row = rowShape(table);
      return { kind: 'array', element: row };
    }

    case 'find':
    case 'findFirst':
    case 'findUnique':
    case 'delete': {
      const row = rowShape(table);
      return { kind: 'union', options: [row, nullShape()] };
    }

    case 'create':
    case 'update':
    case 'upsert':
      return rowShape(table);

    case 'aggregate':
    case 'raw':
    case 'transaction':
    case 'migrate':
      return { kind: 'unknown', raw: op };

    default:
      return { kind: 'unknown', raw: String(op) };
  }
}

// --- helpers ----------------------------------------------------------------

function rowShape(table: TableNode | undefined): ResolvedShape {
  if (!table) return { kind: 'unknown', raw: 'row' };

  const fields: ResolvedField[] = [];

  // Prefer explicit columns (SQL); fall back to fields[] (NoSQL / Mongo).
  if (table.metadata.columns && table.metadata.columns.length > 0) {
    for (const col of table.metadata.columns) {
      fields.push(fieldFromColumn(col));
    }
  } else if (table.metadata.fields && table.metadata.fields.length > 0) {
    for (const f of table.metadata.fields) {
      fields.push(fieldFromMongoField(f));
    }
  }

  return {
    kind: 'object',
    name: table.metadata.entityName ?? table.name,
    fields,
    sourceNodeId: table.id,
  };
}

function fieldFromColumn(col: ColumnDef): ResolvedField {
  return {
    name: col.name,
    required: !col.nullable && !col.autoIncrement && col.defaultValue === undefined,
    shape: shapeFromSqlType(col.type, col.enumValues),
    defaultValue: col.defaultValue,
    description: col.comment,
  };
}

function fieldFromMongoField(f: FieldDef): ResolvedField {
  return {
    name: f.path,
    required: f.required,
    shape: shapeFromMongoType(f.type),
  };
}

function shapeFromSqlType(rawType: string, enumValues?: string[]): ResolvedShape {
  if (enumValues && enumValues.length > 0) {
    return {
      kind: 'union',
      options: enumValues.map(v => ({ kind: 'literal', value: v })),
    };
  }

  // Strip parametric suffix: "varchar(255)" → "varchar"
  const base = rawType.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();

  if (/^(varchar|char|text|citext|uuid|nvarchar|nchar|enum|inet|cidr|macaddr|character)/i.test(base)) {
    return { kind: 'primitive', type: 'string', raw: rawType };
  }
  if (/^(int|integer|bigint|smallint|tinyint|serial|bigserial|smallserial|float|double|decimal|numeric|real|money)/i.test(base)) {
    return { kind: 'primitive', type: 'number', raw: rawType };
  }
  if (/^(bool|boolean|bit)/i.test(base)) {
    return { kind: 'primitive', type: 'boolean', raw: rawType };
  }
  if (/^(date|time|timestamp|interval|year)/i.test(base)) {
    return { kind: 'primitive', type: 'date', raw: rawType };
  }
  if (/^(json|jsonb|object|hstore)/i.test(base)) {
    return { kind: 'unknown', raw: rawType };
  }
  if (/^(bytea|blob|binary|varbinary|geometry|geography|point|line|polygon)/i.test(base)) {
    return { kind: 'unknown', raw: rawType };
  }
  if (base.endsWith('[]')) {
    return { kind: 'array', element: shapeFromSqlType(base.slice(0, -2)) };
  }
  return { kind: 'unknown', raw: rawType };
}

function shapeFromMongoType(rawType: string): ResolvedShape {
  const base = rawType.trim();
  const lower = base.toLowerCase();
  if (lower === 'string') return { kind: 'primitive', type: 'string', raw: base };
  if (lower === 'number' || lower === 'int' || lower === 'long' || lower === 'double' || lower === 'decimal') {
    return { kind: 'primitive', type: 'number', raw: base };
  }
  if (lower === 'boolean' || lower === 'bool') return { kind: 'primitive', type: 'boolean', raw: base };
  if (lower === 'date' || lower === 'timestamp') return { kind: 'primitive', type: 'date', raw: base };
  if (lower === 'objectid' || lower === 'object_id') return { kind: 'primitive', type: 'string', raw: base };
  if (base.endsWith('[]')) return { kind: 'array', element: shapeFromMongoType(base.slice(0, -2)) };
  if (lower === 'mixed' || lower === 'any') return { kind: 'primitive', type: 'any', raw: base };
  return { kind: 'unknown', raw: base };
}

function nullShape(): ResolvedShape {
  return { kind: 'primitive', type: 'null', raw: 'null' };
}

function countResultShape(): ResolvedShape {
  return {
    kind: 'object',
    fields: [
      { name: 'count', required: true, shape: { kind: 'primitive', type: 'number', raw: 'number' } },
    ],
  };
}
