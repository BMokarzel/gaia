"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractGoEndpoints = extractGoEndpoints;
const ast_helpers_1 = require("../../../utils/ast-helpers");
const id_1 = require("../../../utils/id");
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const ROUTER_PATTERNS = [/\br\b/, /\brouter\b/, /\bRoute\b/, /\bapp\b/, /\bserver\b/, /\bapi\b/, /\bgroup\b/];
/**
 * Extrai endpoints de frameworks Go (Gin, Echo, Fiber, Chi, net/http).
 * Detecta: r.GET("/path", handler), r.POST("/path", handler)
 * e também e.GET(), r.Get() (Chi), app.Get() (Fiber)
 */
function extractGoEndpoints(rootNode, filePath) {
    const endpoints = [];
    // Go: call_expression → selector_expression
    const calls = (0, ast_helpers_1.findAll)(rootNode, 'call_expression');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn)
            continue;
        if (fn.type !== 'selector_expression')
            continue;
        const obj = fn.childForFieldName('operand');
        const sel = fn.childForFieldName('field');
        if (!obj || !sel)
            continue;
        const methodName = sel.text;
        const objText = obj.text;
        // Go frameworks usam GET/POST/etc (maiúsculas) ou Get/Post (PascalCase)
        const httpMethod = methodName.toUpperCase();
        if (!HTTP_METHODS.has(httpMethod))
            continue;
        const looksLikeRouter = ROUTER_PATTERNS.some(p => p.test(objText));
        if (!looksLikeRouter)
            continue;
        // Primeiro argumento é o path
        const args = call.childForFieldName('arguments');
        if (!args)
            continue;
        const argList = args.namedChildren;
        const pathArg = argList[0];
        const path = pathArg ? (0, ast_helpers_1.extractStringValue)(pathArg) : null;
        if (!path)
            continue;
        // Handler — último argumento
        const handlerArg = argList[argList.length - 1];
        const handlerName = handlerArg?.text?.split('.').pop() ?? 'handler';
        const loc = (0, ast_helpers_1.toLocation)(call, filePath);
        const id = (0, id_1.nodeId)('endpoint', filePath, loc.line, `${httpMethod}:${path}`);
        endpoints.push({
            id,
            type: 'endpoint',
            name: handlerName,
            location: loc,
            children: [],
            metadata: {
                method: httpMethod,
                path,
                framework: detectGoFramework(objText, call),
                request: extractGoPathParams(path),
                responses: [],
            },
        });
    }
    // net/http: http.HandleFunc("/path", handler)
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn)
            continue;
        const fnText = fn.text;
        if (fnText !== 'http.HandleFunc' && fnText !== 'http.Handle')
            continue;
        const args = call.childForFieldName('arguments');
        if (!args)
            continue;
        const pathArg = args.namedChildren[0];
        const path = pathArg ? (0, ast_helpers_1.extractStringValue)(pathArg) : null;
        if (!path)
            continue;
        const loc = (0, ast_helpers_1.toLocation)(call, filePath);
        const id = (0, id_1.nodeId)('endpoint', filePath, loc.line, `HandleFunc:${path}`);
        endpoints.push({
            id,
            type: 'endpoint',
            name: path,
            location: loc,
            children: [],
            metadata: {
                method: 'GET', // net/http não especifica método no HandleFunc
                path,
                framework: 'unknown',
                request: extractGoPathParams(path),
                responses: [],
            },
        });
    }
    return endpoints;
}
function detectGoFramework(objText, call) {
    // Heurística baseada no nome da variável e contexto
    if (/gin/i.test(objText))
        return 'gin';
    if (/echo/i.test(objText))
        return 'echo';
    if (/fiber/i.test(objText))
        return 'fiber';
    if (/chi/i.test(objText))
        return 'chi';
    return 'gin'; // default mais comum
}
function extractGoPathParams(path) {
    // Gin/Echo: /users/:id
    // Chi: /users/{id}
    const colonParams = [...path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => ({
        name: m[1],
        type: 'string',
        required: true,
    }));
    const braceParams = [...path.matchAll(/\{([^}]+)\}/g)].map(m => ({
        name: m[1].split(':')[0],
        type: 'string',
        required: true,
    }));
    const params = [...colonParams, ...braceParams];
    return { params: params.length > 0 ? params : undefined };
}
//# sourceMappingURL=gin.extractor.js.map