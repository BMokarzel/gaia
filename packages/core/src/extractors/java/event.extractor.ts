import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, extractStringValue } from '../../utils/ast-helpers';
import { nodeId, resourceId } from '../../utils/id';
import { escapeRegex } from '../../utils/regex';
import type { EventNode, BrokerNode } from '../../types/topology';

export interface JavaEventExtractionResult {
  eventNodes: EventNode[];
  brokers: BrokerNode[];
}

/** Spring ApplicationEventPublisher.publishEvent(event) */
const SPRING_PUBLISHER_RE = /publisher|eventPublisher|applicationEventPublisher/i;

/** Kafka KafkaTemplate.send(topic, message) */
const KAFKA_TEMPLATE_RE = /kafkaTemplate|kafkaSender/i;

/** RabbitMQ RabbitTemplate.convertAndSend / rabbitTemplate */
const RABBIT_TEMPLATE_RE = /rabbitTemplate|amqpTemplate/i;

export function extractJavaEvents(
  rootNode: SyntaxNode,
  filePath: string,
  serviceId: string,
): JavaEventExtractionResult {
  const eventNodes: EventNode[] = [];
  const brokersMap = new Map<string, BrokerNode>();

  for (const call of findAll(rootNode, 'method_invocation')) {
    const methodName = call.childForFieldName('name')?.text ?? '';
    const objectNode = call.childForFieldName('object');
    if (!objectNode) continue;

    const obj = objectNode.text;
    const args = call.childForFieldName('arguments');

    // Spring Events: publisher.publishEvent(new UserCreatedEvent())
    if (SPRING_PUBLISHER_RE.test(obj) && methodName === 'publishEvent') {
      const firstArg = args?.namedChildren[0];
      const eventName = extractEventName(firstArg) ?? 'SpringEvent';
      const loc = toLocation(call, filePath);
      const id = nodeId('event', filePath, loc.line, `spring.publish:${eventName}`);
      eventNodes.push({
        id,
        type: 'event',
        name: eventName,
        location: loc,
        children: [],
        metadata: { kind: 'publish', eventName },
      });
      continue;
    }

    // Spring @EventListener annotated methods — detected via annotation scan below

    // Kafka: kafkaTemplate.send("topic", message)
    if (KAFKA_TEMPLATE_RE.test(obj) && methodName === 'send') {
      const firstArg = args?.namedChildren[0];
      const topicName = firstArg ? (extractStringValue(firstArg) ?? extractJavaString(firstArg) ?? firstArg.text) : 'unknown';
      ensureKafkaBroker(brokersMap, topicName, serviceId, 'producer');

      const loc = toLocation(call, filePath);
      const id = nodeId('event', filePath, loc.line, `kafka.send:${topicName}`);
      eventNodes.push({
        id,
        type: 'event',
        name: topicName,
        location: loc,
        children: [],
        metadata: { kind: 'publish', eventName: topicName, channel: 'kafka' },
      });
      continue;
    }

    // RabbitMQ: rabbitTemplate.convertAndSend(exchange, routingKey, message)
    if (RABBIT_TEMPLATE_RE.test(obj) &&
        (methodName === 'convertAndSend' || methodName === 'send')) {
      const firstArg = args?.namedChildren[0];
      const secondArg = args?.namedChildren[1];
      const exchange = firstArg ? (extractStringValue(firstArg) ?? 'exchange') : 'exchange';
      const routingKey = secondArg ? (extractStringValue(secondArg) ?? '') : '';
      const topicName = routingKey || exchange;

      ensureRabbitBroker(brokersMap, topicName, serviceId);

      const loc = toLocation(call, filePath);
      const id = nodeId('event', filePath, loc.line, `rabbitmq.send:${topicName}`);
      eventNodes.push({
        id,
        type: 'event',
        name: topicName,
        location: loc,
        children: [],
        metadata: { kind: 'publish', eventName: topicName, channel: 'rabbitmq' },
      });
    }
  }

  // Detect @KafkaListener(topics = "...") and @RabbitListener(queues = "...")
  for (const method of findAll(rootNode, 'method_declaration')) {
    const annotations = findAll(method, 'marker_annotation').concat(findAll(method, 'annotation'));

    for (const ann of annotations) {
      const annName = ann.childForFieldName('name')?.text ?? '';

      if (annName === 'KafkaListener') {
        const topicName = extractAnnotationAttr(ann, 'topics') ?? 'unknown';
        ensureKafkaBroker(brokersMap, topicName, serviceId, 'consumer');

        const loc = toLocation(method, filePath);
        const id = nodeId('event', filePath, loc.line, `kafka.listener:${topicName}`);
        eventNodes.push({
          id,
          type: 'event',
          name: topicName,
          location: loc,
          children: [],
          metadata: { kind: 'subscribe', eventName: topicName, channel: 'kafka' },
        });
      }

      if (annName === 'RabbitListener') {
        const queueName = extractAnnotationAttr(ann, 'queues') ?? 'unknown';
        ensureRabbitBroker(brokersMap, queueName, serviceId);

        const loc = toLocation(method, filePath);
        const id = nodeId('event', filePath, loc.line, `rabbitmq.listener:${queueName}`);
        eventNodes.push({
          id,
          type: 'event',
          name: queueName,
          location: loc,
          children: [],
          metadata: { kind: 'subscribe', eventName: queueName, channel: 'rabbitmq' },
        });
      }

      if (annName === 'EventListener') {
        const loc = toLocation(method, filePath);
        // Try to get the event class from method parameter
        const params = method.childForFieldName('parameters');
        const firstParam = params?.namedChildren[0];
        const paramType = firstParam?.childForFieldName('type')?.text ?? 'SpringEvent';

        const id = nodeId('event', filePath, loc.line, `spring.listener:${paramType}`);
        eventNodes.push({
          id,
          type: 'event',
          name: paramType,
          location: loc,
          children: [],
          metadata: { kind: 'subscribe', eventName: paramType },
        });
      }
    }
  }

  return { eventNodes, brokers: Array.from(brokersMap.values()) };
}

