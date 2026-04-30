/**
 * topology-projection — bridge entre @topology/code-graph (ElementGraph)
 * e o SystemTopology consumido pelo Gaia (CodeNode[]).
 *
 * Pipeline:
 *   1. `buildServiceFlowGraph(files)` — roda o code-graph sobre os arquivos
 *      do serviço e devolve o ElementGraph já com resolvers aplicados.
 *   2. `findEndpointElement(graph, endpoint)` — localiza o `method` element
 *      correspondente a um EndpointNode existente, casando por
 *      (file, startLine, baseName).
 *   3. `projectEndpointFlow(graph, elementId)` — constrói a FlowTree e
 *      projeta para `CodeNode[]` compatível com o `EndpointNode.children`.
 *
 * Mapeamento ElementKind → CodeNodeType:
 *   method/function/constructor/arrow_function → "function"
 *   branch / branch_then / branch_else / loop / try_block → "flowControl"
 *   call_site → "call" (com `metadata.resolvedTo` quando resolvido)
 *   return_site → "return"
 *   throw_site → "throw"
 *   assign_site → "data"
 *   await_site → colapsa: usa o filho call_site se houver
 */

import {
  buildGraph,
  buildFlowTree,
  type ElementGraph,
  type Element,
  type SourceFile as CGSourceFile,
  type FlowNode,
  type CallSiteMeta,
  type ReturnSiteMeta,
  type ThrowSiteMeta,
  type AssignSiteMeta,
  type BranchMeta,
  type LoopMeta,
  type BehavioralMeta,
} from '@topology/code-graph';

import type { SourceFile as CoreSourceFile } from '../core/walker';
import type {
  CodeNode, EndpointNode,
  FunctionNode, CallNode, FlowControlNode,
  ReturnNode, ThrowNode, DataNode, ProcessNode,
  SourceLocation,
} from '../types/topology';
import { nodeId } from '../utils/id';

/**
 * Constrói o ElementGraph para os arquivos de um serviço, reusando o
 * walker e os resolvers do `@topology/code-graph`.
 */
export function buildServiceFlowGraph(
  files: CoreSourceFile[],
  rootDir?: string,
): ElementGraph {
  const cgFiles: CGSourceFile[] = files.map(f => ({
    path: f.relativePath,
    content: f.content,
    extension: f.extension,
    language: f.language,
  }));
  const { graph } = buildGraph(cgFiles, { rootDir, continueOnFileError: true });
  return graph;
}

/**
 * Localiza o `method`/`function` element no grafo correspondente a um
 * EndpointNode. Casamento por (file, startLine, baseName).
 *
 * O `endpoint.location` aponta para a linha do método (NestJS: linha do
 * `@Get`/`@Post`); o code-graph emite `method.location.startLine` apontando
 * para a mesma linha do decorator. Quando isso não bate exatamente, o
 * fallback olha o range — element cujo `startLine <= ep.line <= endLine`.
 */
export function findEndpointElement(
  graph: ElementGraph,
  endpoint: EndpointNode,
): Element | null {
  const epFile = endpoint.location.file;
  const epLine = endpoint.location.line;
  const baseName = endpoint.name.split('.').pop() ?? endpoint.name;

  // Tentativa 1: nome exato + arquivo bate, em method ou function
  const candidates: Element[] = [];
  for (const kind of ['method', 'function', 'arrow_function'] as const) {
    for (const el of graph.getElementsByKind(kind)) {
      if (el.location.file !== epFile) continue;
      if (el.name !== baseName) continue;
      candidates.push(el);
    }
  }

  if (candidates.length === 1) return candidates[0];

  if (candidates.length > 1) {
    // Pega o que mais se aproxima da linha do endpoint
    candidates.sort((a, b) =>
      Math.abs(a.location.startLine - epLine) - Math.abs(b.location.startLine - epLine),
    );
    return candidates[0];
  }

  // Fallback: qualquer method/function cujo range cubra a linha do endpoint
  let best: Element | null = null;
  let bestSpan = Infinity;
  for (const kind of ['method', 'function', 'arrow_function'] as const) {
    for (const el of graph.getElementsByKind(kind)) {
      if (el.location.file !== epFile) continue;
      if (epLine < el.location.startLine || epLine > el.location.endLine) continue;
      const span = el.location.endLine - el.location.startLine;
      if (span < bestSpan) { bestSpan = span; best = el; }
    }
  }
  return best;
}

/**
 * Projeta a FlowTree de um element no grafo para `CodeNode[]` que pode
 * ser usado como `EndpointNode.children` no SystemTopology.
 */
export function projectEndpointFlow(
  graph: ElementGraph,
  elementId: string,
  options: { maxDepth?: number } = {},
): CodeNode[] {
  const tree = buildFlowTree(elementId, graph, { maxDepth: options.maxDepth ?? 24 });
  // A raiz é o método em si — queremos só os filhos como `endpoint.children`.
  return flattenChildren(tree.root.children, graph);
}

// ──────────────────────────────────────────────────────────────────────────
// Mapeamento FlowNode → CodeNode
// ──────────────────────────────────────────────────────────────────────────

