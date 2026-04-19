"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KotlinParser = void 0;
const tree_sitter_1 = __importDefault(require("tree-sitter"));
const base_1 = require("./base");
const spring_extractor_1 = require("../extractors/kotlin/endpoint/spring.extractor");
function loadLanguage(name) {
    try {
        const mod = require(name);
        return mod.default ?? mod;
    }
    catch {
        return null;
    }
}
class KotlinParser {
    supportedExtensions = ['.kt', '.kts'];
    parser = null;
    lang = null;
    init() {
        if (this.parser)
            return this.parser;
        this.lang = loadLanguage('tree-sitter-kotlin');
        if (!this.lang)
            return null;
        this.parser = new tree_sitter_1.default();
        return this.parser;
    }
    supports(file) {
        return ['.kt', '.kts'].includes(file.extension);
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
            const springResult = (0, spring_extractor_1.extractKotlinSpringEndpoints)(root, file.relativePath);
            codeNodes.push(...springResult.endpoints, ...springResult.functions);
            return { codeNodes, databases: [], brokers: [] };
        }
        catch (err) {
            context.diagnostics.push({
                level: 'error',
                message: `Kotlin parser error in ${file.relativePath}: ${err.message}`,
                location: { file: file.relativePath, line: 1, column: 0 },
            });
            return (0, base_1.emptyResult)();
        }
    }
}
exports.KotlinParser = KotlinParser;
//# sourceMappingURL=kotlin.parser.js.map