/** Strip quotes from Java string_literal nodes */
function extractJavaString(node: SyntaxNode): string | null {
  if (node.type === 'string_literal') {
    return node.text.replace(/^"|"$/g, '');
  }
  return null;
}

function extractEventName(node: SyntaxNode | undefined): string | null {
  if (!node) return null;
  // new UserCreatedEvent() → 'UserCreatedEvent'
  if (node.type === 'object_creation_expression') {
    return node.childForFieldName('type')?.text ?? null;
  }
  return extractStringValue(node) ?? node.text.split('(')[0] ?? null;
}

function extractAnnotationAttr(annotation: SyntaxNode, attr: string): string | null {
  const args = annotation.childForFieldName('arguments');
  if (!args) return null;
  const text = args.text;
  const re = new RegExp(`${escapeRegex(attr)}\\s*=\\s*["'{]([^"'}]+)["'}]`);
  const match = text.match(re);
  if (match) return match[1].trim();
  // Single string value
  const direct = text.match(/^["'{]([^"'}]+)["'}]$/);
  return direct ? direct[1].trim() : null;
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
      metadata: {
        engine: 'kafka',
        category: 'stream',
        managed: false,
        connectionAlias: 'kafka',
        topics: [],
      },
    });
  }
  const broker = map.get('kafka')!;
  let t = broker.metadata.topics.find(x => x.name === topic);
  if (!t) {
    t = { name: topic, kind: 'topic', producers: [], consumers: [] };
    broker.metadata.topics.push(t);
  }
  if (role === 'producer' && !t.producers.includes(serviceId)) t.producers.push(serviceId);
  if (role === 'consumer' && !t.consumers.includes(serviceId)) t.consumers.push(serviceId);
}

function ensureRabbitBroker(
  map: Map<string, BrokerNode>,
  queue: string,
  serviceId: string,
): void {
  if (!map.has('rabbitmq')) {
    map.set('rabbitmq', {
      id: resourceId('broker', 'rabbitmq'),
      type: 'broker',
      name: 'rabbitmq',
      metadata: {
        engine: 'rabbitmq',
        category: 'queue',
        managed: false,
        connectionAlias: 'rabbitmq',
        topics: [],
      },
    });
  }
  const broker = map.get('rabbitmq')!;
  if (!broker.metadata.topics.find(x => x.name === queue)) {
    broker.metadata.topics.push({
      name: queue,
      kind: 'queue',
      producers: [serviceId],
      consumers: [],
    });
  }
}
