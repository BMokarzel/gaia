import type { SyntaxNode } from '../../utils/ast-helpers';
import {
  findAll, toLocation, memberChain, extractStringValue,
  callArguments, isAwaited,
} from '../../utils/ast-helpers';
import { nodeId, resourceId } from '../../utils/id';
import type { EventNode, BrokerNode, BrokerTopic } from '../../types/topology';

/** Padrões de emit de eventos */
const EMIT_PATTERNS: Record<string, EventNode['metadata']['kind']> = {
  emit: 'emit',
  emitAsync: 'emit',
  publish: 'publish',
  send: 'publish',
  dispatch: 'dispatch',
  trigger: 'emit',
  fire: 'emit',
};

/** Padrões de subscribe/listen */
const LISTEN_PATTERNS: Record<string, EventNode['metadata']['kind']> = {
  on: 'on',
  once: 'once',
  off: 'off',
  addListener: 'on',
  removeListener: 'off',
  subscribe: 'subscribe',
  addEventListener: 'addEventListener',
};

/** Objetos que indicam kafka producer */
const KAFKA_PRODUCER_PATTERNS = [/producer/i, /kafkaProducer/i];
const KAFKA_CONSUMER_PATTERNS = [/consumer/i, /kafkaConsumer/i];

/** Objetos que indicam RabbitMQ channel */
const RABBITMQ_PATTERNS = [/channel/i, /amqp/i, /rabbit/i];

/** Padrão para EventEmitter2 / NestJS EventBus */
const EMITTER_PATTERNS = [
  /emitter/i, /eventBus/i, /eventEmitter/i, /bus/i,
  /this\.events/i, /this\.emitter/i,
];

export interface EventExtractionResult {
  eventNodes: EventNode[];
  brokers: BrokerNode[];
}

/**
 * Extrai emissões e subscrições de eventos de um arquivo TypeScript.
 * Detecta:
 *   - EventEmitter2: this.emitter.emit('user.created', payload)
 *   - NestJS EventBus: this.eventBus.publish(new UserCreatedEvent())
 *   - KafkaJS: producer.send({ topic, messages })
 *   - RabbitMQ: channel.publish(exchange, routingKey, buffer)
 *   - RxJS: subject.next(), observable.subscribe()
 */
export function extractEvents(
  rootNode: SyntaxNode,
  filePath: string,
  serviceId: string,
): EventExtractionResult {
  const eventNodes: EventNode[] = [];
  const brokersMap = new Map<string, BrokerNode>();

  const calls = findAll(rootNode, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    if (fn.type === 'member_expression') {
      const chain = memberChain(fn);
      if (chain.length < 2) continue;

      const obj = chain.slice(0, -1).join('.');
      const method = chain[chain.length - 1];
      const args = call.childForFieldName('arguments');

      // Kafka producer.send({ topic, messages })
      if (KAFKA_PRODUCER_PATTERNS.some(p => p.test(obj)) && method === 'send') {
        const result = extractKafkaEmit(call, fn, filePath, serviceId, brokersMap);
        if (result) eventNodes.push(result);
        continue;
      }

      // Kafka consumer.subscribe({ topic, ... })
      if (KAFKA_CONSUMER_PATTERNS.some(p => p.test(obj)) && method === 'subscribe') {
        const result = extractKafkaSubscribe(call, fn, filePath, serviceId, brokersMap);
        if (result) eventNodes.push(result);
        continue;
      }

      // RabbitMQ channel.publish / channel.sendToQueue
      if (RABBITMQ_PATTERNS.some(p => p.test(obj)) &&
          (method === 'publish' || method === 'sendToQueue' || method === 'consume')) {
        const result = extractRabbitMQEvent(call, fn, filePath, serviceId, brokersMap, method);
        if (result) eventNodes.push(result);
        continue;
      }

      // EventEmitter / NestJS EventBus
      const emitKind = EMIT_PATTERNS[method];
      const listenKind = LISTEN_PATTERNS[method];

      if ((emitKind || listenKind) &&
          (EMITTER_PATTERNS.some(p => p.test(obj)) || true)) {
        const firstArg = args?.namedChildren[0];
        const eventName = firstArg ? (extractStringValue(firstArg) ?? firstArg.text) : 'unknown';

        if (eventName && eventName !== 'unknown') {
          const loc = toLocation(call, filePath);
          const kind = emitKind ?? listenKind!;
          const id = nodeId('event', filePath, loc.line, `${method}:${eventName}`);

          const secondArg = args?.namedChildren[1];
          const payload = secondArg ? secondArg.text.slice(0, 100) : undefined;

          eventNodes.push({
            id,
            type: 'event',
            name: eventName,
            location: loc,
            children: [],
            metadata: {
              kind,
              eventName,
              payload,
            },
          });
        }
      }
    }
  }

  return { eventNodes, brokers: Array.from(brokersMap.values()) };
}

