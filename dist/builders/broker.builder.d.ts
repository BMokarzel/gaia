import type { BrokerNode } from '../types/topology';
/**
 * Merge de múltiplos BrokerNodes com o mesmo alias/engine.
 * Consolida tópicos descobertos de múltiplos arquivos.
 */
export declare function mergeBrokers(brokers: BrokerNode[]): BrokerNode[];
export declare function buildBrokerFromHint(alias: string, engine: string): BrokerNode;
//# sourceMappingURL=broker.builder.d.ts.map