"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeId = makeId;
exports.nodeId = nodeId;
exports.resourceId = resourceId;
exports.serviceId = serviceId;
exports.tableId = tableId;
const crypto_1 = require("crypto");
/**
 * Gera um ID determinístico e legível para um nó.
 * Formato: {type}:{hash(parts)} — hash de 8 chars hex
 */
function makeId(type, ...parts) {
    const raw = parts.map(String).join(':');
    const hash = (0, crypto_1.createHash)('sha1').update(raw).digest('hex').slice(0, 8);
    return `${type}:${hash}`;
}
/**
 * Gera ID para nó de código a partir do arquivo + linha + tipo
 */
function nodeId(type, file, line, name) {
    return makeId(type, file, String(line), name ?? '');
}
/**
 * Gera ID para recurso (database, broker, storage) a partir do alias/nome
 */
function resourceId(type, alias) {
    return makeId(type, alias);
}
/**
 * Gera ID para serviço a partir do path
 */
function serviceId(repoPath) {
    const parts = repoPath.replace(/\\/g, '/').split('/');
    const name = parts[parts.length - 1] || parts[parts.length - 2] || 'unknown';
    return makeId('service', repoPath, name);
}
/**
 * Gera ID para tabela a partir do database + nome da tabela
 */
function tableId(databaseId, tableName) {
    return makeId('table', databaseId, tableName);
}
//# sourceMappingURL=id.js.map