"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeBrokers = mergeBrokers;
exports.buildBrokerFromHint = buildBrokerFromHint;
const id_1 = require("../utils/id");
/**
 * Merge de múltiplos BrokerNodes com o mesmo alias/engine.
 * Consolida tópicos descobertos de múltiplos arquivos.
 */
function mergeBrokers(brokers) {
    const byAlias = new Map();
    for (const broker of brokers) {
        const key = broker.metadata.connectionAlias;
        const existing = byAlias.get(key);
        if (!existing) {
            byAlias.set(key, { ...broker, metadata: { ...broker.metadata, topics: [...broker.metadata.topics] } });
            continue;
        }
        // Merge topics
        const topicsByName = new Map(existing.metadata.topics.map(t => [t.name, t]));
        for (const topic of broker.metadata.topics) {
            const existingTopic = topicsByName.get(topic.name);
            if (!existingTopic) {
                topicsByName.set(topic.name, { ...topic });
            }
            else {
                // Merge producers/consumers
                for (const p of topic.producers) {
                    if (!existingTopic.producers.includes(p))
                        existingTopic.producers.push(p);
                }
                for (const c of topic.consumers) {
                    if (!existingTopic.consumers.includes(c))
                        existingTopic.consumers.push(c);
                }
            }
        }
        existing.metadata.topics = Array.from(topicsByName.values());
    }
    return Array.from(byAlias.values());
}
function buildBrokerFromHint(alias, engine) {
    return {
        id: (0, id_1.resourceId)('broker', alias),
        type: 'broker',
        name: alias,
        metadata: {
            engine: engine,
            category: engineToCategory(engine),
            managed: false,
            connectionAlias: alias,
            topics: [],
        },
    };
}
function engineToCategory(engine) {
    if (['kafka', 'kinesis', 'pulsar'].includes(engine))
        return 'stream';
    if (['sqs', 'rabbitmq', 'nats'].includes(engine))
        return 'queue';
    if (['sns', 'pubsub', 'eventbridge'].includes(engine))
        return 'event-bus';
    if (['redis-streams'].includes(engine))
        return 'pubsub';
    return 'queue';
}
//# sourceMappingURL=broker.builder.js.map