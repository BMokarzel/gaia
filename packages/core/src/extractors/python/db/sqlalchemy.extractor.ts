import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation, fieldText, extractStringValue } from '../../../utils/ast-helpers';
import { nodeId, resourceId, tableId as makeTableId } from '../../../utils/id';
import type { DbProcessNode, DatabaseNode, TableNode } from '../../../types/topology';

/** SQLAlchemy ORM method → topology operation */
const ORM_METHODS: Record<string, DbProcessNode['metadata']['operation']> = {
  query: 'findMany',
  get: 'findUnique',
  filter: 'findMany',
  filter_by: 'findMany',
  all: 'findMany',
  first: 'findFirst',
  one: 'findFirst',
  one_or_none: 'findFirst',
  scalar: 'findFirst',
  scalar_one: 'findFirst',
  add: 'create',
  add_all: 'createMany',
  merge: 'upsert',
  delete: 'delete',
  bulk_insert_mappings: 'createMany',
  bulk_update_mappings: 'updateMany',
};

/** Patterns that indicate a DB session variable */
const SESSION_RE = /^(self\.)?(db|session|sess|database|engine|conn|connection)$/i;

export function extractSQLAlchemyOperations(
  rootNode: SyntaxNode,
  filePath: string,
): { dbNodes: DbProcessNode[]; database: DatabaseNode } {
  const dbAlias = 'sqlalchemy';
  const dbId = resourceId('database', dbAlias);

  const database: DatabaseNode = {
    id: dbId,
    type: 'database',
    name: 'sqlalchemy',
    metadata: {
      engine: 'postgresql',
      category: 'sql',
      connectionAlias: dbAlias,
    },
    tables: [],
  };

  const tablesMap = new Map<string, TableNode>();
  const dbNodes: DbProcessNode[] = [];

  // Detect ORM model classes (inherit from Base / db.Model / DeclarativeBase)
  for (const classNode of findAll(rootNode, 'class_definition')) {
    if (isOrmModel(classNode)) {
      const table = extractModelTable(classNode, dbId);
      if (table) {
        tablesMap.set(table.name.toLowerCase(), table);
        database.tables.push(table);
      }
    }
  }

  // Detect DB operations in calls
  for (const call of findAll(rootNode, 'call')) {
    const dbOp = buildDbOperation(call, filePath, dbId, tablesMap);
    if (dbOp) dbNodes.push(dbOp);
  }

  // Detect raw SQL via session.execute(text("SELECT ..."))
  for (const call of findAll(rootNode, 'call')) {
    const op = buildRawSqlOperation(call, filePath, dbId);
    if (op) dbNodes.push(op);
  }

  return { dbNodes, database };
}

function isOrmModel(classNode: SyntaxNode): boolean {
  const args = classNode.childForFieldName('superclasses');
  if (!args) return false;
  const text = args.text;
  return /Base|db\.Model|DeclarativeBase|DeclarativeMeta|MappedAsDataclass/.test(text);
}

function extractModelTable(classNode: SyntaxNode, dbId: string): TableNode | null {
  const className = fieldText(classNode, 'name');
  if (!className) return null;

  let tableName = toSnakeCase(className);
  const body = classNode.childForFieldName('body');
  if (body) {
    for (const stmt of body.namedChildren) {
      if (stmt.type === 'expression_statement') {
        const assign = stmt.namedChildren[0];
        if (assign?.type === 'assignment') {
          const left = assign.childForFieldName('left');
          if (left?.text === '__tablename__') {
            const right = assign.childForFieldName('right');
            if (right) tableName = extractStringValue(right) ?? tableName;
          }
        }
      }
    }
  }

  const tableNode: TableNode = {
    id: makeTableId(dbId, tableName),
    type: 'table',
    name: tableName,
    metadata: {
      kind: 'table',
      databaseId: dbId,
      entityName: className,
      hasTimestamps: false,
      hasSoftDelete: false,
      columns: [],
    },
  };

  if (body) {
    for (const stmt of body.namedChildren) {
      if (stmt.type === 'expression_statement') {
        const assign = stmt.namedChildren[0];
        if (assign?.type === 'assignment') {
          const left = assign.childForFieldName('left');
          const right = assign.childForFieldName('right');
          if (!left || !right) continue;
          if (isColumnDefinition(right)) {
            const colName = left.text;
            const sqlType = extractColumnType(right);
            tableNode.metadata.columns!.push({
              name: colName,
              type: sqlType ?? 'unknown',
              nullable: !right.text.includes('nullable=False') && !right.text.includes('primary_key=True'),
              unique: right.text.includes('unique=True'),
              primaryKey: right.text.includes('primary_key=True'),
              sourceKind: 'entity',
            });
          }
        }
      }
      if (stmt.type === 'annotated_assignment') {
        const left = stmt.childForFieldName('left');
        const right = stmt.childForFieldName('right');
        const annotation = stmt.childForFieldName('annotation');
        if (left && right && annotation && /Mapped|Column/.test(annotation.text)) {
          const colName = left.text;
          const sqlType = extractMappedType(annotation);
          tableNode.metadata.columns!.push({
            name: colName,
            type: sqlType ?? 'unknown',
            nullable: !right.text.includes('nullable=False'),
            unique: right.text.includes('unique=True'),
            primaryKey: right.text.includes('primary_key=True'),
            sourceKind: 'entity',
          });
        }
      }
    }
  }

  return tableNode;
}

