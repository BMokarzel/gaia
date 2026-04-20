import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId, resourceId } from '../../utils/id';
import type { EventNode, BrokerNode } from '../../types/topology';
import { escapeRegex } from '../../utils/prompt-sanitizer';

export interface KotlinEventResult {
  eventNodes: EventNode[];
  brokers: BrokerNode[];
}

// Kotlin Spring uses same patterns as Java — reuse Java extractor logic
// with Kotlin-specific AST node types (function_declaration vs method_declaration)

export function extractKotlinEvents(
  rootNode: SyntaxNode,
  filePath: string,
  serviceId: string,
): KotlinEventResult {
  const eventNodes: EventNode[] = [];
  const brokersMap = new Map<string, BrokerNode>();

  // ── Declarative consumers (annotations on fun declarations) ───────────────

  for (const fn of findAll(rootNode, 'function_declaration')) {
    const annotations = findAll(fn, 'annotation');

    const kafkaAnn = annotations.find(a => /KafkaListener/.test(a.text));
    if (kafkaAnn) {
      const topics = extractAnnotationTopics(kafkaAnn, 'topics');
      for (const topic of topics) {
        eventNodes.push(buildEvent(fn, filePath, topic, 'subscribe', 'kafka'));
        ensureBroker(brokersMap, 'kafka', topic, 'kafka', 'stream', serviceId, 'consumer');
      }
      continue;
    }

    const rabbitAnn = annotations.find(a => /RabbitListener/.test(a.text));
    if (rabbitAnn) {
      const queues = extractAnnotationTopics(rabbitAnn, 'queues');
      for (const queue of queues) {
        eventNodes.push(buildEvent(fn, filePath, queue, 'subscribe', 'rabbitmq'));
        ensureBroker(brokersMap, 'rabbitmq', queue, 'rabbitmq', 'queue', serviceId, 'consumer');
      }
      continue;
    }

    const springEventAnn = annotations.find(a =>
      /EventListener|TransactionalEventListener/.test(a.text)
    );
    if (springEventAnn) {
      const params = findAll(fn, 'function_value_parameter');
      const eventType = params[0]
        ?.childForFieldName('parameter')
        ?.childForFieldName('type')?.text ?? 'ApplicationEvent';
      eventNodes.push(buildEvent(fn, filePath, eventType, 'on', 'spring-events'));
    }
  }

  // ── Imperative producers (call expressions) ───────────────────────────────

  for (const call of findAll(rootNode, 'call_expression')) {
    const nav = call.childForFieldName('navigation_expression')
      ?? call.children.find(c => c.type === 'navigation_expression');
    if (!nav) continue;

    const navText = nav.text;
    const parts = navText.split('.');
    const method = parts[parts.length - 1];
    const obj = parts.slice(0, -1).join('.');
    const argsNode = call.childForFieldName('value_arguments')
      ?? call.children.find(c => c.type === 'value_arguments');
    const argsText = argsNode?.text ?? '';

    if (/kafkaTemplate|kafkaProducer/i.test(obj) && method === 'send') {
      const topicMatch = argsText.match(/["']([^"']+)["']/);
      const topic = topicMatch ? topicMatch[1] : 'unknown';
      eventNodes.push(buildEvent(call, filePath, topic, 'publish', 'kafka'));
      ensureBroker(brokersMap, 'kafka', topic, 'kafka', 'stream', serviceId, 'producer');
      continue;
    }

    if (/rabbitTemplate|amqpTemplate/i.test(obj) &&
        (method === 'convertAndSend' || method === 'send')) {
      const matches = [...argsText.matchAll(/["']([^"']+)["']/g)];
      const topic = matches.length > 1 ? matches[1][1] : (matches[0]?.[1] ?? 'unknown');
      eventNodes.push(buildEvent(call, filePath, topic, 'publish', 'rabbitmq'));
      ensureBroker(brokersMap, 'rabbitmq', topic, 'rabbitmq', 'queue', serviceId, 'producer');
      continue;
    }

    if (/eventPublisher|applicationEventPublisher|publisher/i.test(obj) &&
        method === 'publishEvent') {
      const eventMatch = argsText.match(/([A-Z][a-zA-Z]+)\s*\(/);
      const eventType = eventMatch ? eventMatch[1] : 'ApplicationEvent';
      eventNodes.push(buildEvent(call, filePath, eventType, 'dispatch', 'spring-events'));
      continue;
    }
  }

  return { eventNodes, brokers: Array.from(brokersMap.values()) };
}

function buildEvent(
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
  const text = ann.text;
  const arrayMatch = text.match(new RegExp(`${escapeRegex(attr)}\\s*=\\s*(?:arrayOf\\s*\\(|\\[)([^)\\]]+)`));
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
