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
  type BranchSubBlockMeta,
  type LoopMeta,
  type BehavioralMeta,
} from '@topology/code-graph';

import type { SourceFile as CoreSourceFile } from '../core/walker';
import type {
  CodeNode, EndpointNode,
  FunctionNode, CallNode, FlowControlNode,
  ReturnNode, ThrowNode, DataNode, ProcessNode, DbProcessNode,
  ExternalCallNode,
  SourceLocation,
} from '../types/topology';
import { nodeId } from '../utils/id';
import { detectFeatureFlag } from '../analysis/feature-flag-detector';

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
        // Emit the call chain first (the operation), then a DataNode for the
        // variable so consumers can look up `x` and follow `sourceNodeId`
        // back to the call result. Skipped for unawaited fire-and-forget
        // calls assigned to nothing meaningful — but we always emit both
        // when there is a target name.
        const flat = flattenChildren([callChild], graph);
        out.push(...flat);
        const callMapped = flat[flat.length - 1];
        const varNode = mapAssignToVariable(child, callMapped?.id);
        if (varNode) out.push(varNode);
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
  let conditionAst: FlowControlNode['metadata']['conditionAst'];

  if (el.kind === 'branch') {
    const m = el.meta as BranchMeta;
    kind = m.branchKind === 'if' || m.branchKind === 'else_if' ? m.branchKind : m.branchKind === 'switch' ? 'switch' : 'ternary';
    condition = m.conditionText;
    // BranchMeta.conditionAst is structurally identical to topology's
    // ConditionExpr (kept duplicated to keep code-graph autonomous).
    conditionAst = m.conditionAst as FlowControlNode['metadata']['conditionAst'];
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

  // For `branch` elements (if / else_if / switch / ternary), the walker emits
  // branch_then / branch_else children that wrap the actual statements of each
  // arm. Surface these as `metadata.branches[]` so the UI can render them as
  // labeled lanes (then / else / case / default) instead of an opaque list.
  let branches: { label: string; children: CodeNode[] }[] | undefined;
  let outerChildren: CodeNode[];

  if (el.kind === 'branch') {
    const parentBranchKind = (el.meta as BranchMeta).branchKind;
    branches = [];
    const leftover: FlowNode[] = [];
    for (const child of node.children) {
      const ck = child.element.kind;
      if (ck === 'branch_then' || ck === 'branch_else') {
        const sub = child.element.meta as BranchSubBlockMeta | undefined;
        const fallback =
          parentBranchKind === 'switch'
            ? (ck === 'branch_then' ? 'case' : 'default')
            : (ck === 'branch_then' ? 'then' : 'else');
        branches.push({
          label: sub?.label ?? fallback,
          children: flattenChildren(child.children, graph),
        });
      } else {
        leftover.push(child);
      }
    }
    outerChildren = flattenChildren(leftover, graph);
    if (branches.length === 0) branches = undefined;
  } else {
    outerChildren = mapChildren(node, graph);
  }

  const featureFlag = detectFeatureFlag(conditionAst);

  return {
    id,
    type: 'flowControl',
    name: el.name ?? kind,
    location: loc(el),
    children: outerChildren,
    metadata: { kind, condition, conditionAst, branches, featureFlag },
  };
}

