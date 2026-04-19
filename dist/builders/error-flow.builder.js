"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildErrorFlowMap = buildErrorFlowMap;
/**
 * Constrói o ErrorFlowMap a partir dos ThrowNodes e catch blocks detectados.
 */
function buildErrorFlowMap(services) {
    const paths = [];
    const globalHandlers = [];
    for (const service of services) {
        const allNodes = [
            ...service.endpoints,
            ...service.functions,
            ...service.globals,
        ];
        // Coleta todos os throws
        const throws = collectThrows(allNodes);
        // Coleta todos os catch blocks
        const catches = collectCatches(allNodes);
        // Para cada throw, tenta traçar o caminho de propagação
        for (const throwNode of throws) {
            const path = buildErrorPath(throwNode, catches, allNodes);
            if (path)
                paths.push(path);
        }
        // Detecta global error handlers (filtros de exceção globais no NestJS, middleware Express, etc.)
        const globalHandlerNodes = findGlobalHandlers(allNodes);
        for (const handler of globalHandlerNodes) {
            globalHandlers.push({
                nodeId: handler.id,
                catches: ['Error'], // Simplificado — captura tudo
                responseTemplate: detectErrorResponseTemplate(handler),
            });
        }
    }
    return { paths, globalHandlers };
}
function collectThrows(nodes) {
    const throws = [];
    function walk(node) {
        if (node.type === 'throw')
            throws.push(node);
        for (const child of node.children)
            walk(child);
    }
    for (const node of nodes)
        walk(node);
    return throws;
}
function collectCatches(nodes) {
    const catches = [];
    function walk(node) {
        if (node.type === 'flowControl') {
            const fc = node;
            if (fc.metadata.kind === 'catch')
                catches.push(fc);
        }
        for (const child of node.children)
            walk(child);
    }
    for (const node of nodes)
        walk(node);
    return catches;
}
function buildErrorPath(throwNode, catches, allNodes) {
    const errorClass = throwNode.metadata.errorClass;
    // Encontra o catch mais próximo pelo arquivo e linha
    const relevantCatch = catches.find(c => c.location.file === throwNode.location.file &&
        c.location.line > throwNode.location.line);
    const resolution = relevantCatch
        ? { kind: 'handled', handlerNodeId: relevantCatch.id, httpStatus: throwNode.metadata.httpStatus }
        : { kind: 'unhandled', httpStatus: throwNode.metadata.httpStatus };
    return {
        origin: {
            nodeId: throwNode.id,
            errorClass,
            context: throwNode.location.file,
        },
        propagation: [],
        resolution,
    };
}
function findGlobalHandlers(nodes) {
    // Detecta: ExceptionFilter (NestJS), error middleware Express (4 params),
    // @ControllerAdvice (Spring), etc.
    return nodes.filter(n => {
        if (n.type === 'function') {
            const fn = n;
            // NestJS ExceptionFilter decorator
            if (fn.metadata.decorators?.some(d => /ExceptionFilter|Catch/i.test(d)))
                return true;
            // Express error middleware: (err, req, res, next)
            if (fn.metadata.params.length === 4 &&
                fn.metadata.params[0]?.name?.match(/^err/i))
                return true;
        }
        return false;
    });
}
function detectErrorResponseTemplate(handler) {
    // Tenta inferir o status code do handler a partir do raw ou metadata
    const raw = handler.raw ?? '';
    const statusMatch = raw.match(/status\((\d{3})\)/);
    if (statusMatch) {
        return { httpStatus: parseInt(statusMatch[1], 10) };
    }
    return { httpStatus: 500 };
}
//# sourceMappingURL=error-flow.builder.js.map