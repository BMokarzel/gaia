"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PythonParser = void 0;
const tree_sitter_1 = __importDefault(require("tree-sitter"));
const base_1 = require("./base");
const fastapi_extractor_1 = require("../extractors/python/endpoint/fastapi.extractor");
const django_extractor_1 = require("../extractors/python/endpoint/django.extractor");
function loadLanguage(name) {
    try {
        const mod = require(name);
        return mod.default ?? mod;
    }
    catch {
        return null;
    }
}
class PythonParser {
    supportedExtensions = ['.py'];
    parser = null;
    lang = null;
    init() {
        if (this.parser)
            return this.parser;
        this.lang = loadLanguage('tree-sitter-python');
        if (!this.lang)
            return null;
        this.parser = new tree_sitter_1.default();
        return this.parser;
    }
    supports(file) {
        return file.extension === '.py';
    }
    parse(file, context) {
        const parser = this.init();
        if (!parser || !this.lang)
            return (0, base_1.emptyResult)();
        try {
            parser.setLanguage(this.lang);
            const tree = parser.parse(file.content);
            const root = tree.rootNode;
            const path = file.relativePath;
            const codeNodes = [];
            // FastAPI
            const fastApiEndpoints = (0, fastapi_extractor_1.extractFastAPIEndpoints)(root, path);
            codeNodes.push(...fastApiEndpoints);
            // Django
            const djangoEndpoints = (0, django_extractor_1.extractDjangoEndpoints)(root, path);
            codeNodes.push(...djangoEndpoints);
            return { codeNodes, databases: [], brokers: [] };
        }
        catch (err) {
            context.diagnostics.push({
                level: 'error',
                message: `Python parser error in ${file.relativePath}: ${err.message}`,
                location: { file: file.relativePath, line: 1, column: 0 },
            });
            return (0, base_1.emptyResult)();
        }
    }
}
exports.PythonParser = PythonParser;
//# sourceMappingURL=python.parser.js.map