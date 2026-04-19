"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPrismaOperations = extractPrismaOperations;
const ast_helpers_1 = require("../../../utils/ast-helpers");
const id_1 = require("../../../utils/id");
/** Operações Prisma e seu mapeamento para a operação canônica */
const PRISMA_OPERATIONS = {
    findUnique: 'findUnique',
    findFirst: 'findFirst',
    findMany: 'findMany',
    create: 'create',
    createMany: 'createMany',
    update: 'update',
    updateMany: 'updateMany',
    upsert: 'upsert',
    delete: 'delete',
    deleteMany: 'deleteMany',
    aggregate: 'aggregate',
    groupBy: 'groupBy',
    count: 'count',
    queryRaw: 'raw',
    executeRaw: 'raw',
    $transaction: 'transaction',
    $queryRaw: 'raw',
    $executeRaw: 'raw',
};
/**
 * Extrai operações Prisma de um arquivo TypeScript.
 * Detecta padrões:
 *   - this.prisma.<model>.<operation>(...)
 *   - prisma.<model>.<operation>(...)
 *   - client.<model>.<operation>(...)
 */
function extractPrismaOperations(rootNode, filePath) {
    const dbAlias = 'prisma';
    const dbId = (0, id_1.resourceId)('database', dbAlias);
    const database = {
        id: dbId,
        type: 'database',
        name: dbAlias,
        metadata: {
            engine: 'postgresql',
            category: 'sql',
            connectionAlias: dbAlias,
        },
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
        // Precisa ter pelo menos: prisma | <model> | <operation>
        if (chain.length < 3)
            continue;
        // Verifica se a chain começa com um nome de cliente Prisma
        const root = chain[0];
        const isPrismaClient = root === 'prisma'
            || root === 'this' // this.prisma → chain = ['this', 'prisma', model, op]
            || root.toLowerCase().includes('prisma')
            || root.toLowerCase().includes('client');
        if (!isPrismaClient)
            continue;
        // Encontra onde começa o model name
        // chain: ['this', 'prisma', 'user', 'findMany'] → model='user', op='findMany'
        // chain: ['prisma', 'user', 'findMany'] → model='user', op='findMany'
        let modelIndex = chain.findIndex((part, i) => i > 0 && PRISMA_OPERATIONS[chain[i + 1] ?? ''] !== undefined);
        if (modelIndex === -1) {
            // Tenta padrão: último-1 é model, último é operation
            modelIndex = chain.length - 2;
        }
        if (modelIndex < 0 || modelIndex >= chain.length - 1)
            continue;
        const modelName = chain[modelIndex];
        const operationName = chain[modelIndex + 1];
        if (!modelName || !operationName)
            continue;
        if (modelName.startsWith('$'))
            continue; // Ignora $transaction, $queryRaw no nível do client
        const operation = PRISMA_OPERATIONS[operationName];
        if (!operation)
            continue;
        // Cria/recupera a TableNode para este model
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
                    entityName: toPascalCase(modelName),
                    hasTimestamps: false,
                    hasSoftDelete: false,
                    columns: [],
                },
            });
        }
        const table = tablesMap.get(tableKey);
        // Extrai campos do select/include/where/data dos argumentos
        const args = call.childForFieldName('arguments');
        if (args) {
            const fields = extractPrismaFields(args, operation);
            if (fields.length > 0) {
                mergeColumnsFromUsage(table, fields);
            }
        }
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
                orm: 'prisma',
                conditions: extractWhereCondition(args),
                fields: extractSelectFields(args),
                relations: extractIncludeRelations(args),
                pagination: extractPagination(args),
            },
            raw: call.text.length < 300 ? call.text : undefined,
        });
    }
    database.tables = Array.from(tablesMap.values());
    return { dbNodes, database };
}
/** Extrai campos referenciados nos args de uma operação Prisma */
function extractPrismaFields(argsNode, operation) {
    const fields = [];
    const text = argsNode.text;
    // Extrai chaves de objetos {select: {field1: true, field2: true}}
    const selectMatch = text.match(/select\s*:\s*\{([^}]+)\}/);
    if (selectMatch) {
        const keys = [...selectMatch[1].matchAll(/(\w+)\s*:/g)].map(m => m[1]);
        fields.push(...keys);
    }
    // Extrai campos de data: {data: {field1: ..., field2: ...}}
    const dataMatch = text.match(/data\s*:\s*\{([^}]+)\}/);
    if (dataMatch) {
        const keys = [...dataMatch[1].matchAll(/(\w+)\s*:/g)].map(m => m[1]);
        fields.push(...keys);
    }
    return [...new Set(fields)];
}
/** Extrai a condição where como string */
function extractWhereCondition(argsNode) {
    if (!argsNode)
        return undefined;
    const match = argsNode.text.match(/where\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/);
    return match ? match[1].replace(/\s+/g, ' ') : undefined;
}
/** Extrai campos do select */
function extractSelectFields(argsNode) {
    if (!argsNode)
        return undefined;
    const match = argsNode.text.match(/select\s*:\s*\{([^}]+)\}/);
    if (!match)
        return undefined;
    return [...match[1].matchAll(/(\w+)\s*:\s*true/g)].map(m => m[1]);
}
/** Extrai relações do include */
function extractIncludeRelations(argsNode) {
    if (!argsNode)
        return undefined;
    const match = argsNode.text.match(/include\s*:\s*\{([^}]+)\}/);
    if (!match)
        return undefined;
    return [...match[1].matchAll(/(\w+)\s*:/g)].map(m => m[1]);
}
/** Extrai paginação */
function extractPagination(argsNode) {
    if (!argsNode)
        return undefined;
    const text = argsNode.text;
    const hasSkip = text.includes('skip:') || text.includes('skip :');
    const hasTake = text.includes('take:') || text.includes('take :');
    const hasCursor = text.includes('cursor:') || text.includes('cursor :');
    if (hasCursor)
        return { strategy: 'cursor', limitField: 'take', offsetField: 'cursor' };
    if (hasSkip || hasTake)
        return { strategy: 'offset', limitField: 'take', offsetField: 'skip' };
    return undefined;
}
/** Adiciona colunas inferidas do uso à TableNode */
function mergeColumnsFromUsage(table, fieldNames) {
    const existing = new Set((table.metadata.columns ?? []).map(c => c.name));
    for (const name of fieldNames) {
        if (existing.has(name) || name === 'id')
            continue;
        if (!table.metadata.columns)
            table.metadata.columns = [];
        // Detecta timestamps
        if (name === 'createdAt' || name === 'updatedAt') {
            table.metadata.hasTimestamps = true;
        }
        if (name === 'deletedAt') {
            table.metadata.hasSoftDelete = true;
        }
        table.metadata.columns.push({
            name,
            type: 'unknown',
            nullable: true,
            unique: false,
            primaryKey: false,
            mutable: true,
            sourceKind: 'orm_method',
        });
        existing.add(name);
    }
}
function toPascalCase(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
//# sourceMappingURL=prisma.extractor.js.map