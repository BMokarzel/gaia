import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, memberChain } from '../../utils/ast-helpers';
import { nodeId, resourceId } from '../../utils/id';
import type { EventNode, BrokerNode, BrokerTopic } from '../../types/topology';

export interface GoEventResult {
  eventNodes: EventNode[];
  brokers: BrokerNode[];
}

export function extractGoEvents(
  rootNode: SyntaxNode,
  filePath: string,
  serviceId: string,
): GoEventResult {
  const eventNodes: EventNode[] = [];
  const brokersMap = new Map<string, BrokerNode>();

  for (const call of findAll(rootNode, 'call_expression')) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    const chain = fn.type === 'selector_expression' ? memberChain(fn) : [fn.text];
    if (chain.length < 2) continue;

    const obj = chain.slice(0, -1).join('.');
    const method = chain[chain.length - 1];
    const args = call.childForFieldName('arguments');
    const argsText = args?.text ?? '';

    // Kafka via Sarama: producer.SendMessage(&sarama.ProducerMessage{Topic: "..."})
    if (/producer/i.test(obj) && method === 'SendMessage') {
      const topicMatch = argsText.match(/Topic\s*:\s*["'`]([^"'`]+)["'`]/);
      const topic = topicMatch ? topicMatch[1] : 'unknown';
      const node = buildEventNode(call, filePath, topic, 'publish', 'kafka');
      if (node) {
        eventNodes.push(node);
        ensureBroker(brokersMap, 'kafka', topic, 'kafka', 'stream', serviceId, 'producer');
      }
      continue;
    }

    // Kafka via kafka-go: writer.WriteMessages(ctx, kafka.Message{...})
    if (/writer/i.test(obj) && method === 'WriteMessages') {
      const topicMatch = argsText.match(/Topic\s*:\s*["'`]([^"'`]+)["'`]/);
      const topic = topicMatch ? topicMatch[1] : 'unknown';
      const node = buildEventNode(call, filePath, topic, 'publish', 'kafka');
      if (node) {
        eventNodes.push(node);
        ensureBroker(brokersMap, 'kafka', topic, 'kafka', 'stream', serviceId, 'producer');
      }
      continue;
    }

    // Kafka consumer: reader.FetchMessage / reader.ReadMessage
    if (/reader|consumer/i.test(obj) && (method === 'ReadMessage' || method === 'FetchMessage')) {
      const topicMatch = argsText.match(/Topic\s*:\s*["'`]([^"'`]+)["'`]/);
      const topic = topicMatch ? topicMatch[1] : 'unknown';
      const node = buildEventNode(call, filePath, topic, 'subscribe', 'kafka');
      if (node) {
        eventNodes.push(node);
        ensureBroker(brokersMap, 'kafka', topic, 'kafka', 'stream', serviceId, 'consumer');
      }
      continue;
    }

    // NATS: nc.Publish("subject", data) / nc.Subscribe("subject", handler)
    if (/nc|nats|conn/i.test(obj)) {
      if (method === 'Publish' || method === 'PublishMsg') {
        const firstArg = args?.namedChildren[0];
        const topic = firstArg?.text.replace(/^["'`]|["'`]$/g, '') ?? 'unknown';
        const node = buildEventNode(call, filePath, topic, 'publish', 'nats');
        if (node) {
          eventNodes.push(node);
          ensureBroker(brokersMap, 'nats', topic, 'nats', 'pubsub', serviceId, 'producer');
        }
        continue;
      }
      if (method === 'Subscribe' || method === 'QueueSubscribe') {
        const firstArg = args?.namedChildren[0];
        const topic = firstArg?.text.replace(/^["'`]|["'`]$/g, '') ?? 'unknown';
        const node = buildEventNode(call, filePath, topic, 'subscribe', 'nats');
        if (node) {
          eventNodes.push(node);
          ensureBroker(brokersMap, 'nats', topic, 'nats', 'pubsub', serviceId, 'consumer');
        }
        continue;
      }
    }

    // RabbitMQ via amqp: ch.Publish(exchange, routingKey, ...) / ch.Consume(queue, ...)
    if (/ch|channel|amqp/i.test(obj)) {
      if (method === 'Publish' || method === 'PublishWithContext') {
        const firstArg = args?.namedChildren[0];
        const secondArg = args?.namedChildren[1];
        const exchange = firstArg?.text.replace(/^["'`]|["'`]$/g, '') ?? '';
        const key = secondArg?.text.replace(/^["'`]|["'`]$/g, '') ?? '';
        const topic = key || exchange || 'unknown';
        const node = buildEventNode(call, filePath, topic, 'publish', 'rabbitmq');
        if (node) {
          eventNodes.push(node);
          ensureBroker(brokersMap, 'rabbitmq', topic, 'rabbitmq', 'queue', serviceId, 'producer');
        }
        continue;
      }
      if (method === 'Consume') {
        const firstArg = args?.namedChildren[0];
        const topic = firstArg?.text.replace(/^["'`]|["'`]$/g, '') ?? 'unknown';
        const node = buildEventNode(call, filePath, topic, 'subscribe', 'rabbitmq');
        if (node) {
          eventNodes.push(node);
          ensureBroker(brokersMap, 'rabbitmq', topic, 'rabbitmq', 'queue', serviceId, 'consumer');
        }
        continue;
      }
    }
  }

  return { eventNodes, brokers: Array.from(brokersMap.values()) };
}

function buildEventNode(
  call: SyntaxNode, filePath: string,
  eventName: string, kind: EventNode['metadata']['kind'], channel: string,
): EventNode | null {
  if (!eventName || eventName === 'unknown') return null;
  const loc = toLocation(call, filePath);
  return {
    id: nodeId('event', filePath, loc.line, `${channel}.${kind}:${eventName}`),
    type: 'event', name: eventName,
    location: loc, children: [],
    metadata: { kind, eventName, channel },
  };
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
