"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypeScriptParser = void 0;
const tree_sitter_1 = __importDefault(require("tree-sitter"));
const base_1 = require("./base");
const nest_extractor_1 = require("../extractors/ts/endpoint/nest.extractor");
const express_extractor_1 = require("../extractors/ts/endpoint/express.extractor");
const fastify_extractor_1 = require("../extractors/ts/endpoint/fastify.extractor");
const function_extractor_1 = require("../extractors/ts/function.extractor");
const prisma_extractor_1 = require("../extractors/ts/db/prisma.extractor");
const typeorm_extractor_1 = require("../extractors/ts/db/typeorm.extractor");
const sequelize_extractor_1 = require("../extractors/ts/db/sequelize.extractor");
const event_extractor_1 = require("../extractors/ts/event.extractor");
const flow_extractor_1 = require("../extractors/ts/flow.extractor");
const log_extractor_1 = require("../extractors/ts/log.extractor");
const telemetry_extractor_1 = require("../extractors/ts/telemetry.extractor");
const data_extractor_1 = require("../extractors/ts/data.extractor");
const screen_extractor_1 = require("../extractors/ts/frontend/screen.extractor");
// Lazy load das grammars para não crashar se não estiverem instaladas
function loadLanguage(name) {
    try {
        const mod = require(name);
        return mod.default ?? mod;
    }
    catch {
        return null;
    }
}
class TypeScriptParser {
    supportedExtensions = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx'];
    parser = null;
    tsLang = null;
    tsxLang = null;
    jsLang = null;
    initParser() {
        if (this.parser)
            return this.parser;
        try {
            const tsModule = loadLanguage('tree-sitter-typescript');
            if (tsModule) {
                this.tsLang = tsModule.typescript ?? tsModule;
                this.tsxLang = tsModule.tsx ?? tsModule;
            }
            this.parser = new tree_sitter_1.default();
            return this.parser;
        }
        catch {
            return null;
        }
    }
    supports(file) {
        return this.supportedExtensions.includes(file.extension);
    }
    parse(file, context) {
        const parser = this.initParser();
        if (!parser)
            return (0, base_1.emptyResult)();
        const lang = file.extension === '.tsx' || file.extension === '.jsx'
            ? this.tsxLang
            : this.tsLang;
        if (!lang)
            return (0, base_1.emptyResult)();
        try {
            parser.setLanguage(lang);
            const tree = parser.parse(file.content);
            const root = tree.rootNode;
            const isFrontend = isFrontendFile(file);
            const serviceId = context.services[0]?.id ?? 'unknown';
            const codeNodes = [];
            const databases = [];
            const brokers = [];
            if (isFrontend) {
                // Arquivos de frontend: extrai screens, components, eventos
                const { screens, components } = (0, screen_extractor_1.extractFrontendNodes)(root, file.relativePath);
                context.screens.push(...screens);
                // Components são parte das screens; não viram CodeNodes diretos
                return (0, base_1.emptyResult)();
            }
            // Endpoints por framework
            const nestResult = (0, nest_extractor_1.extractNestEndpoints)(root, file.relativePath);
            const expressEndpoints = (0, express_extractor_1.extractExpressEndpoints)(root, file.relativePath);
            const fastifyEndpoints = (0, fastify_extractor_1.extractFastifyEndpoints)(root, file.relativePath);
            codeNodes.push(...nestResult.endpoints);
            codeNodes.push(...nestResult.functions);
            codeNodes.push(...expressEndpoints);
            codeNodes.push(...fastifyEndpoints);
            // Funções (evita duplicar endpoints já extraídos)
            const endpointLines = new Set([
                ...nestResult.endpoints.map(e => e.location.line),
            ]);
            const functions = (0, function_extractor_1.extractFunctions)(root, file.relativePath)
                .filter(f => !endpointLines.has(f.location.line));
            codeNodes.push(...functions);
            // DB operations
            const prismaResult = (0, prisma_extractor_1.extractPrismaOperations)(root, file.relativePath);
            if (prismaResult.dbNodes.length > 0) {
                codeNodes.push(...prismaResult.dbNodes);
                databases.push(prismaResult.database);
            }
            const typeormResult = (0, typeorm_extractor_1.extractTypeORMOperations)(root, file.relativePath);
            if (typeormResult.dbNodes.length > 0) {
                codeNodes.push(...typeormResult.dbNodes);
                databases.push(typeormResult.database);
            }
            const sequelizeResult = (0, sequelize_extractor_1.extractSequelizeOperations)(root, file.relativePath);
            if (sequelizeResult.dbNodes.length > 0) {
                codeNodes.push(...sequelizeResult.dbNodes);
                databases.push(sequelizeResult.database);
            }
            // Eventos e brokers
            const eventResult = (0, event_extractor_1.extractEvents)(root, file.relativePath, serviceId);
            codeNodes.push(...eventResult.eventNodes);
            brokers.push(...eventResult.brokers);
            // Controle de fluxo
            codeNodes.push(...(0, flow_extractor_1.extractFlowControl)(root, file.relativePath));
            // Logs
            codeNodes.push(...(0, log_extractor_1.extractLogs)(root, file.relativePath));
            // Telemetria
            codeNodes.push(...(0, telemetry_extractor_1.extractTelemetry)(root, file.relativePath));
            // Dados (interfaces, types, enums, imports — só módulo)
            codeNodes.push(...(0, data_extractor_1.extractDataNodes)(root, file.relativePath));
            return { codeNodes, databases, brokers };
        }
        catch (err) {
            context.diagnostics.push({
                level: 'error',
                message: `TypeScript parser error in ${file.relativePath}: ${err.message}`,
                location: { file: file.relativePath, line: 1, column: 0 },
            });
            return (0, base_1.emptyResult)();
        }
    }
}
exports.TypeScriptParser = TypeScriptParser;
/** Verifica se o arquivo é de frontend (React/Vue/Svelte components) */
function isFrontendFile(file) {
    const path = file.relativePath.toLowerCase();
    // Extensões JSX/TSX são sempre frontend
    if (file.extension === '.tsx' || file.extension === '.jsx')
        return true;
    // Padrões de diretório comuns de frontend
    if (/\/(pages|screens|views|components|ui|app)\//i.test(path))
        return true;
    // Padrões de nome que indicam component/screen
    const name = path.split('/').pop() ?? '';
    if (/Page|Screen|View|Component|Modal|Dialog|Drawer/i.test(name))
        return true;
    return false;
}
//# sourceMappingURL=typescript.parser.js.map