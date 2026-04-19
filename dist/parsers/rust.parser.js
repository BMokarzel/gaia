"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RustParser = void 0;
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
class RustParser {
    supportedExtensions = ['.rs'];
    parser = null;
    lang = null;
    init() {
        if (this.parser)
            return this.parser;
        this.lang = loadLanguage('tree-sitter-rust');
        if (!this.lang)
            return null;
        this.parser = new tree_sitter_1.default();
        return this.parser;
    }
    supports(file) {
        return file.extension === '.rs';
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
            // Actix-web: #[get("/path")] / #[post("/path")]
            codeNodes.push(...extractActixEndpoints(root, file.relativePath));
            // Axum: Router::new().route("/path", get(handler))
            codeNodes.push(...extractAxumEndpoints(root, file.relativePath));
            return { codeNodes, databases: [], brokers: [] };
        }
        catch (err) {
            context.diagnostics.push({
                level: 'error',
                message: `Rust parser error in ${file.relativePath}: ${err.message}`,
                location: { file: file.relativePath, line: 1, column: 0 },
            });
            return (0, base_1.emptyResult)();
        }
    }
}
exports.RustParser = RustParser;
const ACTIX_HTTP_ATTRS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
function extractActixEndpoints(root, filePath) {
    const endpoints = [];
    // Rust attributes: #[get("/path")]
    const attrItems = (0, ast_helpers_1.findAll)(root, 'attribute_item');
    for (const attr of attrItems) {
        const attrText = attr.text;
        const methodMatch = attrText.match(/#\[(\w+)\s*\(\s*["']([^"']+)["']/);
        if (!methodMatch)
            continue;
        const [, method, path] = methodMatch;
        if (!ACTIX_HTTP_ATTRS.has(method.toLowerCase()))
            continue;
        // A função logo após o attribute
        const fn = attr.nextNamedSibling;
        const fnName = fn?.childForFieldName('name')?.text ?? 'handler';
        const loc = (0, ast_helpers_1.toLocation)(attr, filePath);
        const id = (0, id_1.nodeId)('endpoint', filePath, loc.line, `${method}:${path}`);
        endpoints.push({
            id,
            type: 'endpoint',
            name: fnName,
            location: loc,
            children: [],
            metadata: {
                method: method.toUpperCase(),
                path,
                framework: 'actix',
                request: extractRustPathParams(path),
                responses: [],
            },
        });
    }
    return endpoints;
}
function extractAxumEndpoints(root, filePath) {
    const endpoints = [];
    // .route("/path", get(handler)) ou .route("/path", post(handler))
    const calls = (0, ast_helpers_1.findAll)(root, 'call_expression');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn)
            continue;
        // method_call: obj.route(...)
        if (fn.type !== 'field_expression')
            continue;
        const methodName = fn.childForFieldName('field')?.text ?? '';
        if (methodName !== 'route')
            continue;
        const args = call.childForFieldName('arguments');
        if (!args)
            continue;
        const argNodes = args.namedChildren;
        if (argNodes.length < 2)
            continue;
        const pathArg = argNodes[0];
        const handlerArg = argNodes[1];
        const path = (0, ast_helpers_1.extractStringValue)(pathArg);
        if (!path)
            continue;
        // get(handler) / post(handler) / ...
        const handlerText = handlerArg.text;
        const methodMatch = handlerText.match(/^(get|post|put|patch|delete|options|head)\s*\(/i);
        if (!methodMatch)
            continue;
        const method = methodMatch[1].toUpperCase();
        const loc = (0, ast_helpers_1.toLocation)(call, filePath);
        const id = (0, id_1.nodeId)('endpoint', filePath, loc.line, `${method}:${path}`);
        endpoints.push({
            id,
            type: 'endpoint',
            name: path,
            location: loc,
            children: [],
            metadata: {
                method: method,
                path,
                framework: 'axum',
                request: extractRustPathParams(path),
                responses: [],
            },
        });
    }
    return endpoints;
}
function extractRustPathParams(path) {
    // Axum: /users/:id, Actix: /users/{id}
    const colonParams = [...path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => ({
        name: m[1], type: 'String', required: true,
    }));
    const braceParams = [...path.matchAll(/\{([^}]+)\}/g)].map(m => ({
        name: m[1], type: 'String', required: true,
    }));
    const params = [...colonParams, ...braceParams];
    return { params: params.length > 0 ? params : undefined };
}
//# sourceMappingURL=rust.parser.js.map