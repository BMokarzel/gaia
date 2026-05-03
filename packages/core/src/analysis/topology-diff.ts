import type {
  SystemTopology, ServiceNode, EndpointNode, DatabaseNode, Edge,
} from '../types/topology';

// ─────────────────────────────────────────────────────────────
// Structural diff between two SystemTopology snapshots.
// Compares by stable IDs; tracks added/removed/modified at the
// service, endpoint, database and edge levels. Pure function —
// no I/O, no LLM calls.
// ─────────────────────────────────────────────────────────────

export interface DiffRef {
  id: string;
  name: string;
}

export interface EndpointDiffRef {
  id: string;
  method: string;
  path: string;
}

export interface EndpointModification {
  id: string;
  method: string;
  path: string;
  changes: string[];
}

export interface ServiceModification {
  id: string;
  name: string;
  endpoints: {
    added: EndpointDiffRef[];
    removed: EndpointDiffRef[];
    modified: EndpointModification[];
  };
  databases: {
    added: string[];
    removed: string[];
  };
  /** Top-level service metadata changes (language/framework/team) */
  changes: string[];
}

export interface EdgeDiffRef {
  source: string;
  target: string;
  kind: string;
}

export interface TopologyDiff {
  from: { sha: string; analyzedAt?: string };
  to:   { sha: string; analyzedAt?: string };
  services: {
    added: DiffRef[];
    removed: DiffRef[];
    modified: ServiceModification[];
  };
  databases: {
    added: DiffRef[];
    removed: DiffRef[];
  };
  edges: {
    added: EdgeDiffRef[];
    removed: EdgeDiffRef[];
  };
  summary: {
    totalChanges: number;
    servicesAdded: number;
    servicesRemoved: number;
    servicesModified: number;
    endpointsAdded: number;
    endpointsRemoved: number;
    endpointsModified: number;
  };
}

export function computeTopologyDiff(
  fromTopology: SystemTopology,
  toTopology: SystemTopology,
  meta: { fromSha: string; toSha: string; fromAnalyzedAt?: string; toAnalyzedAt?: string },
): TopologyDiff {
  const fromServices = indexById(fromTopology.services);
  const toServices = indexById(toTopology.services);

  const addedSvc: ServiceNode[] = [];
  const removedSvc: ServiceNode[] = [];
  const modifiedSvc: ServiceModification[] = [];

  for (const [id, fromSvc] of fromServices) {
    const toSvc = toServices.get(id);
    if (!toSvc) { removedSvc.push(fromSvc); continue; }
    const mod = diffService(fromSvc, toSvc);
    if (mod) modifiedSvc.push(mod);
  }
  for (const [id, toSvc] of toServices) {
    if (!fromServices.has(id)) addedSvc.push(toSvc);
  }

  const fromDbs = indexById(fromTopology.databases);
  const toDbs = indexById(toTopology.databases);
  const dbAdded: DatabaseNode[] = [];
  const dbRemoved: DatabaseNode[] = [];
  for (const [id, db] of toDbs) if (!fromDbs.has(id)) dbAdded.push(db);
  for (const [id, db] of fromDbs) if (!toDbs.has(id)) dbRemoved.push(db);

  const fromEdges = indexEdges(fromTopology.edges ?? []);
  const toEdges = indexEdges(toTopology.edges ?? []);
  const edgesAdded: EdgeDiffRef[] = [];
  const edgesRemoved: EdgeDiffRef[] = [];
  for (const [k, e] of toEdges) if (!fromEdges.has(k)) edgesAdded.push(toRef(e));
  for (const [k, e] of fromEdges) if (!toEdges.has(k)) edgesRemoved.push(toRef(e));

  const summary = {
    totalChanges:
      addedSvc.length + removedSvc.length + modifiedSvc.length +
      dbAdded.length + dbRemoved.length +
      edgesAdded.length + edgesRemoved.length,
    servicesAdded: addedSvc.length,
    servicesRemoved: removedSvc.length,
    servicesModified: modifiedSvc.length,
    endpointsAdded: modifiedSvc.reduce((n, s) => n + s.endpoints.added.length, 0),
    endpointsRemoved: modifiedSvc.reduce((n, s) => n + s.endpoints.removed.length, 0),
    endpointsModified: modifiedSvc.reduce((n, s) => n + s.endpoints.modified.length, 0),
  };

  return {
    from: { sha: meta.fromSha, ...(meta.fromAnalyzedAt ? { analyzedAt: meta.fromAnalyzedAt } : {}) },
    to:   { sha: meta.toSha,   ...(meta.toAnalyzedAt   ? { analyzedAt: meta.toAnalyzedAt   } : {}) },
    services: {
      added:    addedSvc.map(s => ({ id: s.id, name: s.name })),
      removed:  removedSvc.map(s => ({ id: s.id, name: s.name })),
      modified: modifiedSvc,
    },
    databases: {
      added:   dbAdded.map(d   => ({ id: d.id, name: d.name })),
      removed: dbRemoved.map(d => ({ id: d.id, name: d.name })),
    },
    edges: { added: edgesAdded, removed: edgesRemoved },
    summary,
  };
}

