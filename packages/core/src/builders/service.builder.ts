import { basename } from 'path';
import type { ServiceBoundary } from '../core/walker';
import type { ServiceTechStack } from '../core/detector';
import type { ServiceNode, EndpointNode, FunctionNode, DataNode, CodeNode } from '../types/topology';
import { serviceId, makeId } from '../utils/id';
import { computeFunctionMetrics } from '../analysis/metrics';

/**
 * Constrói um ServiceNode a partir da boundary detectada e da stack técnica.
 * Campos que dependem de informações externas ficam undefined — serão preenchidos
 * por outras ferramentas futuramente.
 */
export function buildServiceNode(
  boundary: ServiceBoundary,
  stack: ServiceTechStack,
  codeNodes: CodeNode[],
): ServiceNode {
  const id = serviceId(boundary.rootPath);
  const name = boundary.name;

  const endpoints = codeNodes.filter((n): n is EndpointNode => n.type === 'endpoint');
  const functions = codeNodes.filter((n): n is FunctionNode => n.type === 'function');
  const globals = codeNodes.filter((n): n is DataNode =>
    n.type === 'data' && (n.metadata.scope === 'module' || n.metadata.scope === 'global')
  );

  nestChildrenIntoFunctions(functions, endpoints, codeNodes);
  for (const fn of functions) computeFunctionMetrics(fn);

  return {
    id,
    type: 'service',
    name,
    metadata: {
      code: toKebabCase(name),
      fullName: name,
      runtime: stack.runtime,
      language: stack.language,
      framework: stack.framework !== 'unknown' ? stack.framework : undefined,
      protocol: detectProtocol(stack, endpoints),
      kind: detectServiceKind(stack, endpoints),
    },
    endpoints,
    functions,
    globals,
    dependencies: [],
  };
}

/**
 * Aninha nós filhos (flowControl, return, throw, call, data local, etc.)
 * dentro da função/endpoint de menor span que os contém por range de linhas.
 */
function nestChildrenIntoFunctions(
  functions: FunctionNode[],
  endpoints: EndpointNode[],
  codeNodes: CodeNode[],
): void {
  const containers: Array<FunctionNode | EndpointNode> = [...functions, ...endpoints];

  for (const node of codeNodes) {
    if (node.type === 'function' || node.type === 'endpoint') continue;

    // Variáveis de módulo/global já vão para ServiceNode.globals — não aninhar
    if (
      node.type === 'data' &&
      ((node as DataNode).metadata.scope === 'module' ||
       (node as DataNode).metadata.scope === 'global')
    ) continue;

    const nl = node.location;
    let best: (FunctionNode | EndpointNode) | null = null;
    let bestSpan = Infinity;

    for (const container of containers) {
      const cl = container.location;
      if (!cl.endLine) continue;
      if (nl.file === cl.file && nl.line >= cl.line && nl.line <= cl.endLine) {
        const span = cl.endLine - cl.line;
        if (span < bestSpan) {
          bestSpan = span;
          best = container;
        }
      }
    }

    if (best) {
      best.children.push(node);
    }
  }
}

function detectProtocol(stack: ServiceTechStack, endpoints: EndpointNode[]): ServiceNode['metadata']['protocol'] {
  if (stack.hasGraphQL) return 'graphql';
  if (stack.hasGRPC) return 'grpc';
  if (endpoints.length > 0) return 'rest';
  if (stack.hasBroker) return 'event-driven';
  return 'rest';
}

function detectServiceKind(stack: ServiceTechStack, endpoints: EndpointNode[]): ServiceNode['metadata']['kind'] {
  if (endpoints.length === 0 && stack.hasBroker) return 'worker';
  if (stack.framework === 'next' || stack.framework === 'nuxt' || stack.framework === 'remix') return 'bff';
  return 'backend';
}

function toKebabCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');
}
