import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, fieldText } from '../../utils/ast-helpers';
import { nodeId, resourceId } from '../../utils/id';
import type { EventNode, BrokerNode } from '../../types/topology';
import { escapeRegex } from '../../utils/prompt-sanitizer';

export interface JavaEventResult {
  eventNodes: EventNode[];
  brokers: BrokerNode[];
}

export function extractJavaEvents(
  rootNode: SyntaxNode,
  filePath: string,
  serviceId: string,
): JavaEventResult {
  const eventNodes: EventNode[] = [];
  const brokersMap = new Map<string, BrokerNode>();

  // ── Declarative consumers via annotations ──────────────────────────────────

  for (const method of findAll(rootNode, 'method_declaration')) {
    const annotations = findAll(method, 'marker_annotation').concat(findAll(method, 'annotation'));

    // @KafkaListener(topics = "my-topic") or @KafkaListener(topics = {"t1","t2"})
    const kafkaAnn = annotations.find(a => a.childForFieldName('name')?.text === 'KafkaListener');
    if (kafkaAnn) {
      const topics = extractAnnotationTopics(kafkaAnn, 'topics');
      for (const topic of topics) {
        const loc = toLocation(method, filePath);
        eventNodes.push(buildEventNode(method, filePath, topic, 'subscribe', 'kafka'));
        ensureBroker(brokersMap, 'kafka', topic, 'kafka', 'stream', serviceId, 'consumer');
      }
      continue;
    }

    // @RabbitListener(queues = "my-queue")
    const rabbitAnn = annotations.find(a => a.childForFieldName('name')?.text === 'RabbitListener');
    if (rabbitAnn) {
      const queues = extractAnnotationTopics(rabbitAnn, 'queues');
      for (const queue of queues) {
        eventNodes.push(buildEventNode(method, filePath, queue, 'subscribe', 'rabbitmq'));
        ensureBroker(brokersMap, 'rabbitmq', queue, 'rabbitmq', 'queue', serviceId, 'consumer');
      }
      continue;
    }

    // @EventListener — Spring ApplicationEvent consumer
    const springEventAnn = annotations.find(a =>
      a.childForFieldName('name')?.text === 'EventListener' ||
      a.childForFieldName('name')?.text === 'TransactionalEventListener'
    );
    if (springEventAnn) {
      const params = findAll(method, 'formal_parameter');
      const eventType = params[0]?.childForFieldName('type')?.text ?? 'ApplicationEvent';
      eventNodes.push(buildEventNode(method, filePath, eventType, 'on', 'spring-events'));
    }

    // @SqsListener("queue-name") — AWS SQS
    const sqsAnn = annotations.find(a => a.childForFieldName('name')?.text === 'SqsListener');
    if (sqsAnn) {
      const args = sqsAnn.childForFieldName('arguments');
      const firstArg = args?.namedChildren[0];
      const queue = firstArg?.text.replace(/^["']|["']$/g, '') ?? 'unknown';
      eventNodes.push(buildEventNode(method, filePath, queue, 'subscribe', 'sqs'));
      ensureBroker(brokersMap, 'sqs', queue, 'sqs', 'queue', serviceId, 'consumer');
    }
  }

  // ── Imperative producers via method calls ──────────────────────────────────

  for (const call of findAll(rootNode, 'method_invocation')) {
    const obj = call.childForFieldName('object');
    const method = call.childForFieldName('name')?.text ?? '';
    const objText = obj?.text ?? '';
    const args = call.childForFieldName('arguments');
    const argsText = args?.text ?? '';

    // kafkaTemplate.send("topic", payload) or kafkaTemplate.send("topic", key, payload)
    if (/kafkaTemplate|kafkaProducer/i.test(objText) && method === 'send') {
      const topicMatch = argsText.match(/["']([^"']+)["']/);
      const topic = topicMatch ? topicMatch[1] : 'unknown';
      eventNodes.push(buildEventNode(call, filePath, topic, 'publish', 'kafka'));
      ensureBroker(brokersMap, 'kafka', topic, 'kafka', 'stream', serviceId, 'producer');
      continue;
    }

    // rabbitTemplate.convertAndSend("exchange", "routingKey", payload)
    if (/rabbitTemplate|amqpTemplate/i.test(objText) &&
        (method === 'convertAndSend' || method === 'send')) {
      const firstMatch = argsText.match(/["']([^"']+)["']/);
      const secondMatch = argsText.match(/["'][^"']+["']\s*,\s*["']([^"']+)["']/);
      const topic = secondMatch ? secondMatch[1] : (firstMatch ? firstMatch[1] : 'unknown');
      eventNodes.push(buildEventNode(call, filePath, topic, 'publish', 'rabbitmq'));
      ensureBroker(brokersMap, 'rabbitmq', topic, 'rabbitmq', 'queue', serviceId, 'producer');
      continue;
    }

    // applicationEventPublisher.publishEvent(new UserCreatedEvent(...))
    if (/eventPublisher|applicationEventPublisher|publisher/i.test(objText) &&
        method === 'publishEvent') {
      const eventMatch = argsText.match(/new\s+([A-Z][a-zA-Z]+)\s*\(/);
      const eventType = eventMatch ? eventMatch[1] : 'ApplicationEvent';
      eventNodes.push(buildEventNode(call, filePath, eventType, 'dispatch', 'spring-events'));
      continue;
    }

    // sqsTemplate.send / sqsAsyncClient.sendMessage
    if (/sqs|sqsTemplate/i.test(objText) && (method === 'send' || method === 'sendMessage')) {
      const queueMatch = argsText.match(/["']([^"']+)["']/);
      const queue = queueMatch ? queueMatch[1] : 'unknown';
      eventNodes.push(buildEventNode(call, filePath, queue, 'publish', 'sqs'));
      ensureBroker(brokersMap, 'sqs', queue, 'sqs', 'queue', serviceId, 'producer');
      continue;
    }
  }

  return { eventNodes, brokers: Array.from(brokersMap.values()) };
}

function buildEventNode(
  node: SyntaxNode, filePath: string,
  eventName: string, kind: EventNode['metadata']['kind'], channel: string,
): EventNode {
  const loc = toLocation(node, filePath);
  return {
    id: nodeId('event', filePath, loc.line, `${channel}.${kind}:${eventName}`),
    type: 'event', name: eventName,
    location: loc, children: [],
    metadata: { kind, eventName, channel },
  };
}

function extractAnnotationTopics(ann: SyntaxNode, attr: string): string[] {
  const args = ann.childForFieldName('arguments');
  if (!args) return [];
  const text = args.text;
  // topics = {"t1","t2"} or topics = "t1"
  const arrayMatch = text.match(new RegExp(`${escapeRegex(attr)}\\s*=\\s*\\{([^}]+)\\}`));
  if (arrayMatch) {
    return [...arrayMatch[1].matchAll(/["']([^"']+)["']/g)].map(m => m[1]);
  }
  const singleMatch = text.match(new RegExp(`${escapeRegex(attr)}\\s*=\\s*["']([^"']+)["']`));
  return singleMatch ? [singleMatch[1]] : [];
}

function ensureBroker(
  map: Map<string, BrokerNode>, key: string, topicName: string,
  engine: BrokerNode['metadata']['engine'], category: BrokerNode['metadata']['category'],
  serviceId: string, role: 'producer' | 'consumer',
): void {
  if (!map.has(key)) {
    map.set(key, {
      id: resourceId('broker', key),
      type: 'broker', name: key,
      metadata: { engine, category, managed: false, connectionAlias: key, topics: [] },
    });
  }
  const broker = map.get(key)!;
  let topic = broker.metadata.topics.find(t => t.name === topicName);
  if (!topic) {
    topic = { name: topicName, kind: category === 'stream' ? 'topic' : 'queue', producers: [], consumers: [] };
    broker.metadata.topics.push(topic);
  }
  if (role === 'producer' && !topic.producers.includes(serviceId)) topic.producers.push(serviceId);
  if (role === 'consumer' && !topic.consumers.includes(serviceId)) topic.consumers.push(serviceId);
}
