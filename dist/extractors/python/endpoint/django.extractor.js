"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDjangoEndpoints = extractDjangoEndpoints;
const ast_helpers_1 = require("../../../utils/ast-helpers");
const id_1 = require("../../../utils/id");
/**
 * Extrai endpoints Django de um arquivo Python.
 * Detecta:
 *   - urls.py: path('users/', UserListView.as_view(), name='user-list')
 *   - views.py: class UserListView(APIView) com get/post/put/delete/patch
 *   - @api_view(['GET', 'POST'])
 */
function extractDjangoEndpoints(rootNode, filePath) {
    const endpoints = [];
    // Detecta urlpatterns
    if (filePath.includes('urls')) {
        endpoints.push(...extractUrlPatterns(rootNode, filePath));
    }
    // Detecta @api_view decorator (DRF)
    endpoints.push(...extractApiViewDecorators(rootNode, filePath));
    // Detecta ViewSet methods (DRF)
    endpoints.push(...extractViewSetMethods(rootNode, filePath));
    return endpoints;
}
function extractUrlPatterns(rootNode, filePath) {
    const endpoints = [];
    const calls = (0, ast_helpers_1.findAll)(rootNode, 'call');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn)
            continue;
        const fnName = fn.text;
        if (!['path', 're_path', 'url'].includes(fnName))
            continue;
        const args = call.childForFieldName('arguments');
        if (!args)
            continue;
        const pathArg = args.namedChildren[0];
        const viewArg = args.namedChildren[1];
        if (!pathArg || !viewArg)
            continue;
        const routePath = (0, ast_helpers_1.extractStringValue)(pathArg) ?? '';
        const viewName = viewArg.text;
        const loc = (0, ast_helpers_1.toLocation)(call, filePath);
        const id = (0, id_1.nodeId)('endpoint', filePath, loc.line, `url:${routePath}`);
        endpoints.push({
            id,
            type: 'endpoint',
            name: viewName,
            location: loc,
            children: [],
            metadata: {
                method: 'GET', // Django URLs não especificam método no URL
                path: normalizeDjangoPath(routePath),
                framework: 'django',
                request: extractDjangoPathParams(routePath),
                responses: [],
            },
        });
    }
    return endpoints;
}
function extractApiViewDecorators(rootNode, filePath) {
    const endpoints = [];
    const decorated = (0, ast_helpers_1.findAll)(rootNode, 'decorated_definition');
    for (const def of decorated) {
        const decorators = def.children.filter(c => c.type === 'decorator');
        const funcDef = def.children.find(c => c.type === 'function_definition');
        if (!funcDef)
            continue;
        const apiViewDec = decorators.find(d => d.text.includes('api_view'));
        if (!apiViewDec)
            continue;
        // Extrai métodos: @api_view(['GET', 'POST'])
        const methodsMatch = apiViewDec.text.match(/\[([^\]]+)\]/);
        const methods = methodsMatch
            ? methodsMatch[1].match(/'([A-Z]+)'/g)?.map(m => m.replace(/'/g, '')) ?? ['GET']
            : ['GET'];
        const funcName = funcDef.childForFieldName('name')?.text ?? 'unknown';
        const loc = (0, ast_helpers_1.toLocation)(def, filePath);
        for (const method of methods) {
            const id = (0, id_1.nodeId)('endpoint', filePath, loc.line, `api_view:${funcName}:${method}`);
            endpoints.push({
                id,
                type: 'endpoint',
                name: funcName,
                location: loc,
                children: [],
                metadata: {
                    method: method,
                    path: `/${funcName}`,
                    framework: 'django',
                    request: {},
                    responses: [],
                },
            });
        }
    }
    return endpoints;
}
function extractViewSetMethods(rootNode, filePath) {
    const endpoints = [];
    const classes = (0, ast_helpers_1.findAll)(rootNode, 'class_definition');
    for (const cls of classes) {
        const className = cls.childForFieldName('name')?.text ?? '';
        if (!/(View|ViewSet|APIView|GenericAPIView)/i.test(className))
            continue;
        const methods = (0, ast_helpers_1.findAll)(cls, 'function_definition');
        for (const method of methods) {
            const methodName = method.childForFieldName('name')?.text ?? '';
            const httpMethod = djangoMethodToHTTP(methodName);
            if (!httpMethod)
                continue;
            const loc = (0, ast_helpers_1.toLocation)(method, filePath);
            const id = (0, id_1.nodeId)('endpoint', filePath, loc.line, `view:${className}.${methodName}`);
            endpoints.push({
                id,
                type: 'endpoint',
                name: `${className}.${methodName}`,
                location: loc,
                children: [],
                metadata: {
                    method: httpMethod,
                    path: `/${toKebabCase(className.replace(/View.*/, ''))}`,
                    framework: 'django',
                    controller: className,
                    request: {},
                    responses: [],
                },
            });
        }
    }
    return endpoints;
}
function djangoMethodToHTTP(name) {
    const map = {
        get: 'GET',
        list: 'GET',
        retrieve: 'GET',
        post: 'POST',
        create: 'POST',
        put: 'PUT',
        update: 'PUT',
        patch: 'PATCH',
        partial_update: 'PATCH',
        delete: 'DELETE',
        destroy: 'DELETE',
    };
    return map[name] ?? null;
}
function normalizeDjangoPath(path) {
    // '<int:pk>' → ':pk', '<str:slug>' → ':slug'
    return '/' + path.replace(/<[^:>]+:([^>]+)>/g, ':$1').replace(/^\//, '');
}
function extractDjangoPathParams(path) {
    const params = [...path.matchAll(/<[^:>]+:([^>]+)>/g)].map(m => ({
        name: m[1],
        type: 'string',
        required: true,
    }));
    return { params: params.length > 0 ? params : undefined };
}
function toKebabCase(str) {
    return str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
}
//# sourceMappingURL=django.extractor.js.map