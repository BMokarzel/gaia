// ─────────────────────────────────────────────────────────────
// Declarative query DSL over a SystemTopology.
//
// Each query is a discriminated union so the LLM (and humans)
// can compose them cheaply, and the executor is a single pure
// function with no I/O. Adding a query type means: (a) extend
// the union, (b) add a case in `runTopologyQuery`. Each query
// kind has its own result shape — callers narrow by `query.kind`.
// ─────────────────────────────────────────────────────────────

import type {
  SystemTopology, ServiceNode, EndpointNode, FunctionNode,
  ThrowNode, ExternalCallNode, DbProcessNode, CodeNode,
} from '../types/topology';

export type TopologyQuery =
  | { kind: 'cycles' }
  | { kind: 'orphan_services' }
  | { kind: 'endpoints_without_auth' }
  | { kind: 'endpoints_throwing'; status: number }
  | { kind: 'services_using_database'; databaseId: string }
  | { kind: 'services_without_owners' }
  | { kind: 'unresolved_external_calls' }
  | { kind: 'duplicate_db_operations' };

/** Each query result type — kept verbose so consumers (LLMs especially) can narrow safely. */
export type QueryResult =
  | { kind: 'cycles'; cycles: string[][] }
  | { kind: 'orphan_services'; services: { id: string; name: string }[] }
  | { kind: 'endpoints_without_auth'; endpoints: EndpointHit[] }
  | { kind: 'endpoints_throwing'; status: number; endpoints: EndpointHit[] }
  | { kind: 'services_using_database'; databaseId: string; services: { id: string; name: string }[] }
  | { kind: 'services_without_owners'; services: { id: string; name: string }[] }
  | { kind: 'unresolved_external_calls'; calls: { externalCallId: string; serviceId: string; method?: string; path?: string; reason?: string }[] }
  | { kind: 'duplicate_db_operations'; duplicates: DuplicateDbOp[] };

export interface EndpointHit {
  endpointId: string;
  serviceId: string;
  serviceName: string;
  method?: string;
  path?: string;
}

export interface DuplicateDbOp {
  database: string;
  table: string;
  operation: string;
  occurrences: { serviceId: string; nodeId: string }[];
}

/**
 * Single entrypoint: dispatches to the matching query implementation.
 * Pure — no LLM, no FS, no network. Each implementation walks the topology
 * directly so adding new queries doesn't require shared infrastructure.
 */
export function runTopologyQuery(query: TopologyQuery, topology: SystemTopology): QueryResult {
  switch (query.kind) {
    case 'cycles':                    return queryCycles(topology);
    case 'orphan_services':           return queryOrphanServices(topology);
    case 'endpoints_without_auth':    return queryEndpointsWithoutAuth(topology);
    case 'endpoints_throwing':        return queryEndpointsThrowing(topology, query.status);
    case 'services_using_database':   return queryServicesUsingDatabase(topology, query.databaseId);
    case 'services_without_owners':   return queryServicesWithoutOwners(topology);
    case 'unresolved_external_calls': return queryUnresolvedExternalCalls(topology);
    case 'duplicate_db_operations':   return queryDuplicateDbOperations(topology);
  }
}

// ── Query implementations ─────────────────────────────────────────────

/**
 * Cycles in the service→service call graph. Uses Tarjan's SCC algorithm to
 * find strongly-connected components, then keeps only components of size ≥ 2
 * (a singleton with a self-loop is rare and would need a separate flag).
 *
 * Edge source: `edges` of kind `resolves_to` whose source is a service id and
 * whose target is a service id. We tolerate the metadata.targetServiceId hint
 * used by the cross-service merger when the literal target points at an
 * external call.
 */
function queryCycles(topology: SystemTopology): QueryResult {
  const adj = buildServiceAdjacency(topology);
  const sccs = tarjanSCC(adj);
  const cycles = sccs.filter(c => c.length >= 2);
  return { kind: 'cycles', cycles };
}

function buildServiceAdjacency(topology: SystemTopology): Map<string, Set<string>> {
  const services = new Set(topology.services.map(s => s.id));
  const adj = new Map<string, Set<string>>();
  for (const id of services) adj.set(id, new Set());

  for (const edge of topology.edges) {
    if (edge.kind !== 'resolves_to') continue;
    const target = (edge.metadata as any)?.targetServiceId ?? edge.target;
    // Source: literal id might be an externalCall — resolve back to its owning service
    const sourceServiceId = findServiceForNode(topology, edge.source) ?? edge.source;
    if (services.has(sourceServiceId) && services.has(target)) {
      adj.get(sourceServiceId)!.add(target);
    }
  }
  return adj;
}

