import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation, memberChain } from '../../../utils/ast-helpers';
import { nodeId, resourceId, tableId as makeTableId } from '../../../utils/id';
import type { DbProcessNode, DatabaseNode, TableNode } from '../../../types/topology';

const SEQUELIZE_OPERATIONS: Record<string, DbProcessNode['metadata']['operation']> = {
  findAll: 'findMany',
  findOne: 'findFirst',
  findByPk: 'findUnique',
  findOrCreate: 'upsert',
  count: 'count',
  create: 'create',
  bulkCreate: 'createMany',
  update: 'update',
  destroy: 'delete',
  upsert: 'upsert',
  aggregate: 'aggregate',
  findAndCountAll: 'findMany',
  max: 'aggregate',
  min: 'aggregate',
  sum: 'aggregate',
};

export interface SequelizeExtractionResult {
  dbNodes: DbProcessNode[];
  database: DatabaseNode;
}

export function extractSequelizeOperations(
  rootNode: SyntaxNode,
  filePath: string,
): SequelizeExtractionResult {
  const dbAlias = 'sequelize';
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

  const calls = findAll(rootNode, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn || fn.type !== 'member_expression') continue;

    const chain = memberChain(fn);
    if (chain.length < 2) continue;

    const operationName = chain[chain.length - 1];
    const operation = SEQUELIZE_OPERATIONS[operationName];
    if (!operation) continue;

    // O model Sequelize geralmente é o objeto antes da operação
    // User.findAll() → chain = ['User', 'findAll']
    const modelName = chain[chain.length - 2];
    if (!modelName || modelName === 'this') continue;

    // Filtra nomes que claramente não são modelos
    if (modelName.length < 2 || /^[a-z]/.test(modelName)) continue;

    const tableKey = modelName.toLowerCase();
    if (!tablesMap.has(tableKey)) {
      const tId = makeTableId(dbId, modelName);
      tablesMap.set(tableKey, {
        id: tId,
        type: 'table',
        name: modelName,
        metadata: {
          kind: 'table',
          databaseId: dbId,
          entityName: modelName,
          hasTimestamps: true, // Sequelize tem timestamps por padrão
          hasSoftDelete: false,
          columns: [],
        },
      });
    }

    const table = tablesMap.get(tableKey)!;
    const loc = toLocation(call, filePath);
    const id = nodeId('dbProcess', filePath, loc.line, `${modelName}.${operationName}`);

    dbNodes.push({
      id,
      type: 'dbProcess',
      name: `${modelName}.${operationName}`,
      location: loc,
      children: [],
      metadata: {
        operation,
        databaseId: dbId,
        tableId: table.id,
        orm: 'sequelize',
      },
      raw: call.text.length < 300 ? call.text : undefined,
    });
  }

  database.tables = Array.from(tablesMap.values());
  return { dbNodes, database };
}