function mapFlowNode(node: FlowNode, graph: ElementGraph): CodeNode | null {
  const el = node.element;
  switch (el.kind) {
    case 'method':
    case 'function':
    case 'constructor':
    case 'arrow_function':
    case 'getter':
    case 'setter':
      return mapFunction(node, graph);

    case 'branch':
    case 'branch_then':
    case 'branch_else':
    case 'loop':
    case 'try_block':
    case 'catch_block':
    case 'finally_block':
      return mapFlowControl(node, graph);

    case 'call_site':
      return mapCall(node, graph);

    case 'return_site':
      return mapReturn(node);

    case 'throw_site':
      return mapThrow(node);

    case 'assign_site':
      return mapAssign(node, graph);

    case 'await_site': {
      // Colapsa: se tem filho call_site, devolve ele direto; senão vira process
      const callChild = node.children.find(c => c.element.kind === 'call_site');
      if (callChild) return mapCall(callChild, graph);
      return mapProcess(node, 'await');
    }

    default:
      return null;
  }
}

function mapChildren(node: FlowNode, graph: ElementGraph): CodeNode[] {
  return flattenChildren(node.children, graph);
}

/**
 * Flatten "wrapper" FlowNodes that hold a single call_site child so the deep
 * call chain becomes visible as siblings instead of being hidden inside a
 * terminal node.
 *
 * Cases:
 *   - return_site wrapping call_site  → [<flattened call chain>, <return>]
 *   - throw_site  wrapping call_site  → [<flattened call chain>, <throw>]
 *   - assign_site wrapping call_site  → [<flattened call chain>]
 *       (the assignment is implicit; the call is what the reader needs to see)
 *   - await_site  wrapping call_site  → [<flattened call chain>]
 *       (await collapses into the call; isAwaited flag survives on the call)
 *   - anything else                   → mapFlowNode(child)
 *
 * Returning the call chain BEFORE the terminal preserves source order: the
 * call is evaluated first, then the return/throw fires.
 */
function flattenChildren(nodes: FlowNode[], graph: ElementGraph): CodeNode[] {
  const out: CodeNode[] = [];
  for (const child of nodes) {
    const k = child.element.kind;

    if (k === 'return_site') {
      const callChild = child.children.find(c => c.element.kind === 'call_site');
      if (callChild) out.push(...flattenChildren([callChild], graph));
      out.push(mapReturn(child));
      continue;
    }

    if (k === 'throw_site') {
      const callChild = child.children.find(c => c.element.kind === 'call_site');
      if (callChild) out.push(...flattenChildren([callChild], graph));
      out.push(mapThrow(child));
      continue;
    }

    if (k === 'assign_site') {
      const callChild = child.children.find(c => c.element.kind === 'call_site');
      if (callChild) {
        out.push(...flattenChildren([callChild], graph));
      } else {
        const m = mapAssign(child, graph);
        if (m) out.push(m);
      }
      continue;
    }

    if (k === 'await_site') {
      const callChild = child.children.find(c => c.element.kind === 'call_site');
      if (callChild) {
        out.push(...flattenChildren([callChild], graph));
      } else {
        const m = mapFlowNode(child, graph);
        if (m) out.push(m);
      }
      continue;
    }

    const mapped = mapFlowNode(child, graph);
    if (mapped) out.push(mapped);
  }
  return out;
}

function loc(el: Element): SourceLocation {
  return {
    file: el.location.file,
    line: el.location.startLine + 1,
    column: el.location.startCol,
    endLine: el.location.endLine + 1,
    endColumn: el.location.endCol,
  };
}

function mapFunction(node: FlowNode, graph: ElementGraph): FunctionNode {
  const el = node.element;
  const meta = el.meta as Partial<BehavioralMeta>;
  const id = nodeId('function', el.location.file, el.location.startLine, el.name ?? '');
  const fnKind: FunctionNode['metadata']['kind'] =
    el.kind === 'method' ? 'method'
    : el.kind === 'constructor' ? 'constructor'
    : el.kind === 'arrow_function' ? 'arrow'
    : el.kind === 'getter' ? 'getter'
    : el.kind === 'setter' ? 'setter'
    : 'declaration';
  return {
    id,
    type: 'function',
    name: el.name ?? '<anon>',
    location: loc(el),
    children: mapChildren(node, graph),
    metadata: {
      kind: fnKind,
      async: meta.isAsync ?? false,
      generator: false,
      params: [],
      returnType: meta.returnTypeName,
      visibility: meta.visibility,
      decorators: meta.decorators,
      errorMap: [],
    },
  };
}

