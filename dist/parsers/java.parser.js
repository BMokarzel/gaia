"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JavaParser = void 0;
const tree_sitter_1 = __importDefault(require("tree-sitter"));
const base_1 = require("./base");
const spring_extractor_1 = require("../extractors/java/endpoint/spring.extractor");
const jpa_extractor_1 = require("../extractors/java/db/jpa.extractor");
function loadLanguage(name) {
    try {
        const mod = require(name);
        return mod.default ?? mod;
    }
    catch {
        return null;
    }
}
class JavaParser {
    supportedExtensions = ['.java'];
    parser = null;
    lang = null;
    init() {
        if (this.parser)
            return this.parser;
        this.lang = loadLanguage('tree-sitter-java');
        if (!this.lang)
            return null;
        this.parser = new tree_sitter_1.default();
        return this.parser;
    }
    supports(file) {
        return file.extension === '.java';
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
            const databases = [];
            const springResult = (0, spring_extractor_1.extractSpringEndpoints)(root, file.relativePath);
            codeNodes.push(...springResult.endpoints, ...springResult.functions);
            const jpaResult = (0, jpa_extractor_1.extractJPAOperations)(root, file.relativePath);
            codeNodes.push(...jpaResult.dbNodes);
            if (jpaResult.database.tables.length > 0) {
                databases.push(jpaResult.database);
            }
            return { codeNodes, databases, brokers: [] };
        }
        catch (err) {
            context.diagnostics.push({
                level: 'error',
                message: `Java parser error in ${file.relativePath}: ${err.message}`,
                location: { file: file.relativePath, line: 1, column: 0 },
            });
            return (0, base_1.emptyResult)();
        }
    }
}
exports.JavaParser = JavaParser;
//# sourceMappingURL=java.parser.js.map