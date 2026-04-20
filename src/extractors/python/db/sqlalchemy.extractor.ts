import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation, memberChain } from '../../../utils/ast-helpers';
import { nodeId, resourceId, tableId as makeTableId } from '../../../utils/id';
import type { DbProcessNode, DatabaseNode, TableNode, ColumnDef } from '../../../types/topology';

const SQLALCHEMY_OPERATIONS: Record<string, DbProcessNode['metadata']['operation']> = {
  all: 'findMany',
  first: 'findFirst',
  one: 'findUnique',
  one_or_none: 'findFirst',
  scalar: 'findUnique',
  scalars: 'findMany',
  get: 'findUnique',
  filter: 'findMany',
  filter_by: 'findMany',
  where: 'findMany',
  add: 'create',
  add_all: 'createMany',
  merge: 'upsert',
  delete: 'delete',
  update: 'update',
  count: 'count',
  execute: 'raw',
  query: 'findMany',
};

const SESSION_NAMES = new Set(['db', 'session', 'sess', 'DB', 'Session', 'async_session']);

export interface SQLAlchemyExtractionResult {
  dbNodes: DbProcessNode[];
  database: DatabaseNode;
}

export function extractSQLAlchemyOperations(
  rootNode: SyntaxNode,
  filePath: string,
): SQLAlchemyExtractionResult {
  const dbAlias = 'sqlalchemy';
  const dbId = resourceId('database', dbAlias);

  const database: DatabaseNode = {
    id: dbId,
    type: 'database',
    name: dbAlias,
    metadata: { engine: 'postgresql', category: 'sql', connectionAlias: dbAlias },
    tables: [],
  };

  const tablesMap = new Map<string, TableNode>();
  const dbNodes: DbProcessNode[] = [];

  // Detect ORM model classes (inherit from Base, DeclarativeBase, Model)
  for (const cls of findAll(rootNode, 'class_definition')) {
    const bases = (cls.childForFieldName('superclasses')?.namedChildren ?? []).map(c => c.text);
    const isModel = bases.some(b => /Base|DeclarativeBase|DeclarativeMeta/i.test(b));
    if (!isModel) continue;

    const name = cls.childForFieldName('name')?.text ?? 'Unknown';
    const tableName = extractTableName(cls) ?? toSnakeCase(name);
    const tableKey = tableName.toLowerCase();

    if (!tablesMap.has(tableKey)) {
      const tId = makeTableId(dbId, tableName);
      tablesMap.set(tableKey, {
        id: tId,
        type: 'table',
        name: tableName,
        columns: [],
        metadata: {
          kind: 'table',
          databaseId: dbId,
          entityName: name,
          columns: extractSAColumns(cls, tId),
          hasTimestamps: false,
          hasSoftDelete: false,
        },
      });
    }
  }

  // Detect session/db method calls: db.query(Model).filter(...).all()
  // Or: session.execute(select(Model).where(...))
  const calls = findAll(rootNode, 'call');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    if (fn.type !== 'attribute') continue;

    const obj = fn.childForFieldName('object');
    const method = fn.childForFieldName('attribute');
    if (!obj || !method) continue;

    const objText = obj.text;
    const methodName = method.text;

    // session.add(user), db.delete(obj), etc.
    const isSession = SESSION_NAMES.has(objText)
      || SESSION_NAMES.has(objText.split('.').pop() ?? '')
      || /session|db\b/i.test(objText);

    const operation = SQLALCHEMY_OPERATIONS[methodName];

    if (!isSession || !operation) {
      // Check for Model.query.filter_by(), Model.query.all() pattern
      const chain = memberChain(fn);
      if (chain.length >= 3 && chain[chain.length - 2] === 'query') {
        const opName = chain[chain.length - 1];
        const op = SQLALCHEMY_OPERATIONS[opName];
        if (!op) continue;

        const modelName = chain[0];
        if (!/^[A-Z]/.test(modelName)) continue;

        processModelOperation(call, filePath, modelName, opName, op, dbId, tablesMap, dbNodes);
        continue;
      }
      continue;
    }

    // Try to infer model from first argument
    const args = call.childForFieldName('arguments');
    const firstArg = args?.namedChildren[0];
    const modelName = firstArg ? inferModelFromArg(firstArg) : null;

    if (modelName) {
      processModelOperation(call, filePath, modelName, methodName, operation, dbId, tablesMap, dbNodes);
    } else {
      // Generic session operation without model inference
      const loc = toLocation(call, filePath);
      const id = nodeId('dbProcess', filePath, loc.line, `session.${methodName}`);
      dbNodes.push({
        id,
        type: 'dbProcess',
        name: `session.${methodName}`,
        location: loc,
        children: [],
        metadata: {
          operation,
          databaseId: dbId,
          tableId: makeTableId(dbId, 'unknown'),
          orm: 'sqlalchemy',
        },
      });
    }
  }

  database.tables = Array.from(tablesMap.values());
  return { dbNodes, database };
}

