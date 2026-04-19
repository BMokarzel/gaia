import type { Edge, ServiceNode, DatabaseNode, BrokerNode } from '../types/topology';
/**
 * Constrói edges a partir dos nós extraídos.
 * Conecta: endpoints → functions → dbProcesses → databases
 *          functions → events → brokers
 *          services → databases / brokers (ServiceDependency)
 */
export declare function buildEdges(services: ServiceNode[], databases: DatabaseNode[], brokers: BrokerNode[]): Edge[];
//# sourceMappingURL=edge.builder.d.ts.map