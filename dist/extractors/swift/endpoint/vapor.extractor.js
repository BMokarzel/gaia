"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractVaporEndpoints = extractVaporEndpoints;
const ast_helpers_1 = require("../../../utils/ast-helpers");
const id_1 = require("../../../utils/id");
const VAPOR_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'on']);
const VAPOR_PATTERNS = [/\bapp\b/, /\brouter\b/, /\broutes\b/, /\bRoute\b/];
/**
 * Extrai endpoints Vapor (Swift) de arquivos Swift.
 * Detecta: app.get("path") { req in ... }
 */
function extractVaporEndpoints(rootNode, filePath) {
    const endpoints = [];
    const calls = (0, ast_helpers_1.findAll)(rootNode, 'call_expression');
    for (const call of calls) {
        const fn = call.children[0];
        if (!fn)
            continue;
        // Swift: navigation_expression → a.b.c
        if (fn.type !== 'navigation_expression')
            continue;
        const chain = (0, ast_helpers_1.memberChain)(fn);
        if (chain.length < 2)
            continue;
        const method = chain[chain.length - 1].toLowerCase();
        const obj = chain.slice(0, -1).join('.');
        if (!VAPOR_METHODS.has(method))
            continue;
        if (!VAPOR_PATTERNS.some(p => p.test(obj)))
            continue;
        // Extrai argumentos — primeiro é o path
        const args = call.childForFieldName('arguments') ?? call.children[1];
        if (!args)
            continue;
        const firstArg = args.namedChildren[0];
        const path = firstArg ? (0, ast_helpers_1.extractStringValue)(firstArg) ?? `/${method}` : `/${method}`;
        const loc = (0, ast_helpers_1.toLocation)(call, filePath);
        const id = (0, id_1.nodeId)('endpoint', filePath, loc.line, `${method}:${path}`);
        endpoints.push({
            id,
            type: 'endpoint',
            name: `${obj}.${method}`,
            location: loc,
            children: [],
            metadata: {
                method: method === 'on' ? 'GET' : method.toUpperCase(),
                path,
                framework: 'vapor',
                request: extractVaporPathParams(path),
                responses: [],
            },
        });
    }
    return endpoints;
}
function extractVaporPathParams(path) {
    // Vapor usa :param e *param
    const params = [...path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => ({
        name: m[1],
        type: 'String',
        required: true,
    }));
    return { params: params.length > 0 ? params : undefined };
}
//# sourceMappingURL=vapor.extractor.js.map