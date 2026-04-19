"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractJPAOperations = extractJPAOperations;
const ast_helpers_1 = require("../../../utils/ast-helpers");
const id_1 = require("../../../utils/id");
/**
 * Extrai entidades JPA/Hibernate e repositórios Spring Data de arquivos Java.
 * Detecta: @Entity, @Table, @Column, @Id, repositórios com findBy*, save, delete
 */
function extractJPAOperations(rootNode, filePath) {
    const dbAlias = 'jpa';
    const dbId = (0, id_1.resourceId)('database', dbAlias);
    const database = {
        id: dbId,
        type: 'database',
        name: 'jpa',
        metadata: {
            engine: 'postgresql',
            category: 'sql',
            connectionAlias: dbAlias,
        },
        tables: [],
    };
    const tablesMap = new Map();
    const dbNodes = [];
    const classes = (0, ast_helpers_1.findAll)(rootNode, 'class_declaration');
    for (const classNode of classes) {
        const annotations = (0, ast_helpers_1.findAll)(classNode, 'marker_annotation')
            .concat((0, ast_helpers_1.findAll)(classNode, 'annotation'));
        // Detecta @Entity para extrair schema
        const entityAnn = annotations.find(a => a.childForFieldName('name')?.text === 'Entity');
        if (entityAnn) {
            const table = extractEntityTable(classNode, annotations, dbId);
            if (table) {
                tablesMap.set(table.name.toLowerCase(), table);
                database.tables.push(table);
            }
            continue;
        }
        // Detecta repositório JPA (interface extends JpaRepository/CrudRepository)
        const isInterface = classNode.type === 'interface_declaration';
        if (isInterface) {
            const repoOps = extractRepositoryOperations(classNode, filePath, dbId, tablesMap);
            dbNodes.push(...repoOps);
        }
    }
    // Também procura chamadas de método de repositório no código
    const methodCalls = (0, ast_helpers_1.findAll)(rootNode, 'method_invocation');
    for (const call of methodCalls) {
        const methodName = call.childForFieldName('name')?.text ?? '';
        const operation = mapJPAMethod(methodName);
        if (!operation)
            continue;
        const obj = call.childForFieldName('object');
        const objText = obj?.text ?? '';
        // Verifica se parece um repositório
        if (!/(repository|repo|service)/i.test(objText) && !/(this\.)/i.test(objText))
            continue;
        const modelName = inferModelFromRepo(objText);
        const tableKey = modelName.toLowerCase();
        if (!tablesMap.has(tableKey) && modelName !== 'unknown') {
            const tId = (0, id_1.tableId)(dbId, modelName);
            const table = {
                id: tId,
                type: 'table',
                name: modelName,
                metadata: {
                    kind: 'table',
                    databaseId: dbId,
                    entityName: modelName,
                    hasTimestamps: false,
                    hasSoftDelete: false,
                    columns: [],
                },
            };
            tablesMap.set(tableKey, table);
            database.tables.push(table);
        }
        const table = tablesMap.get(tableKey) ?? { id: (0, id_1.tableId)(dbId, 'unknown'), name: 'unknown' };
        const loc = (0, ast_helpers_1.toLocation)(call, filePath);
        const id = (0, id_1.nodeId)('dbProcess', filePath, loc.line, `${modelName}.${methodName}`);
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
                orm: 'jpa',
            },
        });
    }
    return { dbNodes, database };
}
function extractEntityTable(classNode, annotations, dbId) {
    const className = (0, ast_helpers_1.fieldText)(classNode, 'name') ?? 'Unknown';
    // Detecta nome da tabela via @Table(name = "users")
    const tableAnn = annotations.find(a => a.childForFieldName('name')?.text === 'Table');
    const tableName = tableAnn
        ? (extractAnnotationStringAttr(tableAnn, 'name') ?? toSnakeCase(className))
        : toSnakeCase(className);
    const tId = (0, id_1.tableId)(dbId, tableName);
    const columns = [];
    // Extrai campos da classe
    const fields = (0, ast_helpers_1.findAll)(classNode, 'field_declaration');
    for (const field of fields) {
        const fieldAnnotations = (0, ast_helpers_1.findAll)(field, 'marker_annotation')
            .concat((0, ast_helpers_1.findAll)(field, 'annotation'));
        const hasColumnAnn = fieldAnnotations.some(a => ['Column', 'Id', 'GeneratedValue', 'JoinColumn', 'OneToMany',
            'ManyToOne', 'ManyToMany', 'OneToOne', 'Lob', 'Enumerated'].includes(a.childForFieldName('name')?.text ?? ''));
        if (!hasColumnAnn && !fieldAnnotations.some(a => a.childForFieldName('name')?.text === 'Id')) {
            continue;
        }
        const typeNode = field.childForFieldName('type');
        const declarators = field.childForFieldName('declarator') ?? field;
        const nameNode = (0, ast_helpers_1.findAll)(declarators, 'variable_declarator')[0]?.childForFieldName('name')
            ?? (0, ast_helpers_1.findAll)(field, 'identifier')[0];
        const fieldName = nameNode?.text ?? 'unknown';
        const javaType = typeNode?.text ?? 'Object';
        const isId = fieldAnnotations.some(a => a.childForFieldName('name')?.text === 'Id');
        const isGenerated = fieldAnnotations.some(a => a.childForFieldName('name')?.text === 'GeneratedValue');
        const columnAnn = fieldAnnotations.find(a => a.childForFieldName('name')?.text === 'Column');
        const columnName = columnAnn
            ? (extractAnnotationStringAttr(columnAnn, 'name') ?? toSnakeCase(fieldName))
            : toSnakeCase(fieldName);
        const nullable = columnAnn
            ? !columnAnn.text.includes('nullable = false')
            : !isId;
        const unique = columnAnn
            ? columnAnn.text.includes('unique = true')
            : false;
        const lengthMatch = columnAnn?.text.match(/length\s*=\s*(\d+)/);
        const length = lengthMatch ? parseInt(lengthMatch[1], 10) : undefined;
        columns.push({
            name: columnName,
            type: mapJavaTypeToSQL(javaType),
            nullable,
            unique: unique || isId,
            primaryKey: isId,
            autoIncrement: isGenerated,
            length,
            decorators: fieldAnnotations.map(a => a.childForFieldName('name')?.text ?? '').filter(Boolean),
            sourceKind: 'entity',
        });
    }
    const hasTimestamps = columns.some(c => ['created_at', 'createdAt', 'updated_at', 'updatedAt'].includes(c.name));
    const hasSoftDelete = columns.some(c => ['deleted_at', 'deletedAt', 'removed_at'].includes(c.name));
    return {
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
            primaryKey: columns.filter(c => c.primaryKey).map(c => c.name),
        },
    };
}
function extractRepositoryOperations(interfaceNode, filePath, dbId, tablesMap) {
    return [];
}
const JPA_METHOD_MAP = {
    save: 'upsert',
    saveAll: 'createMany',
    saveAndFlush: 'upsert',
    findById: 'findUnique',
    findAll: 'findMany',
    findBy: 'findMany',
    delete: 'delete',
    deleteById: 'delete',
    deleteAll: 'deleteMany',
    count: 'count',
    existsById: 'count',
    findFirst: 'findFirst',
    getOne: 'findUnique',
    getById: 'findUnique',
};
function mapJPAMethod(method) {
    if (method in JPA_METHOD_MAP)
        return JPA_METHOD_MAP[method];
    if (method.startsWith('findBy'))
        return 'findMany';
    if (method.startsWith('findOneBy') || method.startsWith('findFirst'))
        return 'findFirst';
    if (method.startsWith('deleteBy'))
        return 'deleteMany';
    if (method.startsWith('countBy'))
        return 'count';
    if (method.startsWith('existsBy'))
        return 'count';
    return null;
}
function inferModelFromRepo(repoName) {
    const match = repoName.match(/(?:this\.)?(\w+?)(?:[Rr]epository|[Rr]epo)(?:\b|$)/);
    if (match)
        return toPascalCase(match[1]);
    return 'unknown';
}
function extractAnnotationStringAttr(ann, attr) {
    const args = ann.childForFieldName('arguments');
    if (!args)
        return null;
    const match = args.text.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`));
    return match ? match[1] : null;
}
function mapJavaTypeToSQL(javaType) {
    const map = {
        String: 'varchar',
        Integer: 'int',
        Long: 'bigint',
        Boolean: 'boolean',
        Double: 'double',
        Float: 'float',
        Date: 'timestamp',
        LocalDate: 'date',
        LocalDateTime: 'timestamp',
        BigDecimal: 'decimal',
        UUID: 'uuid',
        byte: 'tinyint',
        short: 'smallint',
        int: 'int',
        long: 'bigint',
        boolean: 'boolean',
        double: 'double',
        float: 'float',
    };
    return map[javaType.trim()] ?? javaType.toLowerCase();
}
function toSnakeCase(str) {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}
function toPascalCase(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
//# sourceMappingURL=jpa.extractor.js.map