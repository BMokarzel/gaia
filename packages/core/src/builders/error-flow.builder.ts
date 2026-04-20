import type {
  ErrorFlowMap, ErrorPath, ThrowNode, FlowControlNode,
  FunctionNode, ServiceNode, CodeNode,
} from '../types/topology';

/**
 * Constrói o ErrorFlowMap a partir dos ThrowNodes e catch blocks detectados.
 */
export function buildErrorFlowMap(services: ServiceNode[]): ErrorFlowMap {
  const paths: ErrorPath[] = [];
  const globalHandlers: ErrorFlowMap['globalHandlers'] = [];

  for (const service of services) {
    const allNodes: CodeNode[] = [
      ...service.endpoints,
      ...service.functions,
      ...service.globals,
    ];

    // Coleta todos os throws
    const throws = collectThrows(allNodes);

    // Coleta todos os catch blocks
    const catches = collectCatches(allNodes);

    // Para cada throw, tenta traçar o caminho de propagação
    for (const throwNode of throws) {
      const path = buildErrorPath(throwNode, catches, allNodes);
      if (path) paths.push(path);
    }

    // Detecta global error handlers (filtros de exceção globais no NestJS, middleware Express, etc.)
    const globalHandlerNodes = findGlobalHandlers(allNodes);
    for (const handler of globalHandlerNodes) {
      globalHandlers.push({
        nodeId: handler.id,
        catches: ['Error'], // Simplificado — captura tudo
        responseTemplate: detectErrorResponseTemplate(handler),
      });
    }
  }

  return { paths, globalHandlers };
}

function collectThrows(nodes: CodeNode[]): ThrowNode[] {
  const throws: ThrowNode[] = [];

  function walk(node: CodeNode): void {
    if (node.type === 'throw') throws.push(node as ThrowNode);
    for (const child of node.children) walk(child);
  }

  for (const node of nodes) walk(node);
  return throws;
}

function collectCatches(nodes: CodeNode[]): FlowControlNode[] {
  const catches: FlowControlNode[] = [];

  function walk(node: CodeNode): void {
    if (node.type === 'flowControl') {
      const fc = node as FlowControlNode;
      if (fc.metadata.kind === 'catch') catches.push(fc);
    }
    for (const child of node.children) walk(child);
  }

  for (const node of nodes) walk(node);
  return catches;
}

function buildErrorPath(
  throwNode: ThrowNode,
  catches: FlowControlNode[],
  allNodes: CodeNode[],
): ErrorPath | null {
  const errorClass = throwNode.metadata.errorClass;

  // Encontra o catch mais próximo pelo arquivo e linha
  const relevantCatch = catches.find(c =>
    c.location.file === throwNode.location.file &&
    c.location.line > throwNode.location.line
  );

  const resolution: ErrorPath['resolution'] = relevantCatch
    ? { kind: 'handled', handlerNodeId: relevantCatch.id, httpStatus: throwNode.metadata.httpStatus }
    : { kind: 'unhandled', httpStatus: throwNode.metadata.httpStatus };

  return {
    origin: {
      nodeId: throwNode.id,
      errorClass,
      context: throwNode.location.file,
    },
    propagation: [],
    resolution,
  };
}

function findGlobalHandlers(nodes: CodeNode[]): CodeNode[] {
  // Detecta: ExceptionFilter (NestJS), error middleware Express (4 params),
  // @ControllerAdvice (Spring), etc.
  return nodes.filter(n => {
    if (n.type === 'function') {
      const fn = n as FunctionNode;
      // NestJS ExceptionFilter decorator
      if (fn.metadata.decorators?.some(d => /ExceptionFilter|Catch/i.test(d))) return true;
      // Express error middleware: (err, req, res, next)
      if (fn.metadata.params.length === 4 &&
          fn.metadata.params[0]?.name?.match(/^err/i)) return true;
    }
    return false;
  });
}

function detectErrorResponseTemplate(
  handler: CodeNode,
): ErrorFlowMap['globalHandlers'][0]['responseTemplate'] | undefined {
  // Tenta inferir o status code do handler a partir do raw ou metadata
  const raw = (handler as any).raw ?? '';
  const statusMatch = raw.match(/status\((\d{3})\)/);
  if (statusMatch) {
    return { httpStatus: parseInt(statusMatch[1], 10) };
  }
  return { httpStatus: 500 };
}
