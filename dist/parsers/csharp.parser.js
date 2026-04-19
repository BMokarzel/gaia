"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CSharpParser = void 0;
const tree_sitter_1 = __importDefault(require("tree-sitter"));
const base_1 = require("./base");
const ast_helpers_1 = require("../utils/ast-helpers");
const id_1 = require("../utils/id");
function loadLanguage(name) {
    try {
        const mod = require(name);
        return mod.default ?? mod;
    }
    catch {
        return null;
    }
}
class CSharpParser {
    supportedExtensions = ['.cs'];
    parser = null;
    lang = null;
    init() {
        if (this.parser)
            return this.parser;
        this.lang = loadLanguage('tree-sitter-c-sharp');
        if (!this.lang)
            return null;
        this.parser = new tree_sitter_1.default();
        return this.parser;
    }
    supports(file) {
        return file.extension === '.cs';
    }
    parse(file, context) {
        const parser = this.init();
        if (!parser || !this.lang)
            return (0, base_1.emptyResult)();
        try {
            parser.setLanguage(this.lang);
            const tree = parser.parse(file.content);
            const root = tree.rootNode;
            const codeNodes = [];
            codeNodes.push(...extractAspNetEndpoints(root, file.relativePath));
            return { codeNodes, databases: [], brokers: [] };
        }
        catch (err) {
            context.diagnostics.push({
                level: 'error',
                message: `C# parser error in ${file.relativePath}: ${err.message}`,
                location: { file: file.relativePath, line: 1, column: 0 },
            });
            return (0, base_1.emptyResult)();
        }
    }
}
exports.CSharpParser = CSharpParser;
const ASPNET_HTTP_ATTRS = {
    HttpGet: 'GET',
    HttpPost: 'POST',
    HttpPut: 'PUT',
    HttpPatch: 'PATCH',
    HttpDelete: 'DELETE',
};
function extractAspNetEndpoints(root, filePath) {
    const endpoints = [];
    const classes = (0, ast_helpers_1.findAll)(root, 'class_declaration');
    for (const cls of classes) {
        // Verifica [ApiController] ou [Route("...")]
        const attrs = (0, ast_helpers_1.findAll)(cls, 'attribute');
        const isController = attrs.some(a => {
            const text = a.text;
            return text.includes('ApiController') || text.includes('Controller');
        });
        if (!isController)
            continue;
        const routeAttr = attrs.find(a => a.text.includes('Route'));
        const basePath = routeAttr
            ? (routeAttr.text.match(/["']([^"']+)["']/) ?? [])[1] ?? ''
            : '';
        const className = cls.childForFieldName('name')?.text ?? 'Controller';
        const methods = (0, ast_helpers_1.findAll)(cls, 'method_declaration');
        for (const method of methods) {
            const methodAttrs = (0, ast_helpers_1.findAll)(method, 'attribute');
            const httpAttr = methodAttrs.find(a => Object.keys(ASPNET_HTTP_ATTRS).some(k => a.text.includes(k)));
            if (!httpAttr)
                continue;
            const httpKey = Object.keys(ASPNET_HTTP_ATTRS).find(k => httpAttr.text.includes(k)) ?? 'HttpGet';
            const httpMethod = ASPNET_HTTP_ATTRS[httpKey];
            // Extrai path do atributo: [HttpGet("users/{id}")]
            const pathMatch = httpAttr.text.match(/["']([^"']+)["']/);
            const methodPath = pathMatch ? pathMatch[1] : '';
            const fullPath = joinPaths(basePath, methodPath);
            const methodName = method.childForFieldName('name')?.text ?? 'Action';
            const loc = (0, ast_helpers_1.toLocation)(method, filePath);
            const id = (0, id_1.nodeId)('endpoint', filePath, loc.line, `${className}.${methodName}`);
            endpoints.push({
                id,
                type: 'endpoint',
                name: `${className}.${methodName}`,
                location: loc,
                children: [],
                metadata: {
                    method: httpMethod,
                    path: fullPath,
                    framework: 'aspnet',
                    controller: className,
                    request: extractAspNetPathParams(fullPath),
                    responses: [],
                },
            });
        }
    }
    return endpoints;
}
function extractAspNetPathParams(path) {
    const params = [...path.matchAll(/\{([^}:?]+)/g)].map(m => ({
        name: m[1], type: 'string', required: true,
    }));
    return { params: params.length > 0 ? params : undefined };
}
function joinPaths(base, path) {
    // ASP.NET usa [controller] e [action] como placeholders
    const clean = [base, path]
        .map(p => p.replace(/^\/+|\/+$/g, ''))
        .filter(Boolean)
        .join('/');
    return '/' + (clean || '');
}
//# sourceMappingURL=csharp.parser.js.map