function mapFlowControl(node: FlowNode, graph: ElementGraph): FlowControlNode {
  const el = node.element;
  const id = nodeId('flowControl', el.location.file, el.location.startLine, el.kind);

  let kind: FlowControlNode['metadata']['kind'];
  let condition: string | undefined;

  if (el.kind === 'branch') {
    const m = el.meta as BranchMeta;
    kind = m.branchKind === 'if' || m.branchKind === 'else_if' ? m.branchKind : m.branchKind === 'switch' ? 'switch' : 'ternary';
    condition = m.conditionText;
  } else if (el.kind === 'loop') {
    const m = el.meta as LoopMeta;
    kind = (m.loopKind === 'for-of' ? 'for_of'
          : m.loopKind === 'for-in' ? 'for_in'
          : m.loopKind === 'while' ? 'while'
          : m.loopKind === 'do-while' ? 'do_while'
          : 'for') as FlowControlNode['metadata']['kind'];
    condition = m.iterableText;
  } else if (el.kind === 'try_block') {
    kind = 'try';
  } else if (el.kind === 'catch_block') {
    kind = 'catch';
  } else if (el.kind === 'finally_block') {
    kind = 'finally';
  } else {
    // branch_then / branch_else
    kind = el.kind === 'branch_then' ? 'if' : 'else';
  }

  return {
    id,
    type: 'flowControl',
    name: el.name ?? kind,
    location: loc(el),
    children: mapChildren(node, graph),
    metadata: { kind, condition },
  };
}

function mapCall(node: FlowNode, graph: ElementGraph): CallNode {
  const el = node.element;
  const meta = el.meta as CallSiteMeta;
  const id = nodeId('call', el.location.file, el.location.startLine, meta.calleeText ?? '');

  // Se a call está resolvida E não é externa, vira children expandidos
  // (a FlowTree já incluiu o método chamado como filho via edge `calls`).
  const expanded = node.children.length > 0 ? mapChildren(node, graph) : [];

  // resolvedTo precisa ser o id do node projetado, não o elementId.
  // Como estamos gerando ids determinísticos por nodeId(), reproduzimos:
  let resolvedTo: string | undefined;
  if (meta.resolvedElementId) {
    const target = graph.getElement(meta.resolvedElementId);
    if (target) {
      resolvedTo = nodeId(
        'function',
        target.location.file,
        target.location.startLine,
        target.name ?? '',
      );
    }
  }

  return {
    id,
    type: 'call',
    name: meta.calleeText ?? 'call',
    location: loc(el),
    children: expanded,
    metadata: {
      callee: meta.calleeText ?? '',
      arguments: meta.argsText ?? [],
      awaited: meta.isAwaited ?? false,
      chained: meta.isChained ?? false,
      optional: false,
      resolvedTo,
    },
  };
}

function mapReturn(node: FlowNode): ReturnNode {
  const el = node.element;
  const meta = el.meta as ReturnSiteMeta;
  const id = nodeId('return', el.location.file, el.location.startLine, '');
  return {
    id,
    type: 'return',
    name: 'return',
    location: loc(el),
    children: [],
    metadata: {
      kind: 'explicit',
      value: meta.valueText,
    },
  };
}

function mapThrow(node: FlowNode): ThrowNode {
  const el = node.element;
  const meta = el.meta as ThrowSiteMeta;
  const id = nodeId('throw', el.location.file, el.location.startLine, '');
  const errorClass = meta.exceptionClassName ?? 'Error';
  const httpStatus = inferHttpStatus(errorClass);
  return {
    id,
    type: 'throw',
    name: errorClass,
    location: loc(el),
    children: [],
    metadata: {
      kind: 'throw',
      errorClass,
      message: meta.messageText,
      httpStatus,
      propagates: true,
    },
  };
}

function mapAssign(node: FlowNode, graph: ElementGraph): DataNode | CallNode | null {
  const el = node.element;
  const meta = el.meta as AssignSiteMeta;
  // Se tem filho call_site, a "operação" relevante é a chamada — mostra ela.
  // O assign vira invisível (o fluxo continua igual; o painel pode mostrar o target).
  const callChild = node.children.find(c => c.element.kind === 'call_site');
  if (callChild) return mapCall(callChild, graph);

  const id = nodeId('data', el.location.file, el.location.startLine, meta.targetText ?? '');
  return {
    id,
    type: 'data',
    name: meta.targetText ?? 'var',
    location: loc(el),
    children: [],
    metadata: {
      kind: meta.isConst ? 'constant' : 'variable',
      mutable: !meta.isConst,
      scope: 'local',
      initialValue: meta.valueText,
    },
  };
}

function mapProcess(node: FlowNode, kind: string): ProcessNode {
  const el = node.element;
  const id = nodeId('process', el.location.file, el.location.startLine, kind);
  return {
    id,
    type: 'process',
    name: kind,
    location: loc(el),
    children: [],
    metadata: {
      kind: 'computation',
      description: el.text?.slice(0, 80),
    },
  };
}

// Heurística rasa para HTTP status quando o throw é uma exceção comum NestJS/HTTP.
function inferHttpStatus(errorClass: string): number | undefined {
  const map: Record<string, number> = {
    BadRequestException: 400,
    UnauthorizedException: 401,
    ForbiddenException: 403,
    NotFoundException: 404,
    ConflictException: 409,
    UnprocessableEntityException: 422,
    InternalServerErrorException: 500,
    ServiceUnavailableException: 503,
  };
  return map[errorClass];
}
