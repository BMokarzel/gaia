// ─────────────────────────────────────────────────────────────
// Endpoint simulator (Fase 8 — lite).
//
// Walks an endpoint subtree (and its transitively-reachable
// functions) and reports every observable side effect — throws,
// external calls, DB operations, middlewares, returns — together
// with whether each is reachable inside a try/catch and which
// failure toggles would force-trigger it.
//
// Pure: no I/O. We don't symbolically evaluate conditions; instead
// we enumerate every path's side effects and flag branch points so
// callers know which steps were conditional.
// ─────────────────────────────────────────────────────────────

import type {
  CodeNode, EndpointNode, FunctionNode, ServiceNode,
  ThrowNode, ExternalCallNode, DbProcessNode, MiddlewareNode,
  FlowControlNode, ReturnNode, CallNode,
} from '../types/topology';

export interface SimulationToggles {
  /** External call ids that should be treated as failing (e.g. simulating an outage). */
  failingExternalIds?: string[];
  /** dbProcess ids that should be treated as failing (e.g. simulating a deadlock). */
  failingDbIds?: string[];
  /** Middleware names (e.g. "AuthGuard") that should be treated as rejecting the request. */
  failingMiddleware?: string[];
}

export interface SimulationOptions {
  toggles?: SimulationToggles;
  /** Cap on transitive function expansion to keep traces bounded. Default 8. */
  maxFunctionDepth?: number;
}

export interface VisitedThrow {
  nodeId: string;
  errorClass: string;
  httpStatus?: number;
  /** Containing service id where the throw is defined (could be the endpoint's service or a callee's). */
  serviceId: string;
  /** Whether this throw is inside a `try` ancestor in its lexical tree (heuristic — propagates=false also implies caught). */
  caught: boolean;
  /** When set, this throw was *triggered by a toggle* rather than naturally reachable. */
  triggeredBy?: 'middleware' | 'external' | 'db';
  /** Source node that the toggle pointed at (e.g. the failing externalCall id). */
  triggeredByNodeId?: string;
}

export interface VisitedExternalCall {
  nodeId: string;
  serviceId: string;
  method?: string;
  path?: string;
  baseUrl?: string;
  conditional: boolean;
  forcedFailure: boolean;
}

export interface VisitedDbOp {
  nodeId: string;
  serviceId: string;
  operation: string;
  databaseId?: string;
  tableId?: string;
  conditional: boolean;
  forcedFailure: boolean;
}

export interface VisitedMiddleware {
  nodeId: string;
  name: string;
  kind: string;
  order: number;
  forcedFailure: boolean;
}

export interface VisitedReturn {
  nodeId: string;
  httpStatus?: number;
  conditional: boolean;
}

export interface BranchPoint {
  nodeId: string;
  kind: string;
  condition?: string;
  /** Number of branches this control node opens (e.g. an if has 2: then + else). */
  branchCount: number;
}

export interface SimulationResult {
  endpointId: string;
  serviceId: string;
  /** Side effects collected in walk order. */
  middlewares: VisitedMiddleware[];
  externals:   VisitedExternalCall[];
  dbOps:       VisitedDbOp[];
  throws:      VisitedThrow[];
  returns:     VisitedReturn[];
  branches:    BranchPoint[];
  /**
   * Coarse outcome. We can't pick a single one without input evaluation, so we
   * report the set of *likely* outcomes:
   *   - throws that escape (propagate=true and not inside try) → these are user-visible HTTP errors
   *   - returns at top level (not in branches) → these are user-visible success responses
   */
  likelyResponses: Array<
    | { kind: 'throw'; httpStatus?: number; errorClass: string; reason: string }
    | { kind: 'return'; httpStatus?: number }
  >;
}

/**
 * Public entry point. The endpoint must belong to `service` (we don't search
 * across services to keep the trace bounded). Resolves transitive `call` nodes
 * via `metadata.resolvedTo`, capped at `maxFunctionDepth` to guard against
 * mutual recursion blowing the trace.
 */