function isColumnDefinition(node: SyntaxNode): boolean {
  if (node.type !== 'call') return false;
  const fn = node.childForFieldName('function');
  if (!fn) return false;
  const name = fn.type === 'attribute' ? fn.childForFieldName('attribute')?.text : fn.text;
  return name === 'Column' || name === 'mapped_column' || name === 'relationship';
}

function extractColumnType(node: SyntaxNode): string | null {
  const args = node.childForFieldName('arguments');
  const first = args?.namedChildren[0];
  if (!first) return null;
  const name = first.type === 'call'
    ? first.childForFieldName('function')?.text
    : first.text;
  return name ?? null;
}

function extractMappedType(annotation: SyntaxNode): string | null {
  const text = annotation.text;
  const match = text.match(/Mapped\[(.+)\]/);
  return match ? match[1] : annotation.text;
}

function buildDbOperation(
  node: SyntaxNode,
  filePath: string,
  dbId: string,
  tablesMap: Map<string, TableNode>,
): DbProcessNode | null {
  const fn = node.childForFieldName('function');
  if (!fn || fn.type !== 'attribute') return null;

  const obj = fn.childForFieldName('object');
  const attr = fn.childForFieldName('attribute');
  if (!obj || !attr) return null;

  const objText = obj.text;
  const methodName = attr.text;

  if (!SESSION_RE.test(objText) && !objText.endsWith('.session') && !objText.endsWith('.db')) {
    return null;
  }

  const operation = ORM_METHODS[methodName];
  if (!operation) return null;

  const args = node.childForFieldName('arguments');
  const firstArg = args?.namedChildren[0];
  const modelName = firstArg?.text.split('(')[0].toLowerCase().replace(/^self\./, '') ?? 'unknown';
  const tableEntry = tablesMap.get(modelName);
  const tId = tableEntry?.id ?? makeTableId(dbId, modelName);

  const loc = toLocation(node, filePath);
  const id = nodeId('dbProcess', filePath, loc.line, `${methodName}:${modelName}`);

  return {
    id,
    type: 'dbProcess',
    name: `${objText}.${methodName}`,
    location: loc,
    children: [],
    metadata: {
      operation,
      databaseId: dbId,
      tableId: tId,
      orm: 'sqlalchemy',
    },
  };
}

function buildRawSqlOperation(
  node: SyntaxNode,
  filePath: string,
  dbId: string,
): DbProcessNode | null {
  const fn = node.childForFieldName('function');
  if (!fn) return null;

  const methodName = fn.type === 'attribute'
    ? fn.childForFieldName('attribute')?.text
    : fn.text;

  if (methodName !== 'execute') return null;

  const args = node.childForFieldName('arguments');
  const firstArg = args?.namedChildren[0];
  if (!firstArg) return null;

  const sqlText = extractRawSqlText(firstArg);
  if (!sqlText) return null;

  const operation = detectSqlOperation(sqlText);
  const tableName = extractFirstTableFromSql(sqlText);

  const loc = toLocation(node, filePath);
  const id = nodeId('dbProcess', filePath, loc.line, `execute:${sqlText.slice(0, 30)}`);

  return {
    id,
    type: 'dbProcess',
    name: `execute (${sqlText.slice(0, 50)})`,
    location: loc,
    children: [],
    metadata: {
      operation,
      databaseId: dbId,
      tableId: makeTableId(dbId, tableName ?? 'unknown'),
      orm: 'sqlalchemy',
      conditions: sqlText.slice(0, 300),
    },
  };
}

function extractRawSqlText(node: SyntaxNode): string | null {
  if (node.type === 'string') return node.text.replace(/^['"`]|['"`]$/g, '');
  if (node.type === 'call') {
    const fn = node.childForFieldName('function');
    if (fn?.text === 'text' || fn?.text === 'sa.text') {
      const args = node.childForFieldName('arguments');
      const first = args?.namedChildren[0];
      return first ? (extractStringValue(first) ?? null) : null;
    }
  }
  return null;
}

function detectSqlOperation(sql: string): DbProcessNode['metadata']['operation'] {
  const upper = sql.trimStart().toUpperCase();
  if (upper.startsWith('SELECT')) return 'findMany';
  if (upper.startsWith('INSERT')) return 'create';
  if (upper.startsWith('UPDATE')) return 'update';
  if (upper.startsWith('DELETE')) return 'delete';
  return 'raw';
}

function extractFirstTableFromSql(sql: string): string | null {
  const fromMatch = sql.match(/FROM\s+["'`]?(\w+)["'`]?/i);
  return fromMatch ? fromMatch[1].toLowerCase() : null;
}

function toSnakeCase(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}