function diffService(from: ServiceNode, to: ServiceNode): ServiceModification | null {
  const fromEps = indexById(from.endpoints);
  const toEps = indexById(to.endpoints);

  const epAdded: EndpointDiffRef[] = [];
  const epRemoved: EndpointDiffRef[] = [];
  const epModified: EndpointModification[] = [];

  for (const [id, fromEp] of fromEps) {
    const toEp = toEps.get(id);
    if (!toEp) {
      epRemoved.push(epRef(fromEp));
      continue;
    }
    const changes = compareEndpoint(fromEp, toEp);
    if (changes.length > 0) {
      epModified.push({
        id: toEp.id,
        method: toEp.metadata.method,
        path: toEp.metadata.path,
        changes,
      });
    }
  }
  for (const [id, toEp] of toEps) {
    if (!fromEps.has(id)) epAdded.push(epRef(toEp));
  }

  // Service-level dependencies on databases
  const fromDeps = new Set((from.dependencies ?? []).filter(d => d.targetKind === 'database').map(d => d.id));
  const toDeps   = new Set((to.dependencies   ?? []).filter(d => d.targetKind === 'database').map(d => d.id));
  const dbAdded: string[] = [];
  const dbRemoved: string[] = [];
  for (const id of toDeps)   if (!fromDeps.has(id)) dbAdded.push(id);
  for (const id of fromDeps) if (!toDeps.has(id))   dbRemoved.push(id);

  // Top-level metadata changes
  const changes: string[] = [];
  if (from.metadata.language !== to.metadata.language) changes.push(`language: ${from.metadata.language ?? '∅'} → ${to.metadata.language ?? '∅'}`);
  if (from.metadata.framework !== to.metadata.framework) changes.push(`framework: ${from.metadata.framework ?? '∅'} → ${to.metadata.framework ?? '∅'}`);
  if (from.metadata.team !== to.metadata.team) changes.push(`team: ${from.metadata.team ?? '∅'} → ${to.metadata.team ?? '∅'}`);
  if (from.name !== to.name) changes.push(`name: ${from.name} → ${to.name}`);

  if (
    epAdded.length === 0 && epRemoved.length === 0 && epModified.length === 0 &&
    dbAdded.length === 0 && dbRemoved.length === 0 &&
    changes.length === 0
  ) {
    return null;
  }

  return {
    id: to.id,
    name: to.name,
    endpoints: { added: epAdded, removed: epRemoved, modified: epModified },
    databases: { added: dbAdded, removed: dbRemoved },
    changes,
  };
}

function compareEndpoint(from: EndpointNode, to: EndpointNode): string[] {
  const out: string[] = [];
  if (from.metadata.method !== to.metadata.method) out.push(`method: ${from.metadata.method} → ${to.metadata.method}`);
  if (from.metadata.path !== to.metadata.path) out.push(`path: ${from.metadata.path} → ${to.metadata.path}`);

  // Throw status set
  const fromThrows = collectThrowStatuses(from);
  const toThrows = collectThrowStatuses(to);
  const addedT = [...toThrows].filter(s => !fromThrows.has(s));
  const removedT = [...fromThrows].filter(s => !toThrows.has(s));
  if (addedT.length || removedT.length) {
    const parts: string[] = [];
    if (addedT.length) parts.push(`+[${addedT.sort().join(',')}]`);
    if (removedT.length) parts.push(`-[${removedT.sort().join(',')}]`);
    out.push(`throws: ${parts.join(' ')}`);
  }

  // External call targets (resolvedEndpointId)
  const fromExt = collectExternalTargets(from);
  const toExt = collectExternalTargets(to);
  const addedE = [...toExt].filter(s => !fromExt.has(s));
  const removedE = [...fromExt].filter(s => !toExt.has(s));
  if (addedE.length || removedE.length) {
    const parts: string[] = [];
    if (addedE.length) parts.push(`+[${addedE.sort().join(',')}]`);
    if (removedE.length) parts.push(`-[${removedE.sort().join(',')}]`);
    out.push(`externals: ${parts.join(' ')}`);
  }

  // Auth changes
  const fromAuth = (from.metadata as any).auth;
  const toAuth = (to.metadata as any).auth;
  const fAuthStr = fromAuth ? JSON.stringify(fromAuth) : '∅';
  const tAuthStr = toAuth ? JSON.stringify(toAuth) : '∅';
  if (fAuthStr !== tAuthStr) out.push(`auth: ${fAuthStr} → ${tAuthStr}`);

  return out;
}

function collectThrowStatuses(ep: EndpointNode): Set<string> {
  const out = new Set<string>();
  walk([ep], (n) => {
    if (n.type === 'throw') {
      const status = (n as any).metadata?.httpStatus ?? (n as any).metadata?.errorClass;
      if (status != null) out.add(String(status));
    }
  });
  return out;
}

function collectExternalTargets(ep: EndpointNode): Set<string> {
  const out = new Set<string>();
  walk([ep], (n) => {
    if (n.type === 'externalCall') {
      const meta = (n as any).metadata ?? {};
      const target = meta.resolvedEndpointId ?? meta.url ?? `${meta.method ?? ''} ${meta.path ?? ''}`.trim();
      if (target) out.add(target);
    }
  });
  return out;
}

function walk(nodes: any[], fn: (n: any) => void): void {
  for (const n of nodes) {
    fn(n);
    if (n.children?.length) walk(n.children, fn);
  }
}

function indexById<T extends { id: string }>(arr: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const x of arr) m.set(x.id, x);
  return m;
}

function indexEdges(edges: Edge[]): Map<string, Edge> {
  const m = new Map<string, Edge>();
  for (const e of edges) m.set(`${e.kind}::${e.source}::${e.target}`, e);
  return m;
}

function epRef(e: EndpointNode): EndpointDiffRef {
  return { id: e.id, method: e.metadata.method, path: e.metadata.path };
}

function toRef(e: Edge): EdgeDiffRef {
  return { source: e.source, target: e.target, kind: e.kind };
}
