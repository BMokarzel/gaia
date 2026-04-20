import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation } from '../../../utils/ast-helpers';
import { nodeId, resourceId, tableId as makeTableId } from '../../../utils/id';
import type { DbProcessNode, DatabaseNode, TableNode } from '../../../types/topology';

/** GORM method → topology operation */
const GORM_METHODS: Record<string, DbProcessNode['metadata']['operation']> = {
  Find: 'findMany',
  First: 'findFirst',
  Last: 'findFirst',
  Take: 'findFirst',
  FindInBatches: 'findMany',
  Scan: 'findMany',
  Raw: 'raw',
  Create: 'create',
  CreateInBatches: 'createMany',
  Save: 'upsert',
  Updates: 'updateMany',
  Update: 'update',
  UpdateColumn: 'update',
  UpdateColumns: 'update',
  Delete: 'delete',
  Exec: 'raw',
};

/** GORM chaining methods that don't represent operations */
const CHAIN_METHODS = new Set(['Where', 'Or', 'Not', 'Limit', 'Offset', 'Order', 'Group',
  'Having', 'Joins', 'Preload', 'Omit', 'Select', 'Table', 'Model', 'Session', 'WithContext',
  'Debug', 'Set', 'Clauses', 'Scopes']);

const DB_RE = /^(db|DB|gdb|gormDB|r\.db|s\.db|self\.db|h\.db|[a-z]\.db|database)$/;

export function extractGORMOperations(
  rootNode: SyntaxNode,
  filePath: string,
): { dbNodes: DbProcessNode[]; database: DatabaseNode } {
  const dbAlias = 'gorm';
  const dbId = resourceId('database', dbAlias);

  const database: DatabaseNode = {
    id: dbId,
    type: 'database',
    name: 'gorm',
    metadata: {
      engine: 'postgresql',
      category: 'sql',
      connectionAlias: dbAlias,
    },
    tables: [],
  };

  const tablesMap = new Map<string, TableNode>();
  const dbNodes: DbProcessNode[] = [];

  for (const structNode of findAll(rootNode, 'type_declaration')) {
    const table = extractModelTable(structNode, dbId);
    if (table) {
      tablesMap.set(table.name.toLowerCase(), table);
      database.tables.push(table);
    }
  }

  for (const call of findAll(rootNode, 'call_expression')) {
    const op = buildDbOperation(call, filePath, dbId, tablesMap);
    if (op) dbNodes.push(op);
  }

  return { dbNodes, database };
}

function extractModelTable(typeDecl: SyntaxNode, dbId: string): TableNode | null {
  for (const spec of typeDecl.namedChildren) {
    if (spec.type !== 'type_spec') continue;
    const nameNode = spec.childForFieldName('name');
    const typeNode = spec.childForFieldName('type');
    if (!nameNode || typeNode?.type !== 'struct_type') continue;

    const structName = nameNode.text;
    const structText = typeNode.text;
    if (!structText.includes('gorm.Model') && !structText.includes('gorm:"')) continue;

    const tableName = toSnakeCase(structName) + 's';
    const table: TableNode = {
      id: makeTableId(dbId, tableName),
      type: 'table',
      name: tableName,
      metadata: {
        kind: 'table',
        databaseId: dbId,
        entityName: structName,
        hasTimestamps: structText.includes('gorm.Model'),
        hasSoftDelete: structText.includes('gorm.Model'),
        columns: [],
      },
    };

    const fieldList = typeNode.namedChildren.find(c => c.type === 'field_declaration_list');
    if (fieldList) {
      for (const field of fieldList.namedChildren) {
        if (field.type !== 'field_declaration') continue;
        const nameN = field.childForFieldName('name');
        const typeN = field.childForFieldName('type');
        if (!nameN || !typeN) continue;

        const tag = field.namedChildren.find(c =>
          c.type === 'raw_string_literal' || c.type === 'interpreted_string_literal'
        );

        const isPrimaryKey = nameN.text === 'ID' || (tag?.text.includes('primaryKey') ?? false);
        const colName = extractColumnName(nameN.text, tag?.text);

        table.metadata.columns!.push({
          name: colName,
          type: typeN.text,
          nullable: !isPrimaryKey,
          unique: tag?.text.includes('uniqueIndex') ?? false,
          primaryKey: isPrimaryKey,
          sourceKind: 'entity',
        });
      }
    }

    return table;
  }

  return null;
}

function buildDbOperation(
  node: SyntaxNode,
  filePath: string,
  dbId: string,
  tablesMap: Map<string, TableNode>,
): DbProcessNode | null {
  const fn = node.childForFieldName('function');
  if (!fn || fn.type !== 'selector_expression') return null;

  const operand = fn.childForFieldName('operand');
  const field = fn.childForFieldName('field');
  if (!operand || !field) return null;

  const methodName = field.text;
  const operation = GORM_METHODS[methodName];
  if (!operation) return null;

  const rootVar = findChainRoot(operand);
  if (!rootVar || !DB_RE.test(rootVar)) return null;

  const args = node.childForFieldName('arguments');
  const modelName = extractModelFromArgs(args, tablesMap);
  const tableEntry = modelName ? tablesMap.get(modelName) : undefined;
  const tId = tableEntry?.id ?? makeTableId(dbId, modelName ?? 'unknown');

  const loc = toLocation(node, filePath);
  const id = nodeId('dbProcess', filePath, loc.line, `gorm.${methodName}:${modelName ?? 'unknown'}`);

  return {
    id,
    type: 'dbProcess',
    name: `db.${methodName}`,
    location: loc,
    children: [],
    metadata: {
      operation,
      databaseId: dbId,
      tableId: tId,
      orm: 'gorm',
    },
  };
}

function findChainRoot(node: SyntaxNode): string | null {
  if (node.type === 'identifier') return node.text;
  if (node.type === 'selector_expression') {
    const operand = node.childForFieldName('operand');
    const field = node.childForFieldName('field');
    // Stop at "<ident>.db" patterns — represents a DB struct field access
    if (operand?.type === 'identifier' && /^(db|DB|gdb|gormDB|database)$/i.test(field?.text ?? '')) {
      return `${operand.text}.${field?.text}`;
    }
    return findChainRoot(operand ?? node.namedChildren[0]);
  }
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function');
    return fn ? findChainRoot(fn) : null;
  }
  return node.text.split('.')[0] ?? null;
}

function extractModelFromArgs(
  args: SyntaxNode | null | undefined,
  tablesMap: Map<string, TableNode>,
): string | null {
  if (!args) return null;

  for (const arg of args.namedChildren) {
    const text = arg.text.replace(/^&/, '').split('{')[0].trim();
    const lower = toSnakeCase(text) + 's';

    if (tablesMap.has(lower)) return lower;
    const lowerSingular = toSnakeCase(text);
    if (tablesMap.has(lowerSingular)) return lowerSingular;
    if (/^[A-Z]/.test(text)) return lower;
  }

  return null;
}

function extractColumnName(fieldName: string, tag: string | undefined): string {
  if (tag) {
    const match = tag.match(/column:([a-zA-Z_]+)/);
    if (match) return match[1];
  }
  return toSnakeCase(fieldName);
}

function toSnakeCase(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}
