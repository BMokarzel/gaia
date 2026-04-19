"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEdges = buildEdges;
/**
 * Constrói edges a partir dos nós extraídos.
 * Conecta: endpoints → functions → dbProcesses → databases
 *          functions → events → brokers
 *          services → databases / brokers (ServiceDependency)
 */
function buildEdges(services, databases, brokers) {
    const edges = [];
    for (const service of services) {
        const dbIds = new Set(databases.map(d => d.id));
        const brokerIds = new Map(brokers.map(b => [b.metadata.connectionAlias, b.id]));
        // Endpoint → Function (endpoints são implementados por funções)
        for (const endpoint of service.endpoints) {
            const fn = service.functions.find(f => f.name === endpoint.name &&
                f.location.file === endpoint.location.file);
            if (fn) {
                edges.push({ from: endpoint.id, to: fn.id, kind: 'calls' });
            }
        }
        // Coleta todos os codeNodes do serviço
        const allNodes = [
            ...service.endpoints,
            ...service.functions,
            ...service.globals,
        ];
        for (const node of allNodes) {
            // Function → DbProcess (writes_to / reads_from)
            if (node.type === 'dbProcess') {
                const dbNode = node;
                const db = databases.find(d => d.id === dbNode.metadata.databaseId);
                if (db) {
                    const isWrite = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'raw', 'migrate'].includes(dbNode.metadata.operation);
                    edges.push({
                        from: dbNode.id,
                        to: db.id,
                        kind: isWrite ? 'writes_to' : 'reads_from',
                        metadata: {
                            operation: dbNode.metadata.operation,
                            orm: dbNode.metadata.orm,
                            table: dbNode.metadata.tableId,
                        },
                    });
                }
            }
            // Event → Broker
            if (node.type === 'event') {
                const eventNode = node;
                const channel = eventNode.metadata.channel;
                if (channel) {
                    const brokerId = brokerIds.get(channel);
                    if (brokerId) {
                        const kind = ['emit', 'publish', 'dispatch'].includes(eventNode.metadata.kind)
                            ? 'publishes_to'
                            : 'consumes_from';
                        edges.push({
                            from: service.id,
                            to: brokerId,
                            kind,
                            metadata: { topic: eventNode.metadata.eventName },
                        });
                    }
                }
            }
        }
        // Service → Database (depends_on)
        for (const dep of service.dependencies) {
            edges.push({
                from: service.id,
                to: dep.targetId,
                kind: 'depends_on',
                metadata: {
                    kind: dep.kind,
                    protocol: dep.protocol,
                    critical: dep.critical,
                },
            });
        }
    }
    // Broker topic producers/consumers → service edges
    for (const broker of brokers) {
        for (const topic of broker.metadata.topics) {
            for (const producerId of topic.producers) {
                edges.push({
                    from: producerId,
                    to: broker.id,
                    kind: 'publishes_to',
                    metadata: { topic: topic.name },
                });
            }
            for (const consumerId of topic.consumers) {
                edges.push({
                    from: broker.id,
                    to: consumerId,
                    kind: 'consumes_from',
                    metadata: { topic: topic.name },
                });
            }
        }
    }
    return deduplicateEdges(edges);
}
function deduplicateEdges(edges) {
    const seen = new Set();
    return edges.filter(e => {
        const key = `${e.from}→${e.to}:${e.kind}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
//# sourceMappingURL=edge.builder.js.map