function processModelOperation(
  call: SyntaxNode,
  filePath: string,
  modelName: string,
  methodName: string,
  operation: DbProcessNode['metadata']['operation'],
  dbId: string,
  tablesMap: Map<string, TableNode>,
  dbNodes: DbProcessNode[],
): void {
  const tableKey = toSnakeCase(modelName).toLowerCase();
  if (!tablesMap.has(tableKey)) {
    const tId = makeTableId(dbId, modelName);
    tablesMap.set(tableKey, {
      id: tId,
      type: 'table',
      name: toSnakeCase(modelName),
      columns: [],
      metadata: {
        kind: 'table',
        databaseId: dbId,
        entityName: modelName,
        hasTimestamps: false,
        hasSoftDelete: false,
        columns: [],
      },
    });
  }

  const table = tablesMap.get(tableKey)!;
  const loc = toLocation(call, filePath);
  const id = nodeId('dbProcess', filePath, loc.line, `${modelName}.${methodName}`);

  dbNodes.push({
    id,
    type: 'dbProcess',
    name: `${modelName}.${methodName}`,
    location: loc,
    children: [],
    metadata: {
      operation,
      databaseId: dbId,
      tableId: table.id,
      orm: 'sqlalchemy',
    },
    raw: call.text.length < 300 ? call.text : undefined,
  });
}

function inferModelFromArg(argNode: SyntaxNode): string | null {
  // select(User) → 'User'
  // User → 'User'
  const text = argNode.text.trim();
  const match = text.match(/^(?:select\s*\(\s*)?([A-Z][a-zA-Z0-9_]*)/);
  return match ? match[1] : null;
}

function extractTableName(classNode: SyntaxNode): string | null {
  const body = classNode.childForFieldName('body') ?? classNode;
  for (const stmt of body.namedChildren) {
    if (stmt.type !== 'assignment' && stmt.type !== 'annotated_assignment') continue;
    const left = stmt.childForFieldName('left') ?? stmt.namedChildren[0];
    if (left?.text === '__tablename__') {
      const right = stmt.childForFieldName('right') ?? stmt.namedChildren[1];
      return right?.text.replace(/^['"]|['"]$/g, '') ?? null;
    }
  }
  return null;
}

function extractSAColumns(classNode: SyntaxNode, tableId: string): ColumnDef[] {
  const columns: ColumnDef[] = [];
  const body = classNode.childForFieldName('body') ?? classNode;

  for (const stmt of body.namedChildren) {
    const left = (stmt.childForFieldName('left') ?? stmt.namedChildren[0]);
    const right = (stmt.childForFieldName('right') ?? stmt.namedChildren[1]);
    if (!left || !right) continue;

    const name = left.text;
    if (name.startsWith('__') || !/^[a-z_]/.test(name)) continue;

    const rText = right.text;
    if (!rText.includes('Column(') && !rText.includes('mapped_column(')) continue;

    const isPrimary = rText.includes('primary_key=True') || rText.includes('primary_key = True');
    const isNullable = !rText.includes('nullable=False') && !rText.includes('nullable = False');
    const isUnique = rText.includes('unique=True') || rText.includes('unique = True');

    const typeMatch = rText.match(/Column\s*\(\s*([A-Za-z]+)|mapped_column\s*\(\s*([A-Za-z]+)/);
    const sqlType = typeMatch ? (typeMatch[1] ?? typeMatch[2] ?? 'varchar').toLowerCase() : 'varchar';

    columns.push({
      name,
      type: mapSATypeToSQL(sqlType),
      nullable: !isPrimary && isNullable,
      unique: isUnique || isPrimary,
      primaryKey: isPrimary,
      autoIncrement: isPrimary && rText.includes('autoincrement'),
      sourceKind: 'entity',
    });
  }

  return columns;
}

function mapSATypeToSQL(saType: string): string {
  const map: Record<string, string> = {
    string: 'varchar', text: 'text', unicode: 'varchar', unicodetext: 'text',
    integer: 'int', biginteger: 'bigint', smallinteger: 'smallint',
    float: 'float', numeric: 'decimal', boolean: 'boolean',
    date: 'date', datetime: 'timestamp', time: 'time',
    uuid: 'uuid', json: 'json', jsonb: 'jsonb',
    largebinary: 'bytea', blob: 'blob',
  };
  return map[saType.toLowerCase()] ?? saType.toLowerCase();
}

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}
