"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTypeORMOperations = extractTypeORMOperations;
const ast_helpers_1 = require("../../../utils/ast-helpers");
const id_1 = require("../../../utils/id");
/** Mapeamento de métodos TypeORM para operações canônicas */
const TYPEORM_OPERATIONS = {
    find: 'findMany',
    findOne: 'findFirst',
    findOneBy: 'findFirst',
    findAndCount: 'findMany',
    findBy: 'findMany',
    save: 'upsert',
    insert: 'create',
    update: 'update',
    delete: 'delete',
    softDelete: 'delete',
    restore: 'update',
    count: 'count',
    createQueryBuilder: 'raw',
    query: 'raw',
    upsert: 'upsert',
};
/** Padrões que indicam uso de repositório TypeORM */
const REPO_PATTERNS = [
    /repository/i,
    /repo/i,
    /Repository/,
    /getRepository/,
];
/**
 * Extrai operações TypeORM de um arquivo TypeScript.
 * Detecta:
 *   - this.userRepository.find(...)
 *   - getRepository(User).findOne(...)
 *   - @Entity(), @Column() para schema
 */
function extractTypeORMOperations(rootNode, filePath) {
    const dbAlias = 'typeorm';
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
    // 1. Extrai schema a partir de @Entity / @Column decorators
    const entityTables = extractEntitySchema(rootNode, filePath, dbId);
    for (const table of entityTables) {
        tablesMap.set(table.name.toLowerCase(), table);
    }
    // 2. Extrai operações de repositório
    const calls = (0, ast_helpers_1.findAll)(rootNode, 'call_expression');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn || fn.type !== 'member_expression')
            continue;
        const chain = (0, ast_helpers_1.memberChain)(fn);
        if (chain.length < 2)
            continue;
        const operationName = chain[chain.length - 1];
        const operation = TYPEORM_OPERATIONS[operationName];
        if (!operation)
            continue;
        // Verifica se o objeto pai parece um repositório
        const objPart = chain.slice(0, -1).join('.');
        const looksLikeRepo = REPO_PATTERNS.some(p => p.test(objPart));
        if (!looksLikeRepo)
            continue;
        // Tenta inferir o model do nome do repositório
        // this.userRepository → 'user'
        const modelName = inferModelFromRepoName(objPart);
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
                orm: 'typeorm',
                conditions: undefined,
            },
            raw: call.text.length < 300 ? call.text : undefined,
        });
    }
    database.tables = Array.from(tablesMap.values());
    return { dbNodes, database, tables: database.tables };
}
/**
 * Extrai schema de entidades TypeORM via decorators @Entity, @Column, etc.
 */
function extractEntitySchema(rootNode, filePath, dbId) {
    const tables = [];
    const classes = (0, ast_helpers_1.findAll)(rootNode, 'class_declaration');
    for (const classNode of classes) {
        const entityDec = (0, ast_helpers_1.getDecoratorsByName)(classNode, 'Entity');
        if (entityDec.length === 0)
            continue;
        // Nome da tabela: @Entity('users') ou derivado do nome da classe
        const entityArg = (0, ast_helpers_1.decoratorFirstArg)(entityDec[0]);
        const className = (0, ast_helpers_1.fieldText)(classNode, 'name') ?? 'Unknown';
        const tableName = entityArg ?? toSnakeCase(className);
        const tId = (0, id_1.tableId)(dbId, tableName);
        const columns = [];
        // Procura propriedades com @Column, @PrimaryGeneratedColumn, etc.
        const classBody = classNode.childForFieldName('body');
        if (classBody) {
            const properties = (0, ast_helpers_1.findAll)(classBody, 'public_field_definition');
            for (const prop of properties) {
                const col = extractColumnDef(prop);
                if (col)
                    columns.push(col);
            }
        }
        const hasTimestamps = columns.some(c => c.name === 'createdAt' || c.name === 'created_at');
        const hasSoftDelete = columns.some(c => c.name === 'deletedAt' || c.name === 'deleted_at');
        tables.push({
            id: tId,
            type: 'table',
            name: tableName,
            metadata: {
                kind: 'table',
                databaseId: dbId,
                entityName: className,
                columns,
                hasTimestamps,
                hasSoftDelete,
            },
        });
    }
    return tables;
}
/** Extrai definição de coluna a partir de uma propriedade TypeORM */
function extractColumnDef(propNode) {
    const decorators = (0, ast_helpers_1.getDecorators)(propNode);
    if (decorators.length === 0)
        return null;
    const hasColumn = decorators.some(d => ['Column', 'PrimaryColumn', 'PrimaryGeneratedColumn', 'CreateDateColumn',
        'UpdateDateColumn', 'DeleteDateColumn', 'VersionColumn', 'Generated'].includes((0, ast_helpers_1.decoratorName)(d)));
    if (!hasColumn)
        return null;
    const propName = propNode.childForFieldName('name')?.text ?? '';
    const decoratorNames = decorators.map(d => (0, ast_helpers_1.decoratorName)(d));
    const isPrimary = decoratorNames.some(n => n === 'PrimaryGeneratedColumn' || n === 'PrimaryColumn');
    const isAutoIncrement = decoratorNames.includes('PrimaryGeneratedColumn');
    const isCreateDate = decoratorNames.includes('CreateDateColumn');
    const isUpdateDate = decoratorNames.includes('UpdateDateColumn');
    const isDeleteDate = decoratorNames.includes('DeleteDateColumn');
    // Extrai tipo do decorator @Column({ type: 'varchar', length: 255 })
    const columnDec = decorators.find(d => (0, ast_helpers_1.decoratorName)(d) === 'Column');
    let colType = 'varchar';
    let length;
    let nullable = true;
    let unique = false;
    if (columnDec) {
        const args = columnDec.children.find(c => c.type === 'call_expression')
            ?.childForFieldName('arguments');
        if (args) {
            const text = args.text;
            const typeMatch = text.match(/type\s*:\s*['"]([^'"]+)['"]/);
            if (typeMatch)
                colType = typeMatch[1];
            const lengthMatch = text.match(/length\s*:\s*(\d+)/);
            if (lengthMatch)
                length = parseInt(lengthMatch[1], 10);
            if (text.includes('nullable: false'))
                nullable = false;
            if (text.includes('unique: true'))
                unique = true;
        }
    }
    if (isCreateDate || isUpdateDate)
        colType = 'timestamp';
    if (isDeleteDate) {
        colType = 'timestamp';
        nullable = true;
    }
    return {
        name: propName,
        type: colType,
        nullable,
        unique: unique || isPrimary,
        primaryKey: isPrimary,
        autoIncrement: isAutoIncrement,
        length,
        decorators: decoratorNames,
        sourceKind: 'entity',
    };
}
function inferModelFromRepoName(repoPath) {
    // this.userRepository → 'user'
    // this.userRepo → 'user'
    // userRepository → 'user'
    const match = repoPath.match(/(?:this\.)?(\w+?)(?:Repository|Repo)(?:\b|$)/i);
    if (match)
        return match[1];
    // getRepository(User) → 'user' (não conseguimos inferir sem resolver o tipo)
    return 'unknown';
}
function toSnakeCase(str) {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}
function toPascalCase(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
//# sourceMappingURL=typeorm.extractor.js.map