function findServiceForNode(topology: SystemTopology, nodeId: string): string | null {
  for (const svc of topology.services) {
    if (svc.id === nodeId) return svc.id;
    if (containsNodeId(svc.endpoints, nodeId) || containsNodeId(svc.functions, nodeId)) {
      return svc.id;
    }
  }
  return null;
}

function containsNodeId(nodes: CodeNode[], id: string): boolean {
  for (const n of nodes) {
    if (n.id === id) return true;
    if (n.children?.length && containsNodeId(n.children, id)) return true;
  }
  return false;
}

/** Iterative Tarjan — avoids deep recursion stack on large graphs. */
function tarjanSCC(adj: Map<string, Set<string>>): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  function strongconnect(start: string): void {
    const callStack: { v: string; iter: Iterator<string> }[] = [];
    indices.set(start, index);
    lowlink.set(start, index);
    index++;
    stack.push(start);
    onStack.add(start);
    callStack.push({ v: start, iter: adj.get(start)!.values() });

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      const next = frame.iter.next();
      if (next.done) {
        if (lowlink.get(frame.v) === indices.get(frame.v)) {
          const scc: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            scc.push(w);
          } while (w !== frame.v);
          result.push(scc);
        }
        callStack.pop();
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1].v;
          lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(frame.v)!));
        }
      } else {
        const w = next.value;
        if (!indices.has(w)) {
          indices.set(w, index);
          lowlink.set(w, index);
          index++;
          stack.push(w);
          onStack.add(w);
          callStack.push({ v: w, iter: adj.get(w)!.values() });
        } else if (onStack.has(w)) {
          lowlink.set(frame.v, Math.min(lowlink.get(frame.v)!, indices.get(w)!));
        }
      }
    }
  }

  for (const v of adj.keys()) {
    if (!indices.has(v)) strongconnect(v);
  }
  return result;
}

/**
 * Services with zero incoming `resolves_to` edges from another service.
 * Useful to find "leaf" / unused services. Excludes self-loops.
 */
function queryOrphanServices(topology: SystemTopology): QueryResult {
  const adj = buildServiceAdjacency(topology);
  const incoming = new Map<string, number>();
  for (const id of adj.keys()) incoming.set(id, 0);
  for (const [src, targets] of adj) {
    for (const t of targets) {
      if (t === src) continue;
      incoming.set(t, (incoming.get(t) ?? 0) + 1);
    }
  }
  const services = topology.services
    .filter(s => (incoming.get(s.id) ?? 0) === 0)
    .map(s => ({ id: s.id, name: s.name }));
  return { kind: 'orphan_services', services };
}

/**
 * Endpoints whose `metadata.auth` is absent or explicitly `none`. Treats anything
 * truthy/non-empty as "auth required" — projects encode this differently
 * (e.g. {required:true}, "jwt", an array of guards) and we don't want to be picky here.
 */
function queryEndpointsWithoutAuth(topology: SystemTopology): QueryResult {
  const hits: EndpointHit[] = [];
  for (const svc of topology.services) {
    for (const ep of svc.endpoints) {
      if (!hasAuth(ep)) hits.push(toHit(svc, ep));
    }
  }
  return { kind: 'endpoints_without_auth', endpoints: hits };
}

function hasAuth(ep: EndpointNode): boolean {
  const auth: any = (ep.metadata as any).auth;
  if (auth === undefined || auth === null) return false;
  if (auth === 'none' || auth === false) return false;
  if (Array.isArray(auth)) return auth.length > 0;
  if (typeof auth === 'object') {
    if (auth.required === false) return false;
    return Object.keys(auth).length > 0;
  }
  return Boolean(auth);
}

/** Endpoints whose subtree contains a `throw` node with the given httpStatus. */
function queryEndpointsThrowing(topology: SystemTopology, status: number): QueryResult {
  const hits: EndpointHit[] = [];
  for (const svc of topology.services) {
    for (const ep of svc.endpoints) {
      const statuses = collectThrowStatuses(ep);
      if (statuses.has(status)) hits.push(toHit(svc, ep));
    }
  }
  return { kind: 'endpoints_throwing', status, endpoints: hits };
}

