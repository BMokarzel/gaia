"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractSequelizeOperations = extractSequelizeOperations;
const ast_helpers_1 = require("../../../utils/ast-helpers");
const id_1 = require("../../../utils/id");
const SEQUELIZE_OPERATIONS = {
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
function extractSequelizeOperations(rootNode, filePath) {
    const dbAlias = 'sequelize';
    const dbId = (0, id_1.resourceId)('database', dbAlias);
    const database = {
        id: dbId,
        type: 'database',
        name: dbAlias,
        metadata: { engine: 'postgresql', category: 'sql', connectionAlias: dbAlias },
        tables: [],
    };
    const tablesMap = new Map();
    const dbNodes = [];
    const calls = (0, ast_helpers_1.findAll)(rootNode, 'call_expression');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn || fn.type !== 'member_expression')
            continue;
        const chain = (0, ast_helpers_1.memberChain)(fn);
        if (chain.length < 2)
            continue;
        const operationName = chain[chain.length - 1];
        const operation = SEQUELIZE_OPERATIONS[operationName];
        if (!operation)
            continue;
        // O model Sequelize geralmente é o objeto antes da operação
        // User.findAll() → chain = ['User', 'findAll']
        const modelName = chain[chain.length - 2];
        if (!modelName || modelName === 'this')
            continue;
        // Filtra nomes que claramente não são modelos
        if (modelName.length < 2 || /^[a-z]/.test(modelName))
            continue;
        const tableKey = modelName.toLowerCase();
        if (!tablesMap.has(tableKey)) {
            const tId = (0, id_1.tableId)(dbId, modelName);
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
        const table = tablesMap.get(tableKey);
        const loc = (0, ast_helpers_1.toLocation)(call, filePath);
        const id = (0, id_1.nodeId)('dbProcess', filePath, loc.line, `${modelName}.${operationName}`);
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
//# sourceMappingURL=sequelize.extractor.js.map