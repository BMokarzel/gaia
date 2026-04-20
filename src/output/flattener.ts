import type {
  SystemTopology,
  ServiceNode,
  DatabaseNode,
  BrokerNode,
  StorageNode,
  ScreenNode,
  ComponentNode,
  BaseCodeNode,
  Edge,
} from '../types/topology';

export interface FlatNode {
  id: string;
  type: string;
  labels: string[];
  props: Record<string, unknown>;
}

export interface FlatEdge {
  from: string;
  to: string;
  kind: string;
  props?: Record<string, unknown>;
}

export interface FlatTopology {
  schemaVersion: string;
  analyzedAt: string;
  nodes: FlatNode[];
  edges: FlatEdge[];
}

export function flattenTopology(topology: SystemTopology): FlatTopology {
  const nodes: FlatNode[] = [];
  const edges: FlatEdge[] = [];

  // ── Services ──────────────────────────────────────────────
  for (const svc of topology.services) {
    nodes.push(serviceNode(svc));

    for (const ep of svc.endpoints) {
      nodes.push(codeNode(ep, 'Endpoint'));
      edges.push(containsEdge(svc.id, ep.id));
      collectCodeChildren(ep, nodes, edges);
    }

    for (const fn of svc.functions) {
      nodes.push(codeNode(fn, 'Function'));
      edges.push(containsEdge(svc.id, fn.id));
      collectCodeChildren(fn, nodes, edges);
    }

    for (const g of svc.globals) {
      nodes.push(codeNode(g, 'Data'));
      edges.push(containsEdge(svc.id, g.id));
    }
  }

  // ── Databases ─────────────────────────────────────────────
  for (const db of topology.databases) {
    nodes.push(databaseNode(db));

    for (const table of db.tables) {
      const { columns: _cols, ...tableRest } = table as any;
      nodes.push({
        id: table.id,
        type: 'table',
        labels: ['Table'],
        props: { name: table.name, ...tableRest.metadata },
      });
      edges.push(containsEdge(db.id, table.id));

      // ColumnNodes
      for (const col of table.columns ?? []) {
        nodes.push({
          id: col.id,
          type: 'column',
          labels: ['Column'],
          props: { name: col.name, ...col.metadata },
        });
        edges.push(containsEdge(table.id, col.id));
      }
    }
  }

  // ── Brokers ───────────────────────────────────────────────
  for (const broker of topology.brokers) {
    nodes.push(brokerNode(broker));
  }

  // ── Storages ──────────────────────────────────────────────
  for (const storage of topology.storages) {
    nodes.push({
      id: storage.id,
      type: 'storage',
      labels: ['Storage'],
      props: { name: storage.name, ...storage.metadata },
    });
  }

  // ── Screens ───────────────────────────────────────────────
  for (const screen of topology.screens) {
    nodes.push(screenNode(screen));
    for (const comp of screen.components) {
      collectComponents(comp, screen.id, nodes, edges);
    }
  }

  // ── Existing semantic edges ────────────────────────────────
  for (const e of topology.edges) {
    edges.push(semanticEdge(e));
  }

  return {
    schemaVersion: `${topology.schemaVersion}-flat`,
    analyzedAt: topology.analyzedAt,
    nodes,
    edges,
  };
}

// ── Node builders ──────────────────────────────────────────

function serviceNode(svc: ServiceNode): FlatNode {
  const { endpoints: _ep, functions: _fn, globals: _gl, dependencies: _dep, ...rest } = svc;
  return {
    id: svc.id,
    type: 'service',
    labels: ['Service'],
    props: { name: rest.name, ...rest.metadata },
  };
}

function databaseNode(db: DatabaseNode): FlatNode {
  const { tables: _t, ...rest } = db;
  return {
    id: db.id,
    type: 'database',
    labels: ['Database'],
    props: { name: rest.name, ...rest.metadata },
  };
}

function brokerNode(broker: BrokerNode): FlatNode {
  return {
    id: broker.id,
    type: 'broker',
    labels: ['Broker'],
    props: { name: broker.name, ...broker.metadata },
  };
}

function screenNode(screen: ScreenNode): FlatNode {
  const { components: _c, navigatesTo: _n, ...rest } = screen;
  return {
    id: screen.id,
    type: 'screen',
    labels: ['Screen'],
    props: { name: rest.name, ...rest.metadata },
  };
}

function codeNode(node: BaseCodeNode, label: string): FlatNode {
  const { children: _ch, ...rest } = node;
  return {
    id: node.id,
    type: node.type,
    labels: [label, 'Code'],
    props: { name: rest.name, location: rest.location, ...rest.metadata },
  };
}

const CODE_LABEL: Record<string, string> = {
  call: 'Call',
  return: 'Return',
  throw: 'Throw',
  dbProcess: 'DbProcess',
  event: 'Event',
  log: 'Log',
  telemetry: 'Telemetry',
  process: 'Process',
  flowControl: 'FlowControl',
  data: 'Data',
  externalCall: 'ExternalCall',
};

function collectCodeChildren(
  node: BaseCodeNode,
  nodes: FlatNode[],
  edges: FlatEdge[],
): void {
  for (const child of node.children) {
    const label = CODE_LABEL[child.type] ?? 'Code';
    nodes.push(codeNode(child as BaseCodeNode, label));
    edges.push(containsEdge(node.id, child.id));

    // call → resolvedTo function edge
    if (child.type === 'call') {
      const resolved = (child.metadata as Record<string, unknown>).resolvedTo as string | undefined;
      if (resolved) {
        edges.push({ from: child.id, to: resolved, kind: 'RESOLVES' });
      }
    }

    collectCodeChildren(child as BaseCodeNode, nodes, edges);
  }
}

function collectComponents(
  comp: ComponentNode,
  parentId: string,
  nodes: FlatNode[],
  edges: FlatEdge[],
): void {
  const { children: _ch, events: _ev, ...rest } = comp;
  nodes.push({
    id: comp.id,
    type: 'component',
    labels: ['Component'],
    props: { name: rest.name, ...rest.metadata },
  });
  edges.push(containsEdge(parentId, comp.id));

  for (const child of comp.children) {
    collectComponents(child, comp.id, nodes, edges);
  }
}

// ── Edge builders ──────────────────────────────────────────

function containsEdge(fromId: string, toId: string): FlatEdge {
  return { from: fromId, to: toId, kind: 'CONTAINS' };
}

function semanticEdge(e: Edge): FlatEdge {
  return {
    from: e.from,
    to: e.to,
    kind: e.kind.toUpperCase(),
    ...(e.metadata ? { props: e.metadata } : {}),
  };
}
