import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId, resourceId } from '../../utils/id';
import type { EventNode, BrokerNode } from '../../types/topology';

export interface PythonEventResult {
  eventNodes: EventNode[];
  brokers: BrokerNode[];
}

export function extractPythonEvents(
  rootNode: SyntaxNode,
  filePath: string,
  serviceId: string,
): PythonEventResult {
  const eventNodes: EventNode[] = [];
  const brokersMap = new Map<string, BrokerNode>();

  // ── Celery tasks (declarative) ─────────────────────────────────────────────

  for (const funcDef of findAll(rootNode, 'function_definition')) {
    const parent = funcDef.parent;
    if (!parent || parent.type !== 'decorated_definition') continue;

    const decorators = parent.children.filter(c => c.type === 'decorator');
    for (const dec of decorators) {
      const text = dec.text;
      // @app.task, @celery.task, @shared_task, @app.task(name="...")
      if (!/@(\w+\.)?task\b|@shared_task/.test(text)) continue;

      const nameNode = funcDef.childForFieldName('name');
      const taskName = nameNode?.text ?? 'task';

      // Named task: @app.task(name="my.task")
      const namedMatch = text.match(/name\s*=\s*["']([^"']+)["']/);
      const eventName = namedMatch ? namedMatch[1] : taskName;

      const loc = toLocation(funcDef, filePath);
      eventNodes.push({
        id: nodeId('event', filePath, loc.line, `celery.consumer:${eventName}`),
        type: 'event', name: eventName,
        location: loc, children: [],
        metadata: { kind: 'subscribe', eventName, channel: 'celery' },
      });
      ensureBroker(brokersMap, 'celery', eventName, 'rabbitmq', 'queue', serviceId, 'consumer');
    }
  }

  // ── Imperative producers and consumers ────────────────────────────────────

  for (const call of findAll(rootNode, 'call')) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    let objText = '';
    let method = '';

    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object');
      const attr = fn.childForFieldName('attribute');
      if (!obj || !attr) continue;
      objText = obj.text;
      method = attr.text;
    } else {
      continue;
    }

    const args = call.childForFieldName('arguments');
    const argsText = args?.text ?? '';

    // Celery task.delay(args) / task.apply_async(args, kwargs)
    if (method === 'delay' || method === 'apply_async' || method === 's') {
      // Heuristic: the object is a task reference
      if (!/^[A-Z]|task|Task/.test(objText) && !/\.(delay|apply_async)$/.test(objText)) continue;
      const eventName = objText.split('.').pop() ?? objText;
      const loc = toLocation(call, filePath);
      eventNodes.push({
        id: nodeId('event', filePath, loc.line, `celery.emit:${eventName}`),
        type: 'event', name: eventName,
        location: loc, children: [],
        metadata: { kind: 'emit', eventName, channel: 'celery' },
      });
      ensureBroker(brokersMap, 'celery', eventName, 'rabbitmq', 'queue', serviceId, 'producer');
      continue;
    }

    // pika: channel.basic_publish(exchange=..., routing_key=..., body=...)
    if (/channel|ch/i.test(objText) && method === 'basic_publish') {
      const exchangeMatch = argsText.match(/exchange\s*=\s*["']([^"']*)["']/);
      const keyMatch = argsText.match(/routing_key\s*=\s*["']([^"']+)["']/);
      const topic = keyMatch ? keyMatch[1] : (exchangeMatch ? exchangeMatch[1] : 'unknown');
      const loc = toLocation(call, filePath);
      eventNodes.push({
        id: nodeId('event', filePath, loc.line, `rabbitmq.publish:${topic}`),
        type: 'event', name: topic,
        location: loc, children: [],
        metadata: { kind: 'publish', eventName: topic, channel: 'rabbitmq' },
      });
      ensureBroker(brokersMap, 'rabbitmq', topic, 'rabbitmq', 'queue', serviceId, 'producer');
      continue;
    }

    // pika: channel.basic_consume(queue=..., on_message_callback=...)
    if (/channel|ch/i.test(objText) && method === 'basic_consume') {
      const queueMatch = argsText.match(/queue\s*=\s*["']([^"']+)["']/);
      const topic = queueMatch ? queueMatch[1] : 'unknown';
      const loc = toLocation(call, filePath);
      eventNodes.push({
        id: nodeId('event', filePath, loc.line, `rabbitmq.subscribe:${topic}`),
        type: 'event', name: topic,
        location: loc, children: [],
        metadata: { kind: 'subscribe', eventName: topic, channel: 'rabbitmq' },
      });
      ensureBroker(brokersMap, 'rabbitmq', topic, 'rabbitmq', 'queue', serviceId, 'consumer');
      continue;
    }

    // kafka-python: producer.send("topic", value=...)
    if (/producer/i.test(objText) && method === 'send') {
      const firstArg = args?.namedChildren[0];
      const topic = firstArg?.text.replace(/^["']|["']$/g, '') ?? 'unknown';
      const loc = toLocation(call, filePath);
      eventNodes.push({
        id: nodeId('event', filePath, loc.line, `kafka.publish:${topic}`),
        type: 'event', name: topic,
        location: loc, children: [],
        metadata: { kind: 'publish', eventName: topic, channel: 'kafka' },
      });
      ensureBroker(brokersMap, 'kafka', topic, 'kafka', 'stream', serviceId, 'producer');
      continue;
    }

    // confluent-kafka / kafka-python consumer: consumer.subscribe(["topic"])
    if (/consumer/i.test(objText) && method === 'subscribe') {
      const topicMatch = argsText.match(/["']([^"']+)["']/);
      const topic = topicMatch ? topicMatch[1] : 'unknown';
      const loc = toLocation(call, filePath);
      eventNodes.push({
        id: nodeId('event', filePath, loc.line, `kafka.subscribe:${topic}`),
        type: 'event', name: topic,
        location: loc, children: [],
        metadata: { kind: 'subscribe', eventName: topic, channel: 'kafka' },
      });
      ensureBroker(brokersMap, 'kafka', topic, 'kafka', 'stream', serviceId, 'consumer');
      continue;
    }

    // boto3 SQS: sqs.send_message(QueueUrl=..., MessageBody=...)
    if (/sqs/i.test(objText) && method === 'send_message') {
      const queueMatch = argsText.match(/QueueUrl\s*=\s*["']([^"']+)["']/);
      const topic = queueMatch ? queueMatch[1].split('/').pop() ?? 'unknown' : 'unknown';
      const loc = toLocation(call, filePath);
      eventNodes.push({
        id: nodeId('event', filePath, loc.line, `sqs.publish:${topic}`),
        type: 'event', name: topic,
        location: loc, children: [],
        metadata: { kind: 'publish', eventName: topic, channel: 'sqs' },
      });
      ensureBroker(brokersMap, 'sqs', topic, 'sqs', 'queue', serviceId, 'producer');
      continue;
    }

    // boto3 SNS: sns.publish(TopicArn=..., Message=...)
    if (/sns/i.test(objText) && method === 'publish') {
      const topicMatch = argsText.match(/TopicArn\s*=\s*["']([^"':]+):([^"']+)["']/);
      const topic = topicMatch ? topicMatch[2] : 'unknown';
      const loc = toLocation(call, filePath);
      eventNodes.push({
        id: nodeId('event', filePath, loc.line, `sns.publish:${topic}`),
        type: 'event', name: topic,
        location: loc, children: [],
        metadata: { kind: 'publish', eventName: topic, channel: 'sns' },
      });
      ensureBroker(brokersMap, 'sns', topic, 'sns', 'pubsub', serviceId, 'producer');
      continue;
    }
  }

  return { eventNodes, brokers: Array.from(brokersMap.values()) };
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
