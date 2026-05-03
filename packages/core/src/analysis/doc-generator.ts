// ============================================================
// Documentation generator (Fase 5a — Inteligência)
// ------------------------------------------------------------
// Produces structured markdown for a service or endpoint by
// collecting deterministic context from the topology, then
// asking the LLM to render it as docs. Context assembly is
// pure and testable; the LLM call is isolated in `*Doc()`.
//
// Sections produced for a service:
//   - Overview (kind, language, framework, owners)
//   - Dependencies (databases, brokers, services, externals)
//   - Endpoints (method, path, summary)
//   - Ownership (teams + contacts)
//
// Sections produced for an endpoint:
//   - Overview (method, path, controller, owners)
//   - Request (params, query, body, headers)
//   - Responses (success + error throws with httpStatus)
//   - Flow summary (top-level handler functions, db ops, externals)
// ============================================================

import type {
  SystemTopology, ServiceNode, EndpointNode, FunctionNode,
  CodeNode, OwnerNode, OwnershipMap,
  DbProcessNode, ExternalCallNode, ThrowNode, CallNode,
} from '../types/topology';
import { sanitizeForPrompt } from '../utils/prompt-sanitizer';
import { makeLLMCaller } from './llm-caller';

// ── Public config ─────────────────────────────────────────────