function collectThrowStatuses(node: CodeNode): Set<number> {
  const out = new Set<number>();
  function walk(n: CodeNode) {
    if (n.type === 'throw' && typeof (n as ThrowNode).metadata.httpStatus === 'number') {
      out.add((n as ThrowNode).metadata.httpStatus!);
    }
    if (n.children?.length) n.children.forEach(walk);
  }
  walk(node);
  return out;
}

/** Services that depend on a given database id (via `dependencies[].id` matching). */
function queryServicesUsingDatabase(topology: SystemTopology, databaseId: string): QueryResult {
  const services = topology.services
    .filter(s => s.dependencies?.some(dep => dep.id === databaseId && dep.targetKind === 'database'))
    .map(s => ({ id: s.id, name: s.name }));
  return { kind: 'services_using_database', databaseId, services };
}

/** Services with no entry in the ownership graph (i.e. no CODEOWNERS coverage). */
function queryServicesWithoutOwners(topology: SystemTopology): QueryResult {
  const ownership = topology.ownership;
  const owned = new Set<string>();
  if (ownership) {
    for (const e of ownership.edges) {
      if (e.targetKind === 'service') owned.add(e.targetId);
    }
  }
  const services = topology.services
    .filter(s => !owned.has(s.id))
    .map(s => ({ id: s.id, name: s.name }));
  return { kind: 'services_without_owners', services };
}

/** External call nodes whose `metadata.mergeStatus` isn't `'resolved'`. */
function queryUnresolvedExternalCalls(topology: SystemTopology): QueryResult {
  const calls: { externalCallId: string; serviceId: string; method?: string; path?: string; reason?: string }[] = [];
  for (const svc of topology.services) {
    walkAll([...svc.endpoints, ...svc.functions], n => {
      if (n.type !== 'externalCall') return;
      const ec = n as ExternalCallNode;
      const status = ec.metadata.mergeStatus;
      if (status === 'resolved') return;
      calls.push({
        externalCallId: ec.id,
        serviceId: svc.id,
        method: ec.metadata.method,
        path: ec.metadata.path,
        reason: status ?? 'unknown',
      });
    });
  }
  return { kind: 'unresolved_external_calls', calls };
}

/**
 * Same (database, table, operation) tuple touched by ≥ 2 different services. Strong
 * smell of duplicated logic that could share a service or repository.
 */
function queryDuplicateDbOperations(topology: SystemTopology): QueryResult {
  const groups = new Map<string, { serviceId: string; nodeId: string }[]>();
  for (const svc of topology.services) {
    walkAll([...svc.endpoints, ...svc.functions], n => {
      if (n.type !== 'dbProcess') return;
      const proc = n as DbProcessNode;
      const db = (proc.metadata as any).database ?? (proc.metadata as any).connectionAlias;
      const table = (proc.metadata as any).table;
      const op = (proc.metadata as any).operation;
      if (!db || !table || !op) return;
      const key = `${db}::${table}::${op}`;
      const list = groups.get(key) ?? [];
      // Don't double-count multiple occurrences inside the same service
      if (!list.some(o => o.serviceId === svc.id)) {
        list.push({ serviceId: svc.id, nodeId: proc.id });
      }
      groups.set(key, list);
    });
  }
  const duplicates: DuplicateDbOp[] = [];
  for (const [key, occ] of groups) {
    if (occ.length < 2) continue;
    const [database, table, operation] = key.split('::');
    duplicates.push({ database, table, operation, occurrences: occ });
  }
  return { kind: 'duplicate_db_operations', duplicates };
}

// ── Internal helpers ──────────────────────────────────────────────────

function walkAll(nodes: CodeNode[], visit: (n: CodeNode) => void): void {
  for (const n of nodes) {
    visit(n);
    if (n.children?.length) walkAll(n.children, visit);
  }
}

function toHit(svc: ServiceNode, ep: EndpointNode): EndpointHit {
  return {
    endpointId: ep.id,
    serviceId: svc.id,
    serviceName: svc.name,
    method: ep.metadata.method,
    path: ep.metadata.path,
  };
}
