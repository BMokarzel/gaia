import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, extractStringValue } from '../../utils/ast-helpers';
import { nodeId, resourceId } from '../../utils/id';
import type { EventNode, BrokerNode } from '../../types/topology';

export interface PythonEventExtractionResult {
  eventNodes: EventNode[];
  brokers: BrokerNode[];
}

const KAFKA_PRODUCER_RE = /producer|kafka_producer|KafkaProducer/i;
const KAFKA_CONSUMER_RE = /consumer|kafka_consumer|KafkaConsumer/i;
const CELERY_RE = /celery|app|shared_task/i;

export function extractPythonEvents(
  rootNode: SyntaxNode,
  filePath: string,
  serviceId: string,
): PythonEventExtractionResult {
  const eventNodes: EventNode[] = [];
  const brokersMap = new Map<string, BrokerNode>();

  for (const call of findAll(rootNode, 'call')) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    const args = call.childForFieldName('arguments');

    // KafkaConsumer("topic1", "topic2", ...) constructor — positional string args are topic names
    if (fn.type === 'identifier' && /KafkaConsumer/i.test(fn.text)) {
      const topicArgs = args?.namedChildren.filter(a =>
        a.type === 'string' || a.type === 'concatenated_string'
      ) ?? [];
      for (const topicArg of topicArgs) {
        const topicName = extractStringValue(topicArg) ?? topicArg.text.replace(/^['"]|['"]$/g, '');
        if (!topicName || topicName.startsWith('bootstrap') || topicName.startsWith('group')) continue;
        ensureKafkaBroker(brokersMap, topicName, serviceId, 'consumer');
        const loc = toLocation(call, filePath);
        eventNodes.push({
          id: nodeId('event', filePath, loc.line, `kafka.subscribe:${topicName}`),
          type: 'event',
          name: topicName,
          location: loc,
          children: [],
          metadata: { kind: 'subscribe', eventName: topicName, channel: 'kafka' },
        });
      }
    }

    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object');
      const attr = fn.childForFieldName('attribute');
      if (!obj || !attr) continue;

      const objText = obj.text;
      const methodName = attr.text;

      // kafka-python: producer.send('topic', value=...)
      if (KAFKA_PRODUCER_RE.test(objText) && methodName === 'send') {
        const firstArg = args?.namedChildren[0];
        const topicName = firstArg ? (extractStringValue(firstArg) ?? firstArg.text) : 'unknown';
        ensureKafkaBroker(brokersMap, topicName, serviceId, 'producer');

        const loc = toLocation(call, filePath);
        eventNodes.push({
          id: nodeId('event', filePath, loc.line, `kafka.send:${topicName}`),
          type: 'event',
          name: topicName,
          location: loc,
          children: [],
          metadata: { kind: 'publish', eventName: topicName, channel: 'kafka' },
        });
        continue;
      }

      // confluent-kafka / kafka-python consumer.subscribe(['topic'])
      if (KAFKA_CONSUMER_RE.test(objText) && methodName === 'subscribe') {
        const firstArg = args?.namedChildren[0];
        const topicName = firstArg ? extractTopicFromList(firstArg) : 'unknown';
        ensureKafkaBroker(brokersMap, topicName, serviceId, 'consumer');

        const loc = toLocation(call, filePath);
        eventNodes.push({
          id: nodeId('event', filePath, loc.line, `kafka.subscribe:${topicName}`),
          type: 'event',
          name: topicName,
          location: loc,
          children: [],
          metadata: { kind: 'subscribe', eventName: topicName, channel: 'kafka' },
        });
        continue;
      }

      // pika / aio-pika: channel.basic_publish(exchange, routing_key, body)
      if (/channel|connection/i.test(objText) && /publish|basic_publish/.test(methodName)) {
        const topicName = extractPikaRoutingKey(args) ?? 'exchange';
        ensureRabbitBroker(brokersMap, topicName, serviceId);

        const loc = toLocation(call, filePath);
        eventNodes.push({
          id: nodeId('event', filePath, loc.line, `rabbitmq.publish:${topicName}`),
          type: 'event',
          name: topicName,
          location: loc,
          children: [],
          metadata: { kind: 'publish', eventName: topicName, channel: 'rabbitmq' },
        });
        continue;
      }

      // pika: channel.basic_consume(queue, callback)
      if (/channel/i.test(objText) && methodName === 'basic_consume') {
        const firstArg = args?.namedChildren[0];
        const queueName = firstArg ? (extractStringValue(firstArg) ?? 'queue') : 'queue';
        ensureRabbitBroker(brokersMap, queueName, serviceId);

        const loc = toLocation(call, filePath);
        eventNodes.push({
          id: nodeId('event', filePath, loc.line, `rabbitmq.consume:${queueName}`),
          type: 'event',
          name: queueName,
          location: loc,
          children: [],
          metadata: { kind: 'subscribe', eventName: queueName, channel: 'rabbitmq' },
        });
        continue;
      }
    }

    // Celery: task.delay(...) / task.apply_async(...)
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute');
      if (attr?.text === 'delay' || attr?.text === 'apply_async') {
        const obj = fn.childForFieldName('object');
        const taskName = obj?.text ?? 'celery_task';
        if (!CELERY_RE.test(taskName) && taskName !== 'unknown') {
          const loc = toLocation(call, filePath);
          eventNodes.push({
            id: nodeId('event', filePath, loc.line, `celery.dispatch:${taskName}`),
            type: 'event',
            name: taskName,
            location: loc,
            children: [],
            metadata: { kind: 'dispatch', eventName: taskName },
          });
        }
      }
    }
  }

  // Django signals: post_save.connect, pre_delete.connect
  for (const call of findAll(rootNode, 'call')) {
    const fn = call.childForFieldName('function');
    if (fn?.type !== 'attribute') continue;
    const attr = fn.childForFieldName('attribute');
    if (attr?.text !== 'connect' && attr?.text !== 'send') continue;
    const obj = fn.childForFieldName('object');
    if (!obj) continue;

    const signalName = obj.text;
    const DJANGO_SIGNALS = new Set(['post_save', 'pre_save', 'post_delete', 'pre_delete',
      'post_migrate', 'pre_migrate', 'm2m_changed', 'request_started', 'request_finished']);

    if (DJANGO_SIGNALS.has(signalName)) {
      const loc = toLocation(call, filePath);
      const kind: EventNode['metadata']['kind'] = attr.text === 'send' ? 'emit' : 'on';
      eventNodes.push({
        id: nodeId('event', filePath, loc.line, `django.${attr.text}:${signalName}`),
        type: 'event',
        name: signalName,
        location: loc,
        children: [],
        metadata: { kind, eventName: signalName },
      });
    }
  }

  return { eventNodes, brokers: Array.from(brokersMap.values()) };
}