export interface DocGenConfig {
  apiKey?: string;
  /** Defaults to claude-sonnet-4-6 — markdown synthesis benefits from a stronger model. */
  model?: string;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';

// ── Context types (deterministic, testable) ───────────────────

export interface ServiceDocContext {
  service: {
    id: string;
    name: string;
    kind?: string;
    language?: string;
    framework?: string;
    description?: string;
    repoUrl?: string;
  };
  owners: { id: string; name: string; kind: string; handle?: string; email?: string }[];
  dependencies: {
    databases: { id: string; name: string; engine?: string }[];
    brokers:   { id: string; name: string; engine?: string }[];
    services:  { id: string; name?: string; resolvedEndpointId?: string }[];
    externals: { id: string; name?: string }[];
  };
  endpoints: {
    id: string;
    method: string;
    path: string;
    description?: string;
    throws: { errorClass?: string; httpStatus?: number }[];
  }[];
  stats: {
    endpointCount: number;
    functionCount: number;
    dbOperationCount: number;
    externalCallCount: number;
  };
}

export interface EndpointDocContext {
  service: { id: string; name: string };
  endpoint: {
    id: string;
    method: string;
    path: string;
    controller?: string;
    description?: string;
    request: {
      params?:  { name: string; type?: string }[];
      query?:   { name: string; type?: string; required?: boolean }[];
      body?:    { name: string; type?: string }[];
      bodyType?: string;
      headers?: { name: string }[];
    };
    responses: { httpStatus?: number; bodyType?: string; source?: string; description?: string }[];
  };
  owners: { id: string; name: string }[];
  flow: {
    handlerName?: string;
    dbOps:     { operation?: string; table?: string }[];
    externals: { method?: string; path?: string; baseUrl?: string; client?: string }[];
    throws:    { errorClass?: string; httpStatus?: number; message?: string }[];
  };
}

// ── Context builders (deterministic) ──────────────────────────

export function buildServiceContext(
  service: ServiceNode,
  topology: SystemTopology,
): ServiceDocContext {
  const ownership = topology.ownership;
  const owners = ownersOf(service.id, 'service', ownership);

  const dbDeps = service.dependencies.filter(d => d.targetKind === 'database');
  const brkDeps = service.dependencies.filter(d => d.targetKind === 'broker');
  const svcDeps = service.dependencies.filter(d => d.targetKind === 'service');
  const extDeps = service.dependencies.filter(d => d.targetKind === 'external_http');

  const databases = dbDeps.map(d => {
    const db = topology.databases.find(x => x.id === d.id);
    return { id: d.id, name: db?.name ?? d.id, engine: db?.metadata.engine };
  });
  const brokers = brkDeps.map(d => {
    const b = topology.brokers.find(x => x.id === d.id);
    return { id: d.id, name: b?.name ?? d.id, engine: b?.metadata.engine };
  });
  const services = svcDeps.map(d => ({
    id: d.id,
    name: d.name,
    resolvedEndpointId: d.resolvedEndpointId,
  }));
  const externals = extDeps.map(d => ({ id: d.id, name: d.name }));

  const endpoints = service.endpoints.map(ep => ({
    id: ep.id,
    method: ep.metadata.method,
    path: ep.metadata.path,
    description: ep.metadata.llm?.description,
    throws: collectThrows(ep).map(t => ({
      errorClass: t.metadata.errorClass,
      httpStatus: t.metadata.httpStatus,
    })),
  }));

  return {
    service: {
      id: service.id,
      name: service.name,
      kind: service.metadata.kind,
      language: service.metadata.language,
      framework: service.metadata.framework,
      description: service.metadata.description ?? service.metadata.llm?.description,
      repoUrl: service.metadata.repository?.url,
    },
    owners,
    dependencies: { databases, brokers, services, externals },
    endpoints,
    stats: {
      endpointCount: service.endpoints.length,
      functionCount: service.functions.length,
      dbOperationCount: countByType(service, 'dbProcess'),
      externalCallCount: countByType(service, 'externalCall'),
    },
  };
}

export function buildEndpointContext(
  endpoint: EndpointNode,
  service: ServiceNode,
  topology: SystemTopology,
): EndpointDocContext {
  const ownership = topology.ownership;
  // Owners of this endpoint OR fall back to service owners. CODEOWNERS rules
  // are file-based, so endpoints often share the team with their service.
  const epOwners = ownersOf(endpoint.id, 'endpoint', ownership);
  const owners = epOwners.length > 0
    ? epOwners.map(o => ({ id: o.id, name: o.name }))
    : ownersOf(service.id, 'service', ownership).map(o => ({ id: o.id, name: o.name }));

  const handler = endpoint.metadata.handlerFnId
    ? service.functions.find(f => f.id === endpoint.metadata.handlerFnId)
    : undefined;

  const dbOps:     { operation?: string; table?: string }[] = [];
  const externals: { method?: string; path?: string; baseUrl?: string; client?: string }[] = [];
  const throws:    { errorClass?: string; httpStatus?: number; message?: string }[] = [];

  walkReachable(endpoint, service, (n) => {
    if (n.type === 'dbProcess') {
      const db = n as DbProcessNode;
      dbOps.push({ operation: db.metadata.operation, table: db.metadata.tableId });
    } else if (n.type === 'externalCall') {
      const ext = n as ExternalCallNode;
      externals.push({
        method: ext.metadata.method,
        path: ext.metadata.path,
        baseUrl: ext.metadata.baseUrl,
        client: ext.metadata.httpClient,
      });
    } else if (n.type === 'throw') {
      const t = n as ThrowNode;
      throws.push({
        errorClass: t.metadata.errorClass,
        httpStatus: t.metadata.httpStatus,
        message: t.metadata.message,
      });
    }
  });

  return {
    service: { id: service.id, name: service.name },
    endpoint: {
      id: endpoint.id,
      method: endpoint.metadata.method,
      path: endpoint.metadata.path,
      controller: endpoint.metadata.controller,
      description: endpoint.metadata.llm?.description,
      request: {
        params:  endpoint.metadata.request.params,
        query:   endpoint.metadata.request.query,
        body:    endpoint.metadata.request.body,
        bodyType: endpoint.metadata.request.bodyType,
        headers: endpoint.metadata.request.headers?.map(h => ({ name: h.name })),
      },
      responses: (endpoint.metadata.responses ?? []).map(r => ({
        httpStatus: r.httpStatus,
        bodyType: r.bodyType,
        source: r.source,
        description: r.description,
      })),
    },
    owners,
    flow: {
      handlerName: handler?.name,
      dbOps:     dedupeDbOps(dbOps),
      externals: dedupeExternals(externals),
      throws,
    },
  };
}

// ── Prompt formatters (deterministic) ─────────────────────────

export function formatServicePrompt(ctx: ServiceDocContext): string {
  // Sanitize EVERY string that came from user code/config; the LLM is
  // instructed to render markdown, so untrusted content can't hijack
  // section structure or inject prompt overrides.
  const s = sanitizeForPrompt;
  const lines: string[] = [];
  lines.push('You are documenting a microservice for an internal architecture portal.');
  lines.push('Render concise, accurate Markdown using ONLY the facts in the JSON below.');
  lines.push('Do NOT invent capabilities, performance numbers, deployment details, or business logic that are not present in the data.');
  lines.push('');
  lines.push('Required sections (in this order, with "##" headings):');
  lines.push('1. Overview — one paragraph describing what the service does, derived from name + description + endpoint paths');
  lines.push('2. Ownership — bullet list of owners with handle/email when known; "Not declared" if empty');
  lines.push('3. Dependencies — group by databases / brokers / services / external HTTP; bullet each');
  lines.push('4. Endpoints — table with columns Method | Path | Description (use "—" when description missing)');
  lines.push('5. Notable failure modes — list distinct httpStatus/errorClass thrown, if any');
  lines.push('');
  lines.push('Style: terse, factual, no marketing. No trailing prose. No emojis.');
  lines.push('');
  lines.push('### Service context (JSON)');
  lines.push('```json');
  lines.push(JSON.stringify({
    service: {
      ...ctx.service,
      name: s(ctx.service.name),
      description: ctx.service.description ? s(ctx.service.description) : undefined,
    },
    owners: ctx.owners.map(o => ({ ...o, name: s(o.name) })),
    dependencies: {
      databases: ctx.dependencies.databases.map(d => ({ ...d, name: s(d.name) })),
      brokers:   ctx.dependencies.brokers.map(b => ({ ...b, name: s(b.name) })),
      services:  ctx.dependencies.services.map(d => ({ ...d, name: d.name ? s(d.name) : undefined })),
      externals: ctx.dependencies.externals.map(d => ({ ...d, name: d.name ? s(d.name) : undefined })),
    },
    endpoints: ctx.endpoints.map(ep => ({
      ...ep,
      path: s(ep.path),
      description: ep.description ? s(ep.description) : undefined,
    })),
    stats: ctx.stats,
  }, null, 2));
  lines.push('```');
  return lines.join('\n');
}

export function formatEndpointPrompt(ctx: EndpointDocContext): string {
  const s = sanitizeForPrompt;
  const lines: string[] = [];
  lines.push('You are documenting a single HTTP endpoint for an internal architecture portal.');
  lines.push('Render concise, accurate Markdown using ONLY the facts in the JSON below.');
  lines.push('Do NOT speculate about authentication, rate limits, or behavior not present in the data.');
  lines.push('');
  lines.push('Required sections (in this order, with "##" headings):');
  lines.push('1. Summary — one or two sentences combining method, path, and inferred purpose');
  lines.push('2. Request — subsections "Path params", "Query", "Body", "Headers" — omit subsections that are empty');
  lines.push('3. Responses — table Status | Type; include both declared responses and httpStatus from throws');
  lines.push('4. Flow — bullet list: handler function, db operations (operation @ table), external calls');
  lines.push('5. Ownership — bullet of owner names; "Not declared" if empty');
  lines.push('');
  lines.push('Style: terse, factual. No marketing. No emojis.');
  lines.push('');
  lines.push('### Endpoint context (JSON)');
  lines.push('```json');
  lines.push(JSON.stringify({
    service: { ...ctx.service, name: s(ctx.service.name) },
    endpoint: {
      ...ctx.endpoint,
      path: s(ctx.endpoint.path),
      controller: ctx.endpoint.controller ? s(ctx.endpoint.controller) : undefined,
      description: ctx.endpoint.description ? s(ctx.endpoint.description) : undefined,
    },
    owners: ctx.owners.map(o => ({ ...o, name: s(o.name) })),
    flow: ctx.flow,
  }, null, 2));
  lines.push('```');
  return lines.join('\n');
}

// ── Public generators (LLM call) ──────────────────────────────

export async function generateServiceDoc(
  service: ServiceNode,
  topology: SystemTopology,
  config: DocGenConfig = {},
): Promise<string> {
  const ctx = buildServiceContext(service, topology);
  const prompt = formatServicePrompt(ctx);
  const caller = makeLLMCaller(config.apiKey);
  return await caller(prompt, config.model ?? DEFAULT_MODEL);
}

export async function generateEndpointDoc(
  endpoint: EndpointNode,
  service: ServiceNode,
  topology: SystemTopology,
  config: DocGenConfig = {},
): Promise<string> {
  const ctx = buildEndpointContext(endpoint, service, topology);
  const prompt = formatEndpointPrompt(ctx);
  const caller = makeLLMCaller(config.apiKey);
  return await caller(prompt, config.model ?? DEFAULT_MODEL);
}

// ── Helpers ───────────────────────────────────────────────────

function ownersOf(
  targetId: string,
  targetKind: 'service' | 'endpoint' | 'function',
  ownership: OwnershipMap | undefined,
): { id: string; name: string; kind: string; handle?: string; email?: string }[] {
  if (!ownership) return [];
  const byId = new Map<string, OwnerNode>(ownership.owners.map(o => [o.id, o]));
  const seen = new Set<string>();
  const out: { id: string; name: string; kind: string; handle?: string; email?: string }[] = [];
  for (const e of ownership.edges) {
    if (e.targetId !== targetId || e.targetKind !== targetKind) continue;
    if (seen.has(e.ownerId)) continue;
    seen.add(e.ownerId);
    const o = byId.get(e.ownerId);
    if (!o) continue;
    out.push({
      id: o.id,
      name: o.name,
      kind: o.metadata.kind,
      handle: o.metadata.handle,
      email: o.metadata.email,
    });
  }
  return out;
}

function collectThrows(node: CodeNode): ThrowNode[] {
  const out: ThrowNode[] = [];
  function visit(n: CodeNode) {
    if (n.type === 'throw') out.push(n as ThrowNode);
    for (const c of n.children) visit(c);
  }
  visit(node);
  return out;
}

function countByType(service: ServiceNode, type: CodeNode['type']): number {
  let n = 0;
  function visit(node: CodeNode) {
    if (node.type === type) n++;
    for (const c of node.children) visit(c);
  }
  for (const ep of service.endpoints) visit(ep);
  for (const fn of service.functions) visit(fn);
  return n;
}

/**
 * Walk the endpoint plus any functions reachable via resolved `call` nodes.
 * Stops at MAX_DEPTH=8 and tracks visited function ids to avoid infinite
 * recursion — the topology may contain cycles we don't want to expand here.
 */
function walkReachable(
  endpoint: EndpointNode,
  service: ServiceNode,
  visit: (n: CodeNode) => void,
): void {
  const visitedFns = new Set<string>();
  const fnById = new Map(service.functions.map(f => [f.id, f]));

  function descend(node: CodeNode, depth: number): void {
    visit(node);
    if (depth > 8) return;
    if (node.type === 'call') {
      const c = node as CallNode;
      const targetId = c.metadata.resolvedTo;
      if (targetId && !visitedFns.has(targetId)) {
        visitedFns.add(targetId);
        const fn = fnById.get(targetId);
        if (fn) for (const child of fn.children) descend(child, depth + 1);
      }
    }
    for (const child of node.children) descend(child, depth + 1);
  }

  // Seed: handler function (if linked) + endpoint children.
  const handlerId = endpoint.metadata.handlerFnId;
  if (handlerId && !visitedFns.has(handlerId)) {
    visitedFns.add(handlerId);
    const handler = fnById.get(handlerId) as FunctionNode | undefined;
    if (handler) for (const c of handler.children) descend(c, 0);
  }
  for (const c of endpoint.children) descend(c, 0);
}

function dedupeDbOps(
  ops: { operation?: string; table?: string }[],
): { operation?: string; table?: string }[] {
  const seen = new Set<string>();
  return ops.filter(o => {
    const k = `${o.operation ?? ''}@${o.table ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function dedupeExternals(
  exts: { method?: string; path?: string; baseUrl?: string; client?: string }[],
): { method?: string; path?: string; baseUrl?: string; client?: string }[] {
  const seen = new Set<string>();
  return exts.filter(e => {
    const k = `${e.method ?? ''}|${e.baseUrl ?? ''}|${e.path ?? ''}|${e.client ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
