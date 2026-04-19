"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractExpressEndpoints = extractExpressEndpoints;
const ast_helpers_1 = require("../../../utils/ast-helpers");
const id_1 = require("../../../utils/id");
/** Métodos HTTP do Express/Router */
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);
/** Padrões de variável que indicam um app/router Express */
const ROUTER_PATTERNS = [
    /\bapp\b/, /\brouter\b/, /\bRouter\b/, /\bserver\b/, /\bapi\b/,
];
/**
 * Extrai endpoints Express/Router de um arquivo TypeScript/JavaScript.
 * Detecta: app.get('/path', handler), router.post('/path', ...), etc.
 */
function extractExpressEndpoints(rootNode, filePath) {
    const endpoints = [];
    const calls = (0, ast_helpers_1.findAll)(rootNode, 'call_expression');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn || fn.type !== 'member_expression')
            continue;
        const obj = fn.childForFieldName('object');
        const prop = fn.childForFieldName('property');
        if (!obj || !prop)
            continue;
        const methodName = prop.text.toLowerCase();
        if (!HTTP_METHODS.has(methodName))
            continue;
        // Verifica se o objeto parece um app/router Express
        const objText = obj.text;
        const looksLikeRouter = ROUTER_PATTERNS.some(p => p.test(objText));
        if (!looksLikeRouter)
            continue;
        // Extrai argumentos: .get('/path', middleware1, middleware2, handler)
        const args = call.childForFieldName('arguments');
        if (!args)
            continue;
        const argNodes = args.namedChildren;
        if (argNodes.length === 0)
            continue;
        // Primeiro argumento é o path
        const pathArg = argNodes[0];
        const path = (0, ast_helpers_1.extractStringValue)(pathArg);
        if (!path)
            continue;
        const httpMethod = (methodName === 'all' ? 'GET' : methodName.toUpperCase());
        // Middleware: argumentos intermediários (exceto último, que é o handler)
        const middlewareNodes = argNodes.slice(1, -1);
        const middleware = middlewareNodes
            .filter(n => n.type === 'identifier' || n.type === 'member_expression')
            .map(n => n.text);
        const loc = (0, ast_helpers_1.toLocation)(call, filePath);
        // Nome derivado do handler (último argumento)
        const lastArg = argNodes[argNodes.length - 1];
        const handlerName = lastArg?.type === 'identifier' ? lastArg.text : `${objText}.${methodName}`;
        const id = (0, id_1.nodeId)('endpoint', filePath, loc.line, `${methodName}:${path}`);
        endpoints.push({
            id,
            type: 'endpoint',
            name: handlerName,
            location: loc,
            children: [],
            metadata: {
                method: httpMethod,
                path,
                framework: 'express',
                middleware: middleware.length > 0 ? middleware : undefined,
                controller: undefined,
                request: extractExpressRequestParams(argNodes),
                responses: [],
            },
            raw: call.text.length < 300 ? call.text : undefined,
        });
    }
    return endpoints;
}
/**
 * Tenta inferir parâmetros de uma rota Express pelo path pattern
 * '/users/:id/posts/:postId' → [{ name: 'id', type: 'string', required: true }, ...]
 */
function extractExpressRequestParams(argNodes) {
    const pathNode = argNodes[0];
    if (!pathNode)
        return {};
    const path = (0, ast_helpers_1.extractStringValue)(pathNode) ?? '';
    const pathParams = [...path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => ({
        name: m[1],
        type: 'string',
        required: true,
    }));
    return {
        params: pathParams.length > 0 ? pathParams : undefined,
    };
}
//# sourceMappingURL=express.extractor.js.map