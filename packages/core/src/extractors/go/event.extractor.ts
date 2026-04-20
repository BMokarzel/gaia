import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, extractStringValue } from '../../utils/ast-helpers';
import { nodeId, resourceId } from '../../utils/id';
import { escapeRegex } from '../../utils/regex';
import type { EventNode, BrokerNode } from '../../types/topology';

export interface GoEventExtractionResult {
  eventNodes: EventNode[];
  brokers: BrokerNode[];
}

/** kafka-go writer */
const KAFKA_WRITER_RE = /writer|Writer|producer|Producer|kafkaWriter/i;
/** kafka-go reader */
const KAFKA_READER_RE = /reader|Reader|consumer|Consumer|kafkaReader/i;
/** amqp / rabbitmq */
const AMQP_RE = /ch|channel|amqp|rabbit/i;
/** nats */
const NATS_RE = /nc|nats|conn/i;

export function extractGoEvents(
  rootNode: SyntaxNode,
  filePath: string,
  serviceId: string,
): GoEventExtractionResult {
  const eventNodes: EventNode[] = [];
  const brokersMap = new Map<string, BrokerNode>();

  for (const call of findAll(rootNode, 'call_expression')) {
    const fn = call.childForFieldName('function');
    if (!fn || fn.type !== 'selector_expression') continue;

    const operand = fn.childForFieldName('operand');
    const field = fn.childForFieldName('field');
    if (!operand || !field) continue;

    const objText = operand.text;
    const methodName = field.text;
    const args = call.childForFieldName('arguments');

    // kafka-go: writer.WriteMessages(ctx, kafka.Message{Topic: "..."})
    if (KAFKA_WRITER_RE.test(objText) && methodName === 'WriteMessages') {
      const topicName = extractKafkaGoTopic(args) ?? 'unknown';
      ensureKafkaBroker(brokersMap, topicName, serviceId, 'producer');

      const loc = toLocation(call, filePath);
      eventNodes.push({
        id: nodeId('event', filePath, loc.line, `kafka.write:${topicName}`),
        type: 'event',
        name: topicName,
        location: loc,
        children: [],
        metadata: { kind: 'publish', eventName: topicName, channel: 'kafka' },
      });
      continue;
    }

    // kafka-go: kafka.NewReader({ Topic: "..." })
    if (objText === 'kafka' && methodName === 'NewReader') {
      const topicName = extractKafkaGoConfigField(args, 'Topic') ?? 'unknown';
      ensureKafkaBroker(brokersMap, topicName, serviceId, 'consumer');

      const loc = toLocation(call, filePath);
      eventNodes.push({
        id: nodeId('event', filePath, loc.line, `kafka.read:${topicName}`),
        type: 'event',
        name: topicName,
        location: loc,
        children: [],
        metadata: { kind: 'subscribe', eventName: topicName, channel: 'kafka' },
      });
      continue;
    }

    // Sarama: producer.SendMessage(&sarama.ProducerMessage{Topic: "..."})
    if (/producer|Producer/i.test(objText) && (methodName === 'SendMessage' || methodName === 'SendMessages')) {
      const topicName = extractSaramaTopic(args) ?? 'unknown';
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

    // amqp: ch.Publish(exchange, routingKey, ...)
    if (AMQP_RE.test(objText) && methodName === 'Publish') {
      const exchange = args?.namedChildren[0];
      const routingKey = args?.namedChildren[1];
      const topicName = routingKey
        ? (extractStringValue(routingKey) ?? routingKey.text)
        : (exchange ? (extractStringValue(exchange) ?? exchange.text) : 'exchange');

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

    // amqp: ch.Consume(queue, ...)
    if (AMQP_RE.test(objText) && methodName === 'Consume') {
      const firstArg = args?.namedChildren[0];
      const queueName = firstArg ? (extractStringValue(firstArg) ?? firstArg.text) : 'queue';
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

    // NATS: nc.Publish("subject", msg) / nc.Subscribe("subject", handler)
    if (NATS_RE.test(objText)) {
      if (methodName === 'Publish' || methodName === 'PublishMsg') {
        const firstArg = args?.namedChildren[0];
        const subject = firstArg ? (extractStringValue(firstArg) ?? firstArg.text) : 'subject';

        const loc = toLocation(call, filePath);
        eventNodes.push({
          id: nodeId('event', filePath, loc.line, `nats.publish:${subject}`),
          type: 'event',
          name: subject,
          location: loc,
          children: [],
          metadata: { kind: 'publish', eventName: subject },
        });
      }
      if (methodName === 'Subscribe' || methodName === 'QueueSubscribe') {
        const firstArg = args?.namedChildren[0];
        const subject = firstArg ? (extractStringValue(firstArg) ?? firstArg.text) : 'subject';

        const loc = toLocation(call, filePath);
        eventNodes.push({
          id: nodeId('event', filePath, loc.line, `nats.subscribe:${subject}`),
          type: 'event',
          name: subject,
          location: loc,
          children: [],
          metadata: { kind: 'subscribe', eventName: subject },
        });
      }
    }
  }

  return { eventNodes, brokers: Array.from(brokersMap.values()) };
}

function extractKafkaGoTopic(args: SyntaxNode | null | undefined): string | null {
  if (!args) return null;
  // kafka.Message{Topic: "user.events"}
  const text = args.text;
  const match = text.match(/Topic\s*:\s*["']([^"']+)["']/);
  return match ? match[1] : null;
}

function extractKafkaGoConfigField(args: SyntaxNode | null | undefined, field: string): string | null {
  if (!args) return null;
  const text = args.text;
  const re = new RegExp(`${escapeRegex(field)}\\s*:\\s*["']([^"']+)["']`);
  const match = text.match(re);
  return match ? match[1] : null;
}

function extractSaramaTopic(args: SyntaxNode | null | undefined): string | null {
  if (!args) return null;
  const text = args.text;
  const match = text.match(/Topic\s*:\s*["']([^"']+)["']/);
  return match ? match[1] : null;
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