function mapCall(node: FlowNode, graph: ElementGraph): CallNode | DbProcessNode | ExternalCallNode {
  const el = node.element;
  const meta = el.meta as CallSiteMeta;

  // External HTTP call detection — turn `axios.get(...)`, `fetch(...)`, etc.
  // into an `externalCall` node so cross-service topology can later resolve
  // the call to a concrete EndpointNode.
  const ext = detectExternalCall(meta);
  if (ext) {
    const extId = nodeId('externalCall', el.location.file, el.location.startLine, meta.calleeText ?? '');
    return {
      id: extId,
      type: 'externalCall',
      name: `${ext.method} ${ext.path}`,
      location: loc(el),
      children: [],
      metadata: {
        method: ext.method,
        path: ext.path,
        pathNormalized: ext.path,
        baseUrl: ext.baseUrl,
        httpClient: ext.httpClient,
        awaited: meta.isAwaited ?? false,
      },
    };
  }

  // ORM call detection — turn `prisma.user.findMany(...)` etc. into a
  // `dbProcess` node so the topology surfaces persistence boundaries instead
  // of opaque `call` nodes.
  const db = detectDbProcess(meta.calleeText ?? '');
  if (db) {
    const dbId = nodeId('dbProcess', el.location.file, el.location.startLine, meta.calleeText ?? '');
    return {
      id: dbId,
      type: 'dbProcess',
      name: meta.calleeText ?? 'db',
      location: loc(el),
      children: [],
      metadata: {
        operation: db.operation,
        // Real databaseId is filled in later by cross-service resolution; for
        // now use the ORM as a stable proxy so the node is well-formed.
        databaseId: db.orm,
        tableId: db.tableId,
        orm: db.orm,
      },
    };
  }

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

function mapAssign(node: FlowNode, graph: ElementGraph): DataNode | CallNode | DbProcessNode | ExternalCallNode | null {
  const el = node.element;
  const meta = el.meta as AssignSiteMeta;
  // Se tem filho call_site, a "operação" relevante é a chamada — mostra ela.
  // O assign vira invisível (o fluxo continua igual; o painel pode mostrar o target).
  const callChild = node.children.find(c => c.element.kind === 'call_site');
  if (callChild) return mapCall(callChild, graph);

  return mapAssignToVariable(node, undefined);
}

/**
 * Build a DataNode for a `const x = …` / `let x = …` site, optionally
 * threading the produced call/dbProcess/externalCall id so the simulator
 * can follow `x` back to its source. Used in two places:
 *   1. `mapAssign` for non-call RHS (literals, identifiers, members…)
 *   2. `flattenChildren` after the call chain to expose the variable that
 *      receives the call result.
 */
function mapAssignToVariable(node: FlowNode, sourceNodeId: string | undefined): DataNode | null {
  const el = node.element;
  const meta = el.meta as AssignSiteMeta;
  if (!meta.targetText) return null;
  const id = nodeId('data', el.location.file, el.location.startLine, meta.targetText);
  return {
    id,
    type: 'data',
    name: meta.targetText,
    location: loc(el),
    children: [],
    metadata: {
      kind: meta.isConst ? 'constant' : 'variable',
      mutable: !meta.isConst,
      scope: 'local',
      initialValue: meta.valueText,
      sourceKind: meta.sourceKind,
      sourceNodeId,
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

// ──────────────────────────────────────────────────────────────────────────
// External HTTP call detection — recognise axios / fetch / got / nodejs http /
// NestJS HttpService / Angular HttpClient and project them as `externalCall`
// nodes. Path is parsed from the first string-literal argument (template
// literal `${...}` placeholders become `:param`).
// ──────────────────────────────────────────────────────────────────────────

type HttpMethod = ExternalCallNode['metadata']['method'];

function detectExternalCall(
  meta: CallSiteMeta,
): { httpClient: string; method: HttpMethod; path: string; baseUrl?: string } | null {
  const text = (meta.calleeText ?? '').trim();
  if (!text) return null;

  let httpClient: string | null = null;
  let method: HttpMethod | null = null;

  // axios.<method> / got.<method>
  let m = text.match(/(?:^|\.)(axios|got)\.(get|post|put|patch|delete|options|head)$/i);
  if (m) {
    httpClient = m[1].toLowerCase();
    method = m[2].toUpperCase() as HttpMethod;
  }

  // axios(...) / got(...) — default GET
  if (!httpClient) {
    m = text.match(/(?:^|\.)(axios|got)$/i);
    if (m) { httpClient = m[1].toLowerCase(); method = 'GET'; }
  }

  // fetch(...)
  if (!httpClient && /(?:^|\.)fetch$/.test(text)) {
    httpClient = 'fetch';
    method = 'GET';
  }

  // node http(s).request / get
  if (!httpClient) {
    m = text.match(/(?:^|\.)https?\.(request|get)$/);
    if (m) { httpClient = 'http'; method = m[1] === 'get' ? 'GET' : 'GET'; }
  }

  // NestJS HttpService
  if (!httpClient) {
    m = text.match(/(?:^|\.)httpService\.(get|post|put|patch|delete|head|options)$/i);
    if (m) { httpClient = '@nestjs/axios'; method = m[1].toUpperCase() as HttpMethod; }
  }

  // Angular HttpClient (this.http.* / httpClient.*)
  if (!httpClient) {
    m = text.match(/(?:^|\.)(?:http|httpClient)\.(get|post|put|patch|delete|head|options)$/);
    if (m) { httpClient = '@angular/common/http'; method = m[1].toUpperCase() as HttpMethod; }
  }

  // request.<method>
  if (!httpClient) {
    m = text.match(/(?:^|\.)request\.(get|post|put|patch|delete|head|options)$/i);
    if (m) { httpClient = 'request'; method = m[1].toUpperCase() as HttpMethod; }
  }

  if (!httpClient || !method) return null;

  // Refine fetch's method from `{ method: 'POST' }` in the second arg.
  const args = meta.argsText ?? [];
  if (httpClient === 'fetch' && args.length > 1) {
    const opts = args[1];
    const mm = opts.match(/method\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)['"`]/i);
    if (mm) method = mm[1].toUpperCase() as HttpMethod;
  }

  const { path, baseUrl } = extractUrlFromArg(args[0]);
  return { httpClient, method, path, baseUrl };
}

function extractUrlFromArg(arg: string | undefined): { path: string; baseUrl?: string } {
  if (!arg) return { path: '/' };
  const a = arg.trim();
  let raw: string | null = null;
  if ((a.startsWith("'") && a.endsWith("'")) || (a.startsWith('"') && a.endsWith('"'))) {
    raw = a.slice(1, -1);
  } else if (a.startsWith('`') && a.endsWith('`')) {
    raw = a.slice(1, -1).replace(/\$\{[^}]+\}/g, ':param');
  }
  if (!raw) return { path: '/' };
  const abs = raw.match(/^(https?:\/\/[^/]+)(\/.*)?$/i);
  if (abs) return { baseUrl: abs[1], path: abs[2] ?? '/' };
  return { path: raw.startsWith('/') ? raw : '/' + raw };
}

// ──────────────────────────────────────────────────────────────────────────
// ORM detection — recognise calls into Prisma / TypeORM / Mongoose / Sequelize
// from the literal `calleeText` and project them as `dbProcess` nodes.
// This is intentionally conservative (string-pattern based); cross-service
// resolution and concrete column-level mapping happen later in the pipeline.
// ──────────────────────────────────────────────────────────────────────────

type DbOperation = DbProcessNode['metadata']['operation'];

function detectDbProcess(
  calleeText: string,
): { orm: string; operation: DbOperation; tableId: string } | null {
  if (!calleeText) return null;
  const text = calleeText.trim();

  // Prisma top-level: $queryRaw / $executeRaw / $transaction
  const prismaTop = text.match(/(?:^|\.)prisma\.(\$\w+)$/);
  if (prismaTop) {
    const m = prismaTop[1];
    if (m.startsWith('$queryRaw') || m.startsWith('$executeRaw')) {
      return { orm: 'prisma', operation: 'raw', tableId: 'raw' };
    }
    if (m === '$transaction') {
      return { orm: 'prisma', operation: 'transaction', tableId: 'transaction' };
    }
  }

  // Prisma model: `prisma.<table>.<method>`
  const prismaModel = text.match(/(?:^|\.)prisma\.(\w+)\.(\w+)$/);
  if (prismaModel && !prismaModel[1].startsWith('$')) {
    const op = mapPrismaOperation(prismaModel[2]);
    if (op) return { orm: 'prisma', operation: op, tableId: prismaModel[1].toLowerCase() };
  }

  // TypeORM repository: `<entity>Repository.<method>` or `repository.<method>`
  const repoMatch =
    text.match(/(?:^|\.)(\w+?)Repository\.(\w+)$/) ||
    text.match(/(?:^|\.)(repository)\.(\w+)$/i);
  if (repoMatch) {
    const op = mapTypeOrmOperation(repoMatch[2]);
    if (op) {
      const raw = repoMatch[1];
      const tableId = raw.toLowerCase() === 'repository' ? '?' : raw.toLowerCase();
      return { orm: 'typeorm', operation: op, tableId };
    }
  }

  // TypeORM transaction via DataSource / EntityManager
  if (/(?:^|\.)(?:manager|entityManager|dataSource|connection)\.transaction$/.test(text)) {
    return { orm: 'typeorm', operation: 'transaction', tableId: 'transaction' };
  }

  // Mongoose / Sequelize-style model: `<Model>.<method>` (Model starts uppercase)
  const modelMatch = text.match(/(?:^|\.)([A-Z]\w*)\.(\w+)$/);
  if (modelMatch) {
    const op = mapMongooseOperation(modelMatch[2]);
    if (op) return { orm: 'mongoose', operation: op, tableId: modelMatch[1].toLowerCase() };
  }

  return null;
}

function mapPrismaOperation(m: string): DbOperation | null {
  const map: Record<string, DbOperation> = {
    findMany: 'findMany', findFirst: 'findFirst', findUnique: 'findUnique',
    findFirstOrThrow: 'findFirst', findUniqueOrThrow: 'findUnique',
    create: 'create', createMany: 'createMany',
    update: 'update', updateMany: 'updateMany', upsert: 'upsert',
    delete: 'delete', deleteMany: 'deleteMany',
    aggregate: 'aggregate', groupBy: 'groupBy', count: 'count',
  };
  return map[m] ?? null;
}

function mapTypeOrmOperation(m: string): DbOperation | null {
  const map: Record<string, DbOperation> = {
    find: 'findMany', findBy: 'findMany', findAndCount: 'findMany',
    findOne: 'findFirst', findOneBy: 'findFirst', findOneOrFail: 'findFirst', findOneByOrFail: 'findFirst',
    save: 'create', insert: 'create',
    update: 'update', upsert: 'upsert',
    delete: 'delete', remove: 'delete', softDelete: 'delete', softRemove: 'delete',
    count: 'count',
    query: 'raw', createQueryBuilder: 'raw',
  };
  return map[m] ?? null;
}

function mapMongooseOperation(m: string): DbOperation | null {
  const map: Record<string, DbOperation> = {
    find: 'findMany', findAll: 'findMany',
    findOne: 'findFirst', findById: 'findFirst',
    findOneAndUpdate: 'update', findByIdAndUpdate: 'update',
    findOneAndDelete: 'delete', findOneAndRemove: 'delete',
    findByIdAndDelete: 'delete', findByIdAndRemove: 'delete',
    create: 'create', save: 'create', insertMany: 'createMany', bulkCreate: 'createMany',
    updateOne: 'update', updateMany: 'updateMany', upsert: 'upsert',
    deleteOne: 'delete', deleteMany: 'deleteMany', remove: 'delete', destroy: 'delete',
    countDocuments: 'count', count: 'count',
    aggregate: 'aggregate',
  };
  return map[m] ?? null;
}

// Heurística para mapear o nome da classe de exceção para um HTTP status.
// Cobre 3 níveis: (1) match exato em frameworks comuns, (2) substring para
// convenções Java/Kotlin/Python, (3) fallback `undefined` quando o nome
// não é informativo o suficiente.
function inferHttpStatus(errorClass: string): number | undefined {
  // (1) match exato — NestJS + nomes de Spring/Jakarta comuns
  const exact: Record<string, number> = {
    BadRequestException: 400,
    UnauthorizedException: 401,
    ForbiddenException: 403,
    NotFoundException: 404,
    ConflictException: 409,
    UnprocessableEntityException: 422,
    InternalServerErrorException: 500,
    ServiceUnavailableException: 503,
    // Spring/JPA
    IllegalArgumentException: 400,
    IllegalStateException: 409,
    EntityNotFoundException: 404,
    AccessDeniedException: 403,
    AuthenticationException: 401,
    DataIntegrityViolationException: 409,
    MethodArgumentNotValidException: 400,
    MissingServletRequestParameterException: 400,
    HttpRequestMethodNotSupportedException: 405,
    HttpMediaTypeNotSupportedException: 415,
    // Python (Django/DRF/FastAPI)
    HTTPException: 400,
    PermissionDenied: 403,
    DoesNotExist: 404,
    ValidationError: 400,
    // Go (não tem classes mas alguns padrões)
    ErrNotFound: 404,
  };
  if (exact[errorClass]) return exact[errorClass];

  // (2) substring — pega convenções comuns sem tabela exaustiva
  const lower = errorClass.toLowerCase();
  if (lower.includes('notfound')) return 404;
  if (lower.includes('badrequest') || lower.includes('validation') || lower.includes('invalid')) return 400;
  if (lower.includes('unauthorized') || lower.includes('authentication')) return 401;
  if (lower.includes('forbidden') || lower.includes('accessdenied') || lower.includes('permission')) return 403;
  if (lower.includes('conflict') || lower.includes('duplicate') || lower.includes('alreadyexists')) return 409;
  if (lower.includes('unprocessable')) return 422;
  if (lower.includes('toomany') || lower.includes('ratelimit')) return 429;
  if (lower.includes('timeout')) return 504;
  if (lower.includes('unavailable')) return 503;
  if (lower.includes('notimplemented')) return 501;
  if (lower.includes('mediatype') || lower.includes('unsupportedmedia')) return 415;
  if (lower.includes('methodnotallowed')) return 405;

  // (3) sem informação útil — não chuta
  return undefined;
}