function extractTopicFromList(node: SyntaxNode): string {
  // ['topic1', 'topic2'] or 'topic'
  if (node.type === 'list') {
    const first = node.namedChildren[0];
    if (first) return extractStringValue(first) ?? first.text;
  }
  return extractStringValue(node) ?? node.text;
}

function extractPikaRoutingKey(args: SyntaxNode | null | undefined): string | null {
  if (!args) return null;
  // basic_publish(exchange='', routing_key='queue', body=...)
  for (const arg of args.namedChildren) {
    if (arg.type === 'keyword_argument') {
      const key = arg.childForFieldName('name')?.text;
      if (key === 'routing_key') {
        const val = arg.childForFieldName('value');
        return val ? (extractStringValue(val) ?? val.text) : null;
      }
    }
  }
  // positional: exchange, routing_key, body
  const second = args.namedChildren[1];
  return second ? (extractStringValue(second) ?? second.text) : null;
}

function ensureKafkaBroker(
  map: Map<string, BrokerNode>,
  topic: string,
  serviceId: string,
  role: 'producer' | 'consumer',
): void {
  if (!map.has('kafka')) {
    map.set('kafka', {
      id: resourceId('broker', 'kafka'),
      type: 'broker',
      name: 'kafka',
      metadata: { engine: 'kafka', category: 'stream', managed: false, connectionAlias: 'kafka', topics: [] },
    });
  }
  const broker = map.get('kafka')!;
  let t = broker.metadata.topics.find(x => x.name === topic);
  if (!t) { t = { name: topic, kind: 'topic', producers: [], consumers: [] }; broker.metadata.topics.push(t); }
  if (role === 'producer' && !t.producers.includes(serviceId)) t.producers.push(serviceId);
  if (role === 'consumer' && !t.consumers.includes(serviceId)) t.consumers.push(serviceId);
}

function ensureRabbitBroker(map: Map<string, BrokerNode>, queue: string, serviceId: string): void {
  if (!map.has('rabbitmq')) {
    map.set('rabbitmq', {
      id: resourceId('broker', 'rabbitmq'),
      type: 'broker',
      name: 'rabbitmq',
      metadata: { engine: 'rabbitmq', category: 'queue', managed: false, connectionAlias: 'rabbitmq', topics: [] },
    });
  }
  const broker = map.get('rabbitmq')!;
  if (!broker.metadata.topics.find(x => x.name === queue)) {
    broker.metadata.topics.push({ name: queue, kind: 'queue', producers: [serviceId], consumers: [] });
  }
}
