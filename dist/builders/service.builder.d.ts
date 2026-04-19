import type { ServiceBoundary } from '../core/walker';
import type { ServiceTechStack } from '../core/detector';
import type { ServiceNode, CodeNode } from '../types/topology';
/**
 * Constrói um ServiceNode a partir da boundary detectada e da stack técnica.
 * Campos que dependem de informações externas ficam undefined — serão preenchidos
 * por outras ferramentas futuramente.
 */
export declare function buildServiceNode(boundary: ServiceBoundary, stack: ServiceTechStack, codeNodes: CodeNode[]): ServiceNode;
//# sourceMappingURL=service.builder.d.ts.map