export function simulateEndpoint(
  endpoint: EndpointNode,
  service: ServiceNode,
  options: SimulationOptions = {},
): SimulationResult {
  const ctx = makeContext(endpoint, service, options);

  // Middlewares fire before the handler body — so include them at the top
  for (const mw of endpoint.metadata.middleware ?? []) {
    const forcedFailure = (options.toggles?.failingMiddleware ?? []).includes(mw.name);
    ctx.middlewares.push({
      nodeId: `${endpoint.id}:mw:${mw.order}`,
      name: mw.name,
      kind: mw.kind,
      order: mw.order,
      forcedFailure,
    });
    if (forcedFailure) {
      // Forced-failing middlewares short-circuit the request — record an
      // implicit 401/403/4xx throw on behalf of the toggle so consumers can
      // surface it in `likelyResponses` without having to walk middlewares.
      ctx.throws.push({
        nodeId: `${endpoint.id}:mw:${mw.order}:forced`,
        errorClass: `${mw.name}Rejected`,
        httpStatus: inferMiddlewareRejectStatus(mw.kind),
        serviceId: service.id,
        caught: false,
        triggeredBy: 'middleware',
        triggeredByNodeId: `${endpoint.id}:mw:${mw.order}`,
      });
    }
  }

  walk(endpoint.children ?? [], ctx, { tryDepth: 0, conditional: false, fnDepth: 0 });

  // Build "likelyResponses" — escaping throws + top-level returns
  const likely: SimulationResult['likelyResponses'] = [];
  for (const t of ctx.throws) {
    if (t.caught) continue;
    likely.push({
      kind: 'throw',
      httpStatus: t.httpStatus,
      errorClass: t.errorClass,
      reason: t.triggeredBy ? `forced via ${t.triggeredBy}` : 'naturally reachable',
    });
  }
  for (const r of ctx.returns) {
    if (!r.conditional) likely.push({ kind: 'return', httpStatus: r.httpStatus });
  }

  return {
    endpointId: endpoint.id,
    serviceId: service.id,
    middlewares: ctx.middlewares,
    externals:   ctx.externals,
    dbOps:       ctx.dbOps,
    throws:      ctx.throws,
    returns:     ctx.returns,
    branches:    ctx.branches,
    likelyResponses: likely,
  };
}

// ── Internals ────────────────────────────────────────────────────────

interface WalkState {
  tryDepth: number;
  conditional: boolean;
  fnDepth: number;
}

interface SimContext {
  service: ServiceNode;
  options: SimulationOptions;
  fnById: Map<string, FunctionNode>;
  visitedFns: Set<string>;
  middlewares: VisitedMiddleware[];
  externals: VisitedExternalCall[];
  dbOps: VisitedDbOp[];
  throws: VisitedThrow[];
  returns: VisitedReturn[];
  branches: BranchPoint[];
}

function makeContext(_endpoint: EndpointNode, service: ServiceNode, options: SimulationOptions): SimContext {
  const fnById = new Map<string, FunctionNode>();
  for (const fn of service.functions) fnById.set(fn.id, fn);
  return {
    service,
    options,
    fnById,
    visitedFns: new Set(),
    middlewares: [],
    externals: [],
    dbOps: [],
    throws: [],
    returns: [],
    branches: [],
  };
}

function walk(nodes: CodeNode[], ctx: SimContext, state: WalkState): void {
  for (const n of nodes) handleNode(n, ctx, state);
}

