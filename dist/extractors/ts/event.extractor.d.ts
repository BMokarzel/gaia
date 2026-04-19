import type { SyntaxNode } from '../../utils/ast-helpers';
import type { EventNode, BrokerNode } from '../../types/topology';
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
export declare function extractEvents(rootNode: SyntaxNode, filePath: string, serviceId: string): EventExtractionResult;
//# sourceMappingURL=event.extractor.d.ts.map