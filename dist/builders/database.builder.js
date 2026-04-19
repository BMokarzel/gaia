"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeDatabases = mergeDatabases;
exports.buildDatabaseFromHint = buildDatabaseFromHint;
const id_1 = require("../utils/id");
/**
 * Merge de múltiplos DatabaseNodes com o mesmo alias/engine.
 * Consolida tabelas descobertas de múltiplos arquivos.
 */
function mergeDatabases(databases) {
    const byAlias = new Map();
    for (const db of databases) {
        const key = db.metadata.connectionAlias;
        const existing = byAlias.get(key);
        if (!existing) {
            byAlias.set(key, { ...db, tables: [...db.tables] });
            continue;
        }
        // Merge tables
        const tablesByName = new Map(existing.tables.map(t => [t.name.toLowerCase(), t]));
        for (const table of db.tables) {
            const tableKey = table.name.toLowerCase();
            if (!tablesByName.has(tableKey)) {
                tablesByName.set(tableKey, table);
            }
            else {
                // Merge columns
                const existingTable = tablesByName.get(tableKey);
                mergeTables(existingTable, table);
            }
        }
        existing.tables = Array.from(tablesByName.values());
    }
    return Array.from(byAlias.values());
}
function mergeTables(target, source) {
    if (!target.metadata.columns)
        target.metadata.columns = [];
    const existingCols = new Set(target.metadata.columns.map(c => c.name));
    for (const col of source.metadata.columns ?? []) {
        if (!existingCols.has(col.name)) {
            target.metadata.columns.push(col);
            existingCols.add(col.name);
        }
        else {
            // Se a coluna existente é 'inferred' e a nova tem mais info, atualiza
            const existing = target.metadata.columns.find(c => c.name === col.name);
            if (existing && existing.sourceKind === 'inferred' && col.sourceKind !== 'inferred') {
                Object.assign(existing, col);
            }
        }
    }
    // Propaga flags de timestamps/softDelete
    if (source.metadata.hasTimestamps)
        target.metadata.hasTimestamps = true;
    if (source.metadata.hasSoftDelete)
        target.metadata.hasSoftDelete = true;
    if (source.metadata.entityName && !target.metadata.entityName) {
        target.metadata.entityName = source.metadata.entityName;
    }
}
/**
 * Constrói DatabaseNodes a partir dos hints da stack técnica
 * (para databases detectados no manifesto mas sem operações no código ainda)
 */
function buildDatabaseFromHint(alias, engine, orm) {
    return {
        id: (0, id_1.resourceId)('database', alias),
        type: 'database',
        name: alias,
        metadata: {
            engine: engine,
            category: engineToCategory(engine),
            connectionAlias: alias,
        },
        tables: [],
    };
}
function engineToCategory(engine) {
    const sql = ['postgresql', 'mysql', 'mariadb', 'sqlite', 'sqlserver'];
    const nosql = ['mongodb', 'dynamodb', 'couchdb', 'firestore'];
    const kv = ['redis', 'memcached', 'valkey'];
    const search = ['elasticsearch', 'opensearch', 'meilisearch'];
    const analytics = ['clickhouse', 'bigquery', 'redshift', 'snowflake'];
    const graph = ['neo4j', 'neptune', 'arangodb'];
    const timeseries = ['timescaledb', 'influxdb'];
    if (sql.includes(engine))
        return 'sql';
    if (nosql.includes(engine))
        return 'nosql';
    if (kv.includes(engine))
        return 'kv';
    if (search.includes(engine))
        return 'search';
    if (analytics.includes(engine))
        return 'analytics';
    if (graph.includes(engine))
        return 'graph';
    if (timeseries.includes(engine))
        return 'timeseries';
    return 'nosql';
}
//# sourceMappingURL=database.builder.js.map