function extractKafkaEmit(
  call: SyntaxNode,
  fn: SyntaxNode,
  filePath: string,
  serviceId: string,
  brokersMap: Map<string, BrokerNode>,
): EventNode | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;

  // producer.send({ topic: 'user.created', messages: [...] })
  const argsText = args.text;
  const topicMatch = argsText.match(/topic\s*:\s*['"`]([^'"`]+)['"`]/);
  const topicName = topicMatch ? topicMatch[1] : 'unknown';

  ensureKafkaBroker(brokersMap, topicName, serviceId, 'producer');

  const loc = toLocation(call, filePath);
  const id = nodeId('event', filePath, loc.line, `kafka.emit:${topicName}`);

  return {
    id,
    type: 'event',
    name: topicName,
    location: loc,
    children: [],
    metadata: {
      kind: 'publish',
      eventName: topicName,
      channel: 'kafka',
    },
  };
}

function extractKafkaSubscribe(
  call: SyntaxNode,
  fn: SyntaxNode,
  filePath: string,
  serviceId: string,
  brokersMap: Map<string, BrokerNode>,
): EventNode | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;

  const argsText = args.text;
  const topicMatch = argsText.match(/topic\s*:\s*['"`]([^'"`]+)['"`]/);
  const topicName = topicMatch ? topicMatch[1] : 'unknown';

  ensureKafkaBroker(brokersMap, topicName, serviceId, 'consumer');

  const loc = toLocation(call, filePath);
  const id = nodeId('event', filePath, loc.line, `kafka.subscribe:${topicName}`);

  return {
    id,
    type: 'event',
    name: topicName,
    location: loc,
    children: [],
    metadata: {
      kind: 'subscribe',
      eventName: topicName,
      channel: 'kafka',
    },
  };
}

function extractRabbitMQEvent(
  call: SyntaxNode,
  fn: SyntaxNode,
  filePath: string,
  serviceId: string,
  brokersMap: Map<string, BrokerNode>,
  method: string,
): EventNode | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;

  const firstArg = args.namedChildren[0];
  const secondArg = args.namedChildren[1];

  // channel.publish(exchange, routingKey, buffer)
  // channel.sendToQueue(queue, buffer)
  const exchange = firstArg ? (extractStringValue(firstArg) ?? 'unknown') : 'unknown';
  const routingKey = secondArg ? (extractStringValue(secondArg) ?? '') : '';
  const topicName = routingKey || exchange;

  const brokerKey = 'rabbitmq';
  if (!brokersMap.has(brokerKey)) {
    brokersMap.set(brokerKey, {
      id: resourceId('broker', brokerKey),
      type: 'broker',
      name: 'rabbitmq',
      metadata: {
        engine: 'rabbitmq',
        category: 'queue',
        managed: false,
        connectionAlias: brokerKey,
        topics: [],
      },
    });
  }

  const broker = brokersMap.get(brokerKey)!;
  const existingTopic = broker.metadata.topics.find(t => t.name === topicName);
  if (!existingTopic) {
    broker.metadata.topics.push({
      name: topicName,
      kind: method === 'consume' ? 'queue' : 'exchange',
      producers: method === 'publish' || method === 'sendToQueue' ? [serviceId] : [],
      consumers: method === 'consume' ? [serviceId] : [],
    });
  }

  const kind: EventNode['metadata']['kind'] = method === 'consume' ? 'subscribe' : 'publish';
  const loc = toLocation(call, filePath);
  const id = nodeId('event', filePath, loc.line, `rabbitmq.${method}:${topicName}`);

  return {
    id,
    type: 'event',
    name: topicName,
    location: loc,
    children: [],
    metadata: {
      kind,
      eventName: topicName,
      channel: 'rabbitmq',
    },
  };
}

function ensureKafkaBroker(
  brokersMap: Map<string, BrokerNode>,
  topicName: string,
  serviceId: string,
  role: 'producer' | 'consumer',
): void {
  const brokerKey = 'kafka';
  if (!brokersMap.has(brokerKey)) {
    brokersMap.set(brokerKey, {
      id: resourceId('broker', brokerKey),
      type: 'broker',
      name: 'kafka',
      metadata: {
        engine: 'kafka',
        category: 'stream',
        managed: false,
        connectionAlias: brokerKey,
        topics: [],
      },
    });
  }

  const broker = brokersMap.get(brokerKey)!;
  let topic = broker.metadata.topics.find(t => t.name === topicName);

  if (!topic) {
    topic = {
      name: topicName,
      kind: 'topic',
      producers: [],
      consumers: [],
    };
    broker.metadata.topics.push(topic);
  }

  if (role === 'producer' && !topic.producers.includes(serviceId)) {
    topic.producers.push(serviceId);
  }
  if (role === 'consumer' && !topic.consumers.includes(serviceId)) {
    topic.consumers.push(serviceId);
  }
}