function handleNode(n: CodeNode, ctx: SimContext, state: WalkState): void {
  switch (n.type) {
    case 'throw': {
      const t = n as ThrowNode;
      ctx.throws.push({
        nodeId: t.id,
        errorClass: t.metadata.errorClass,
        httpStatus: t.metadata.httpStatus,
        serviceId: ctx.service.id,
        caught: state.tryDepth > 0 || t.metadata.propagates === false,
      });
      // Throws still terminate the lexical path — but we don't stop the walk
      // because siblings (in different branches) are still potential paths.
      return;
    }
    case 'externalCall': {
      const ec = n as ExternalCallNode;
      const forced = (ctx.options.toggles?.failingExternalIds ?? []).includes(ec.id);
      ctx.externals.push({
        nodeId: ec.id,
        serviceId: ctx.service.id,
        method: ec.metadata.method,
        path: ec.metadata.path,
        baseUrl: ec.metadata.baseUrl,
        conditional: state.conditional,
        forcedFailure: forced,
      });
      if (forced) {
        ctx.throws.push({
          nodeId: `${ec.id}:forced`,
          errorClass: 'ExternalCallFailure',
          httpStatus: 502,
          serviceId: ctx.service.id,
          caught: state.tryDepth > 0,
          triggeredBy: 'external',
          triggeredByNodeId: ec.id,
        });
      }
      // External calls have no children we care about; skip child walk.
      return;
    }
    case 'dbProcess': {
      const db = n as DbProcessNode;
      const forced = (ctx.options.toggles?.failingDbIds ?? []).includes(db.id);
      ctx.dbOps.push({
        nodeId: db.id,
        serviceId: ctx.service.id,
        operation: db.metadata.operation,
        databaseId: db.metadata.databaseId,
        tableId: db.metadata.tableId,
        conditional: state.conditional,
        forcedFailure: forced,
      });
      if (forced) {
        ctx.throws.push({
          nodeId: `${db.id}:forced`,
          errorClass: 'DatabaseFailure',
          httpStatus: 503,
          serviceId: ctx.service.id,
          caught: state.tryDepth > 0,
          triggeredBy: 'db',
          triggeredByNodeId: db.id,
        });
      }
      return;
    }
    case 'middleware': {
      const mw = n as MiddlewareNode;
      const forced = (ctx.options.toggles?.failingMiddleware ?? []).includes(mw.metadata.name);
      ctx.middlewares.push({
        nodeId: mw.id,
        name: mw.metadata.name,
        kind: mw.metadata.kind,
        order: mw.metadata.order,
        forcedFailure: forced,
      });
      if (forced) {
        ctx.throws.push({
          nodeId: `${mw.id}:forced`,
          errorClass: `${mw.metadata.name}Rejected`,
          httpStatus: inferMiddlewareRejectStatus(mw.metadata.kind),
          serviceId: ctx.service.id,
          caught: state.tryDepth > 0,
          triggeredBy: 'middleware',
          triggeredByNodeId: mw.id,
        });
      }
      // Walk children — middlewares can wrap further setup
      walk(mw.children ?? [], ctx, state);
      return;
    }
    case 'flowControl': {
      const fc = n as FlowControlNode;
      const isTry = fc.metadata.kind === 'try';
      const branchCount = (fc.metadata.branches?.length ?? 0) || (fc.children?.length ? 1 : 0);
      ctx.branches.push({
        nodeId: fc.id,
        kind: fc.metadata.kind,
        condition: fc.metadata.condition,
        branchCount,
      });
      const childState: WalkState = {
        tryDepth: state.tryDepth + (isTry ? 1 : 0),
        conditional: state.conditional || isBranching(fc.metadata.kind),
        fnDepth: state.fnDepth,
      };
      // Branches array (preferred when present); fallback to children
      if (fc.metadata.branches?.length) {
        for (const b of fc.metadata.branches) walk(b.children, ctx, childState);
      }
      walk(fc.children ?? [], ctx, childState);
      return;
    }
    case 'return': {
      const r = n as ReturnNode;
      ctx.returns.push({
        nodeId: r.id,
        httpStatus: r.metadata.httpStatus,
        conditional: state.conditional,
      });
      return;
    }
    case 'call': {
      const c = n as CallNode;
      const target = c.metadata.resolvedTo;
      const max = ctx.options.maxFunctionDepth ?? 8;
      if (target && state.fnDepth < max && !ctx.visitedFns.has(target)) {
        const fn = ctx.fnById.get(target);
        if (fn) {
          ctx.visitedFns.add(target);
          walk(fn.children ?? [], ctx, { ...state, fnDepth: state.fnDepth + 1 });
        }
      }
      walk(c.children ?? [], ctx, state);
      return;
    }
    default:
      walk(n.children ?? [], ctx, state);
      return;
  }
}

function isBranching(kind: FlowControlNode['metadata']['kind']): boolean {
  return kind === 'if' || kind === 'else_if' || kind === 'else'
      || kind === 'switch' || kind === 'case' || kind === 'default'
      || kind === 'ternary' || kind === 'optional_chain' || kind === 'nullish_coalescing'
      || kind === 'catch' || kind === 'for' || kind === 'for_of' || kind === 'for_in'
      || kind === 'while' || kind === 'do_while';
}

/** Loose mapping from middleware kind to the HTTP status the rejection most likely surfaces as. */
function inferMiddlewareRejectStatus(kind: string): number {
  if (kind === 'guard') return 403;
  if (kind === 'pipe' || kind === 'filter') return 400;
  return 401;
}
