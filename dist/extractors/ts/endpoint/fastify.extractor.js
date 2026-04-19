"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFastifyEndpoints = extractFastifyEndpoints;
const ast_helpers_1 = require("../../../utils/ast-helpers");
const id_1 = require("../../../utils/id");
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
const FASTIFY_PATTERNS = [/\bfastify\b/, /\bapp\b/, /\bserver\b/, /\binstance\b/];
/**
 * Extrai endpoints Fastify de um arquivo TypeScript/JavaScript.
 * Detecta:
 *   - fastify.get('/path', handler)
 *   - fastify.route({ method: 'GET', url: '/path', handler })
 */
function extractFastifyEndpoints(rootNode, filePath) {
    const endpoints = [];
    const calls = (0, ast_helpers_1.findAll)(rootNode, 'call_expression');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn)
            continue;
        // Padrão 1: fastify.get('/path', handler)
        if (fn.type === 'member_expression') {
            const obj = fn.childForFieldName('object');
            const prop = fn.childForFieldName('property');
            if (!obj || !prop)
                continue;
            const methodName = prop.text.toLowerCase();
            if (methodName === 'route') {
                // fastify.route({ method, url, handler })
                const endpoint = extractFastifyRoute(call, obj.text, filePath);
                if (endpoint)
                    endpoints.push(endpoint);
                continue;
            }
            if (!HTTP_METHODS.has(methodName))
                continue;
            const looksLikeFastify = FASTIFY_PATTERNS.some(p => p.test(obj.text));
            if (!looksLikeFastify)
                continue;
            const args = call.childForFieldName('arguments');
            if (!args)
                continue;
            const pathNode = args.namedChildren[0];
            const path = pathNode ? (0, ast_helpers_1.extractStringValue)(pathNode) : null;
            if (!path)
                continue;
            const loc = (0, ast_helpers_1.toLocation)(call, filePath);
            const id = (0, id_1.nodeId)('endpoint', filePath, loc.line, `${methodName}:${path}`);
            endpoints.push({
                id,
                type: 'endpoint',
                name: `${obj.text}.${methodName}`,
                location: loc,
                children: [],
                metadata: {
                    method: methodName.toUpperCase(),
                    path,
                    framework: 'fastify',
                    request: extractFastifyPathParams(path),
                    responses: [],
                },
            });
        }
    }
    return endpoints;
}
function extractFastifyRoute(call, instanceName, filePath) {
    const args = call.childForFieldName('arguments');
    if (!args)
        return null;
    const optionsNode = args.namedChildren[0];
    if (!optionsNode || optionsNode.type !== 'object')
        return null;
    let method = null;
    let url = null;
    for (const prop of optionsNode.namedChildren) {
        if (prop.type !== 'pair')
            continue;
        const key = prop.childForFieldName('key')?.text;
        const value = prop.childForFieldName('value');
        if (!value)
            continue;
        if (key === 'method')
            method = (0, ast_helpers_1.extractStringValue)(value);
        if (key === 'url' || key === 'path')
            url = (0, ast_helpers_1.extractStringValue)(value);
    }
    if (!method || !url)
        return null;
    const loc = (0, ast_helpers_1.toLocation)(call, filePath);
    const id = (0, id_1.nodeId)('endpoint', filePath, loc.line, `${method}:${url}`);
    return {
        id,
        type: 'endpoint',
        name: `${instanceName}.route`,
        location: loc,
        children: [],
        metadata: {
            method: method.toUpperCase(),
            path: url,
            framework: 'fastify',
            request: extractFastifyPathParams(url),
            responses: [],
        },
    };
}
function extractFastifyPathParams(path) {
    // Fastify usa :param e também *param
    const params = [...path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => ({
        name: m[1],
        type: 'string',
        required: true,
    }));
    return { params: params.length > 0 ? params : undefined };
}
//# sourceMappingURL=fastify.extractor.js.map