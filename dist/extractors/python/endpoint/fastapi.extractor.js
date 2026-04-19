"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFastAPIEndpoints = extractFastAPIEndpoints;
const ast_helpers_1 = require("../../../utils/ast-helpers");
const id_1 = require("../../../utils/id");
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
const FASTAPI_PATTERNS = [/\bapp\b/, /\brouter\b/, /\bapi\b/];
/**
 * Extrai endpoints FastAPI de um arquivo Python.
 * Detecta: @app.get('/path'), @router.post('/path')
 */
function extractFastAPIEndpoints(rootNode, filePath) {
    const endpoints = [];
    // Python: decorated_definition → decorator* function_definition
    const decorated = (0, ast_helpers_1.findAll)(rootNode, 'decorated_definition');
    for (const def of decorated) {
        const decorators = def.children.filter(c => c.type === 'decorator');
        const funcDef = def.children.find(c => c.type === 'function_definition');
        if (!funcDef)
            continue;
        for (const decorator of decorators) {
            // @app.get('/path') ou @router.post('/path', ...)
            const call = decorator.children.find(c => c.type === 'call');
            if (!call)
                continue;
            const fn = call.childForFieldName('function') ?? call.children[0];
            if (!fn)
                continue;
            // attribute → object.attr → app.get
            if (fn.type !== 'attribute')
                continue;
            const obj = fn.childForFieldName('object') ?? fn.children[0];
            const attr = fn.childForFieldName('attribute') ?? fn.children[2];
            if (!obj || !attr)
                continue;
            const methodName = attr.text.toLowerCase();
            if (!HTTP_METHODS.has(methodName))
                continue;
            const looksLikeRouter = FASTAPI_PATTERNS.some(p => p.test(obj.text));
            if (!looksLikeRouter)
                continue;
            // Extrai path do primeiro argumento
            const args = call.childForFieldName('arguments');
            if (!args)
                continue;
            const firstArg = args.namedChildren[0] ?? args.children[0];
            const path = firstArg ? (0, ast_helpers_1.extractStringValue)(firstArg) : null;
            if (!path)
                continue;
            const funcName = funcDef.childForFieldName('name')?.text ?? 'unknown';
            const loc = (0, ast_helpers_1.toLocation)(def, filePath);
            const id = (0, id_1.nodeId)('endpoint', filePath, loc.line, `${methodName}:${path}`);
            // Extrai parâmetros da função
            const request = extractFastAPIParams(funcDef, path);
            endpoints.push({
                id,
                type: 'endpoint',
                name: funcName,
                location: loc,
                children: [],
                metadata: {
                    method: methodName.toUpperCase(),
                    path,
                    framework: 'fastapi',
                    request,
                    responses: [],
                },
            });
        }
    }
    return endpoints;
}
function extractFastAPIParams(funcDef, path) {
    const params = [];
    const query = [];
    // Extrai path params do URL pattern
    const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map(m => ({
        name: m[1],
        type: 'str',
        required: true,
    }));
    params.push(...pathParams);
    // Analisa os parâmetros da função para detectar query params vs body
    const parameters = funcDef.childForFieldName('parameters');
    if (parameters) {
        const pathParamNames = new Set(pathParams.map(p => p.name));
        for (const param of parameters.namedChildren) {
            if (param.type !== 'identifier' && param.type !== 'typed_parameter' &&
                param.type !== 'typed_default_parameter')
                continue;
            const name = param.childForFieldName('name')?.text ?? param.text.split(':')[0].trim();
            if (!name || name === 'self' || name === 'request' || name === 'response')
                continue;
            if (pathParamNames.has(name))
                continue;
            const typeAnnotation = param.childForFieldName('type');
            const typeName = typeAnnotation?.text ?? 'str';
            // Se o tipo é uma classe (PascalCase), provavelmente é o Body
            const isPydanticModel = /^[A-Z]/.test(typeName.replace('Optional[', '').replace('[', ''));
            if (isPydanticModel) {
                // É um body Pydantic
            }
            else {
                query.push({ name, type: typeName, required: !param.text.includes('=') });
            }
        }
    }
    return {
        params: params.length > 0 ? params : undefined,
        query: query.length > 0 ? query : undefined,
    };
}
//# sourceMappingURL=fastapi.extractor.js.map