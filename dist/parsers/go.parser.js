"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoParser = void 0;
const tree_sitter_1 = __importDefault(require("tree-sitter"));
const base_1 = require("./base");
const gin_extractor_1 = require("../extractors/go/endpoint/gin.extractor");
function loadLanguage(name) {
    try {
        const mod = require(name);
        return mod.default ?? mod;
    }
    catch {
        return null;
    }
}
class GoParser {
    supportedExtensions = ['.go'];
    parser = null;
    lang = null;
    init() {
        if (this.parser)
            return this.parser;
        this.lang = loadLanguage('tree-sitter-go');
        if (!this.lang)
            return null;
        this.parser = new tree_sitter_1.default();
        return this.parser;
    }
    supports(file) {
        return file.extension === '.go';
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
            codeNodes.push(...(0, gin_extractor_1.extractGoEndpoints)(root, file.relativePath));
            return { codeNodes, databases: [], brokers: [] };
        }
        catch (err) {
            context.diagnostics.push({
                level: 'error',
                message: `Go parser error in ${file.relativePath}: ${err.message}`,
                location: { file: file.relativePath, line: 1, column: 0 },
            });
            return (0, base_1.emptyResult)();
        }
    }
}
exports.GoParser = GoParser;
//# sourceMappingURL=go.parser.js.map