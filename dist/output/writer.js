"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeTopology = writeTopology;
exports.buildSummary = buildSummary;
const fs_1 = require("fs");
const path_1 = require("path");
/**
 * Serializa e escreve o SystemTopology em um arquivo JSON.
 */
function writeTopology(topology, repoPath, options = {}) {
    const { outputPath = (0, path_1.join)(repoPath, 'topology.json'), pretty = true, includeRaw = false, } = options;
    const output = includeRaw ? topology : stripRaw(topology);
    const json = pretty
        ? JSON.stringify(output, null, 2)
        : JSON.stringify(output);
    // Cria diretório se não existir
    (0, fs_1.mkdirSync)((0, path_1.dirname)(outputPath), { recursive: true });
    (0, fs_1.writeFileSync)(outputPath, json, 'utf-8');
    return outputPath;
}
/**
 * Remove o campo 'raw' de todos os nós para reduzir o tamanho do output.
 */
function stripRaw(topology) {
    const json = JSON.stringify(topology);
    const stripped = JSON.parse(json);
    function removeRaw(obj) {
        if (!obj || typeof obj !== 'object')
            return;
        if (Array.isArray(obj)) {
            obj.forEach(removeRaw);
            return;
        }
        const record = obj;
        delete record['raw'];
        for (const key of Object.keys(record)) {
            if (record[key] && typeof record[key] === 'object') {
                removeRaw(record[key]);
            }
        }
    }
    removeRaw(stripped);
    return stripped;
}
/**
 * Gera um resumo das estatísticas da topologia para exibição no terminal.
 */
function buildSummary(topology) {
    const lines = [];
    lines.push(`Services: ${topology.services.length}`);
    for (const svc of topology.services) {
        lines.push(`  ${svc.name} (${svc.metadata.language ?? '?'} / ${svc.metadata.framework ?? '?'})`);
        lines.push(`    Endpoints : ${svc.endpoints.length}`);
        lines.push(`    Functions : ${svc.functions.length}`);
        lines.push(`    Globals   : ${svc.globals.length}`);
    }
    lines.push(`Databases : ${topology.databases.length}`);
    for (const db of topology.databases) {
        lines.push(`  ${db.name} (${db.metadata.engine}) — ${db.tables.length} tables`);
    }
    lines.push(`Brokers   : ${topology.brokers.length}`);
    for (const b of topology.brokers) {
        lines.push(`  ${b.name} (${b.metadata.engine}) — ${b.metadata.topics.length} topics`);
    }
    lines.push(`Screens   : ${topology.screens.length}`);
    lines.push(`Edges     : ${topology.edges.length}`);
    const diags = topology.diagnostics;
    if (diags.length > 0) {
        const errors = diags.filter(d => d.level === 'error').length;
        const warns = diags.filter(d => d.level === 'warning').length;
        lines.push(`Diagnostics: ${errors} errors, ${warns} warnings`);
    }
    lines.push(`Coverage:`);
    const cov = topology.observability.coverage;
    lines.push(`  Endpoints with tracing: ${cov.endpointsWithTracing}/${cov.endpointsTotal}`);
    lines.push(`  DB queries with spans : ${cov.dbQueriesWithSpans}/${cov.dbQueriesTotal}`);
    return lines.join('\n');
}
//# sourceMappingURL=writer.js.map