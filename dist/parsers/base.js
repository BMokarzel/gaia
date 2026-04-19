"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyResult = emptyResult;
exports.mergeResults = mergeResults;
/**
 * Resultado vazio — helper para retornar quando o arquivo é irrelevante
 */
function emptyResult() {
    return { codeNodes: [], databases: [], brokers: [] };
}
/**
 * Merge de resultados de múltiplos parsers/extractors
 */
function mergeResults(...results) {
    return {
        codeNodes: results.flatMap(r => r.codeNodes),
        databases: results.flatMap(r => r.databases),
        brokers: results.flatMap(r => r.brokers),
    };
}
//# sourceMappingURL=base.js.map