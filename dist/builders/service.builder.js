"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildServiceNode = buildServiceNode;
const id_1 = require("../utils/id");
/**
 * Constrói um ServiceNode a partir da boundary detectada e da stack técnica.
 * Campos que dependem de informações externas ficam undefined — serão preenchidos
 * por outras ferramentas futuramente.
 */
function buildServiceNode(boundary, stack, codeNodes) {
    const id = (0, id_1.serviceId)(boundary.rootPath);
    const name = boundary.name;
    const endpoints = codeNodes.filter((n) => n.type === 'endpoint');
    const functions = codeNodes.filter((n) => n.type === 'function');
    const globals = codeNodes.filter((n) => n.type === 'data' && (n.metadata.scope === 'module' || n.metadata.scope === 'global'));
    return {
        id,
        type: 'service',
        name,
        metadata: {
            code: toKebabCase(name),
            fullName: name,
            runtime: stack.runtime,
            language: stack.language,
            framework: stack.framework !== 'unknown' ? stack.framework : undefined,
            protocol: detectProtocol(stack, endpoints),
            kind: detectServiceKind(stack, endpoints),
        },
        endpoints,
        functions,
        globals,
        dependencies: [],
    };
}
function detectProtocol(stack, endpoints) {
    if (stack.hasGraphQL)
        return 'graphql';
    if (stack.hasGRPC)
        return 'grpc';
    if (endpoints.length > 0)
        return 'rest';
    if (stack.hasBroker)
        return 'event-driven';
    return 'rest';
}
function detectServiceKind(stack, endpoints) {
    if (endpoints.length === 0 && stack.hasBroker)
        return 'worker';
    if (stack.framework === 'next' || stack.framework === 'nuxt' || stack.framework === 'remix')
        return 'bff';
    return 'backend';
}
function toKebabCase(str) {
    return str
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '')
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-');
}
//# sourceMappingURL=service.builder.js.map