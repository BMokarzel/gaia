import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation } from '../../../utils/ast-helpers';
import { nodeId, resourceId, tableId as makeTableId } from '../../../utils/id';
import type { DbProcessNode, DatabaseNode, TableNode } from '../../../types/topology';

const JDBC_METHODS: Record<string, DbProcessNode['metadata']['operation']> = {
  executeQuery: 'findMany',
  executeUpdate: 'update',
  execute: 'raw',
  prepareStatement: 'raw',
  prepareCall: 'raw',
  query: 'findMany',
  queryForObject: 'findUnique',
  queryForList: 'findMany',
  update: 'update',
  batchUpdate: 'updateMany',
};

export interface JDBCExtractionResult {
  dbNodes: DbProcessNode[];
  database: DatabaseNode;
}

export function extractJDBCOperations(
  rootNode: SyntaxNode,
  filePath: string,
): JDBCExtractionResult {
  const dbAlias = 'jdbc';
  const dbId = resourceId('database', dbAlias);

  const database: DatabaseNode = {
    id: dbId,
    type: 'database', name: dbAlias,
    metadata: { engine: 'postgresql', category: 'sql', connectionAlias: dbAlias },
    tables: [],
  };

  const tablesMap = new Map<string, TableNode>();
  const dbNodes: DbProcessNode[] = [];

  for (const call of findAll(rootNode, 'method_invocation')) {
    const obj = call.childForFieldName('object')?.text ?? '';
    const method = call.childForFieldName('name')?.text ?? '';
    const args = call.childForFieldName('arguments');

    // conn.prepareStatement(...), jdbcTemplate.queryForObject(...)
    if (!/conn|connection|jdbc|template|stmt|statement/i.test(obj)) continue;

    const operation = JDBC_METHODS[method];
    if (!operation) continue;

    // Extract table name from SQL string argument
    const firstArg = args?.namedChildren[0];
    const sql = firstArg?.text.replace(/^["']|["']$/g, '') ?? '';
    const tableName = extractTableFromSQL(sql);

    const tableKey = tableName.toLowerCase();
    if (tableName !== 'unknown' && !tablesMap.has(tableKey)) {
      const tId = makeTableId(dbId, tableName);
      tablesMap.set(tableKey, {
        id: tId, type: 'table', name: tableName, columns: [],
        metadata: { kind: 'table', databaseId: dbId, entityName: tableName, hasTimestamps: false, hasSoftDelete: false, columns: [] },
      });
    }

    const table = tablesMap.get(tableKey) ?? { id: makeTableId(dbId, 'unknown'), name: 'unknown' } as TableNode;
    const loc = toLocation(call, filePath);
    const id = nodeId('dbProcess', filePath, loc.line, `jdbc.${method}`);

    dbNodes.push({
      id, type: 'dbProcess',
      name: `${tableName !== 'unknown' ? tableName + '.' : ''}${method}`,
      location: loc, children: [],
      metadata: { operation, databaseId: dbId, tableId: table.id, orm: 'jdbc' },
      raw: sql.slice(0, 300) || undefined,
    });
  }

  database.tables = Array.from(tablesMap.values());
  return { dbNodes, database };
}

function extractTableFromSQL(sql: string): string {
  // FROM table / INTO table / UPDATE table / JOIN table
  const match = sql.match(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/i);
  return match ? match[1].split('.').pop()! : 'unknown';
}
