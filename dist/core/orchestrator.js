"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeRepository = analyzeRepository;
const walker_1 = require("./walker");
const detector_1 = require("./detector");
const typescript_parser_1 = require("../parsers/typescript.parser");
const java_parser_1 = require("../parsers/java.parser");
const python_parser_1 = require("../parsers/python.parser");
const kotlin_parser_1 = require("../parsers/kotlin.parser");
const swift_parser_1 = require("../parsers/swift.parser");
const go_parser_1 = require("../parsers/go.parser");
const rust_parser_1 = require("../parsers/rust.parser");
const csharp_parser_1 = require("../parsers/csharp.parser");
const service_builder_1 = require("../builders/service.builder");
const database_builder_1 = require("../builders/database.builder");
const broker_builder_1 = require("../builders/broker.builder");
const edge_builder_1 = require("../builders/edge.builder");
const error_flow_builder_1 = require("../builders/error-flow.builder");
const PARSERS = [
    new typescript_parser_1.TypeScriptParser(),
    new java_parser_1.JavaParser(),
    new python_parser_1.PythonParser(),
    new kotlin_parser_1.KotlinParser(),
    new swift_parser_1.SwiftParser(),
    new go_parser_1.GoParser(),
    new rust_parser_1.RustParser(),
    new csharp_parser_1.CSharpParser(),
];
/**
 * Pipeline principal de análise de um repositório.
 * Produz um SystemTopology completo a partir de um path de repositório.
 */
