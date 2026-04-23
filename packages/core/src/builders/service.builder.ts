import { basename } from 'path';
import type { ServiceBoundary } from '../core/walker';
import type { ServiceTechStack } from '../core/detector';
import type { ServiceNode, EndpointNode, FunctionNode, DataNode, CodeNode, FlowControlNode } from '../types/topology';
import { serviceId } from '../utils/id';
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
  // Second pass: nest nodes into their parent flowControl (loops, if) by line range
  for (const fn of functions) nestIntoFlowControls(fn.children);
  for (const ep of endpoints) nestIntoFlowControls(ep.children);
  // Third pass: sort every children array by source line so the flow order is correct
  for (const fn of functions) sortChildrenByLine(fn.children);
  for (const ep of endpoints) sortChildrenByLine(ep.children);
  for (const fn of functions) computeFunctionMetrics(fn);

  // Link each endpoint to its handler FunctionNode and populate endpoint.children
  linkEndpointHandlers(endpoints, functions);

  return {
    id,
    type: 'service',
    name,
    code: toKebabCase(name),
    metadata: {
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
 * Recursively sorts a children array by source line number so that nodes
 * appear in the same order as in the original source file, regardless of
 * the order in which extractors emitted them.
 */
function sortChildrenByLine(nodes: CodeNode[]): void {
  nodes.sort((a, b) => a.location.line - b.location.line);
  for (const n of nodes) {
    if (n.children.length > 0) sortChildrenByLine(n.children);
  }
}

/**
 * Links each EndpointNode to its handler FunctionNode.
 *
 * For NestJS (and similar frameworks) the extractor emits a FunctionNode whose
 * name matches the endpoint name exactly ("ControllerClass.methodName").
 * We set endpoint.metadata.handlerFnId and, when the endpoint has no children
 * of its own yet, copy the handler's children so the endpoint owns its flow.
 */
function linkEndpointHandlers(
  endpoints: EndpointNode[],
  functions: FunctionNode[],
): void {
  for (const ep of endpoints) {
    // Match by exact name (NestJS: "UserController.getUsers")
    // or by suffix (Go: endpoint name "CreateOrder" matches fn "OrderHandler.CreateOrder")
    const epBaseName = ep.name.split('.').pop()!;
    const handler = functions.find(fn =>
      fn.name === ep.name || fn.name.split('.').pop() === epBaseName
    );
    if (!handler) continue;

    ep.metadata.handlerFnId = handler.id;

    // Populate endpoint.children from the handler when the endpoint body is empty,
    // OR when existing children contain no meaningful flow content (e.g. Go endpoints
    // where only the route-registration call ended up as a child).
    const hasMeaningfulChildren = ep.children.some(c =>
      c.type === 'flowControl' || c.type === 'return' || c.type === 'throw' ||
      c.type === 'dbProcess' || c.type === 'externalCall'
    );
    if (!hasMeaningfulChildren && handler.children.length > 0) {
      ep.children = [...handler.children];
    }
  }
}

/**
 * Second-pass nesting: within a list of CodeNodes that already belong to a
 * function, recursively move nodes into the smallest flowControl (loop, if,
 * try…) that contains them by line range. Mutates the array in place.
 */
function nestIntoFlowControls(nodes: CodeNode[]): void {
  const flowNodes = nodes.filter((n): n is FlowControlNode => n.type === 'flowControl');
  if (flowNodes.length === 0) return;

  const toRemove = new Set<CodeNode>();

  for (const node of nodes) {
    let best: FlowControlNode | null = null;
    let bestSpan = Infinity;

    for (const fc of flowNodes) {
      if (fc === node) continue;   // don't nest a flowControl into itself
      const fl = fc.location;
      const nl = node.location;
      if (!fl.endLine) continue;
      if (nl.file === fl.file &&
          (nl.line > fl.line || (nl.line === fl.line && (nl.column ?? 0) > (fl.column ?? 0))) &&
          nl.line <= fl.endLine) {
        const span = fl.endLine - fl.line;
        if (span < bestSpan) { bestSpan = span; best = fc; }
      }
    }

    if (best) {
      best.children.push(node);
      toRemove.add(node);
    }
  }

  // Remove newly-nested nodes from this level
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (toRemove.has(nodes[i])) nodes.splice(i, 1);
  }

  // Recurse so nodes inside a nested flowControl get further nested
  for (const fc of flowNodes) {
    if (fc.children.length > 0) nestIntoFlowControls(fc.children);
  }
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