async function analyzeRepository(repoPath, options = {}) {
    const { skipTests = true, includeFrontend = true, onProgress = () => { }, } = options;
    const context = {
        repoPath,
        services: [],
        databases: new Map(),
        brokers: new Map(),
        storages: new Map(),
        screens: [],
        edges: [],
        diagnostics: [],
        nodeIndex: new Map(),
    };
    // 1. Detecta boundaries de serviços (monorepo vs single service)
    onProgress('Detecting service boundaries...');
    const boundaries = (0, walker_1.detectServiceBoundaries)(repoPath);
    onProgress(`Found ${boundaries.length} service(s)`);
    // 2. Para cada boundary, analisa os arquivos
    for (const boundary of boundaries) {
        onProgress(`Analyzing service: ${boundary.name}`);
        await analyzeService(boundary, context, { skipTests, includeFrontend, onProgress });
    }
    // 3. Consolida databases e brokers de todos os serviços
    const allDatabases = Array.from(context.databases.values());
    const allBrokers = Array.from(context.brokers.values());
    // 4. Atualiza ServiceDependencies baseado nos databases/brokers encontrados
    for (const service of context.services) {
        enrichServiceDependencies(service, allDatabases, allBrokers);
    }
    // 5. Constrói edges globais
    onProgress('Building edges...');
    const edges = (0, edge_builder_1.buildEdges)(context.services, allDatabases, allBrokers);
    // 6. Constrói error flow map
    onProgress('Mapping error flows...');
    const errorFlow = (0, error_flow_builder_1.buildErrorFlowMap)(context.services);
    // 7. Coleta telemetria e logs
    const { logs, telemetry } = collectObservability(context.services);
    // 8. Calcula coverage
    const coverage = calculateCoverage(context.services, telemetry);
    const topology = {
        schemaVersion: '3.0.0',
        analyzedAt: new Date().toISOString(),
        services: context.services,
        databases: allDatabases,
        storages: Array.from(context.storages.values()),
        brokers: allBrokers,
        screens: context.screens,
        edges,
        errorFlow,
        observability: {
            logs,
            telemetry,
            coverage,
        },
        diagnostics: context.diagnostics,
    };
    return topology;
}
async function analyzeService(boundary, context, options) {
    const { skipTests, includeFrontend, onProgress } = options;
    // Detecta stack tecnológica
    const stack = (0, detector_1.detectTechStack)(boundary);
    // Walk nos arquivos do serviço
    const files = (0, walker_1.walkRepository)(boundary.rootPath, {
        skipTests,
        extensions: includeFrontend ? undefined : excludeFrontendExtensions(),
    });
    onProgress(`  ${files.length} files found in ${boundary.name}`);
    const allCodeNodes = [];
    const serviceDatabases = [];
    const serviceBrokers = [];
    // Parseia cada arquivo com o parser adequado
    for (const file of files) {
        const parser = PARSERS.find(p => p.supports(file));
        if (!parser)
            continue;
        try {
            const result = parser.parse(file, context);
            allCodeNodes.push(...result.codeNodes);
            // Acumula databases
            for (const db of result.databases) {
                const existing = context.databases.get(db.metadata.connectionAlias);
                if (!existing) {
                    context.databases.set(db.metadata.connectionAlias, db);
                }
                else {
                    // Merge tables
                    for (const table of db.tables) {
                        const existingTable = existing.tables.find(t => t.name.toLowerCase() === table.name.toLowerCase());
                        if (!existingTable) {
                            existing.tables.push(table);
                        }
                    }
                }
            }
            // Acumula brokers
            for (const broker of result.brokers) {
                const existing = context.brokers.get(broker.metadata.connectionAlias);
                if (!existing) {
                    context.brokers.set(broker.metadata.connectionAlias, broker);
                }
                else {
                    for (const topic of broker.metadata.topics) {
                        const existingTopic = existing.metadata.topics.find(t => t.name === topic.name);
                        if (!existingTopic) {
                            existing.metadata.topics.push(topic);
                        }
                    }
                }
            }
        }
        catch (err) {
            context.diagnostics.push({
                level: 'warning',
                message: `Failed to parse ${file.relativePath}: ${err.message}`,
                location: { file: file.relativePath, line: 1, column: 0 },
            });
        }
    }
    // Adiciona databases da stack que ainda não foram detectados no código
    for (const hint of stack.databaseHints) {
        if (!context.databases.has(hint.alias)) {
            const db = (0, database_builder_1.buildDatabaseFromHint)(hint.alias, hint.engine, hint.orm);
            context.databases.set(hint.alias, db);
        }
    }
    // Adiciona brokers da stack
    for (const hint of stack.brokerHints) {
        if (!context.brokers.has(hint.alias)) {
            const broker = (0, broker_builder_1.buildBrokerFromHint)(hint.alias, hint.engine);
            context.brokers.set(hint.alias, broker);
        }
    }
    // Constrói ServiceNode
    const service = (0, service_builder_1.buildServiceNode)(boundary, stack, allCodeNodes);
    context.services.push(service);
    // Indexa nós para resolução de edges
    for (const node of allCodeNodes) {
        context.nodeIndex.set(node.id, node);
    }
}
function enrichServiceDependencies(service, databases, brokers) {
    // Infere dependências a partir dos dbProcess nodes
    const dbIds = new Set();
    const brokerIds = new Set();
    function walkNodes(nodes) {
        for (const node of nodes) {
            if (node.type === 'dbProcess') {
                dbIds.add(node.metadata.databaseId);
            }
            if (node.type === 'event') {
                const channel = node.metadata.channel;
                if (channel) {
                    const broker = brokers.find(b => b.metadata.connectionAlias === channel);
                    if (broker)
                        brokerIds.add(broker.id);
                }
            }
        }
    }
    walkNodes(service.endpoints);
    walkNodes(service.functions);
    for (const dbId of dbIds) {
        const alreadyLinked = service.dependencies.some(d => d.targetId === dbId);
        if (!alreadyLinked) {
            service.dependencies.push({
                targetId: dbId,
                targetType: 'database',
                kind: 'sync',
                critical: true,
            });
        }
    }
    for (const brokerId of brokerIds) {
        const alreadyLinked = service.dependencies.some(d => d.targetId === brokerId);
        if (!alreadyLinked) {
            service.dependencies.push({
                targetId: brokerId,
                targetType: 'broker',
                kind: 'async',
                critical: false,
            });
        }
    }
}
function collectObservability(services) {
    const logs = [];
    const telemetry = [];
    function walkNodes(nodes) {
        for (const node of nodes) {
            if (node.type === 'log')
                logs.push(node);
            if (node.type === 'telemetry')
                telemetry.push(node);
            walkNodes(node.children);
        }
    }
    for (const service of services) {
        walkNodes(service.endpoints);
        walkNodes(service.functions);
        walkNodes(service.globals);
    }
    return { logs, telemetry };
}
function calculateCoverage(services, telemetry) {
    let endpointsTotal = 0;
    let endpointsWithTracing = 0;
    let dbQueriesTotal = 0;
    let dbQueriesWithSpans = 0;
    let errorsTotal = 0;
    let errorsWithLogging = 0;
    const tracedNodeIds = new Set(telemetry.filter(t => t.metadata.kind === 'span').map(t => t.id));
    for (const service of services) {
        endpointsTotal += service.endpoints.length;
        endpointsWithTracing += service.endpoints.filter(e => service.functions.some(f => f.metadata.decorators?.some(d => /span|trace/i.test(d)))).length;
        for (const fn of service.functions) {
            const dbNodes = fn.children.filter(c => c.type === 'dbProcess');
            dbQueriesTotal += dbNodes.length;
            const throwNodes = fn.children.filter(c => c.type === 'throw');
            errorsTotal += throwNodes.length;
            errorsWithLogging += fn.children.filter(c => c.type === 'log' &&
                c.metadata.level === 'error').length;
        }
    }
    return {
        endpointsTotal,
        endpointsWithTracing,
        dbQueriesTotal,
        dbQueriesWithSpans,
        errorsTotal,
        errorsWithLogging,
        screensWithAnalytics: 0,
        screensTotal: 0,
    };
}
function excludeFrontendExtensions() {
    return ['.ts', '.java', '.kt', '.py', '.go', '.rs', '.swift', '.cs', '.cpp', '.c'];
}
//# sourceMappingURL=orchestrator.js.map