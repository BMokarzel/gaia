import type {
  SystemTopology, ServiceNode, EndpointNode, FunctionNode,
  DbProcessNode, ExternalCallNode, EventNode, ReturnNode, ThrowNode,
  FlowControlNode, LogNode, TelemetryNode, DataNode, CallNode,
  CodeNode, Edge, GraphValidationIssue, Diagnostic,
} from '../types/topology';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs all three deterministic validation layers against a topology.
 * Returns issues as Diagnostic entries so they can be merged into
 * context.diagnostics before the topology is written to disk.
 */
export function validateTopology(topology: SystemTopology): Diagnostic[] {
  const issues: GraphValidationIssue[] = [];

  // Layer 1 — Schema: per-node-type field checks
  validateSchema(topology, issues);

  // Layer 2 — Graph integrity: edge referential integrity, self-loops, duplicates
  validateGraphIntegrity(topology, issues);

  // Layer 3 — Flow graph: endpoint termination, branch coverage
  validateFlowGraph(topology, issues);

  return issues.map(issueToDiagnostic);
}

// ── Layer 1: Schema ───────────────────────────────────────────────────────────

function validateSchema(topology: SystemTopology, issues: GraphValidationIssue[]): void {
  for (const svc of topology.services) {
    validateService(svc, issues);
  }

  for (const db of topology.databases) {
    if (!db.id) issue(issues, 'error', 'DatabaseNode missing id', { field: 'id' });
    if (!db.name) issue(issues, 'warning', `DatabaseNode "${db.id}" missing name`, { nodeId: db.id, field: 'name' });
    if (!db.metadata.engine) issue(issues, 'error', `DatabaseNode "${db.id}" missing engine`, { nodeId: db.id, field: 'metadata.engine' });
    if (!db.metadata.connectionAlias) issue(issues, 'error', `DatabaseNode "${db.id}" missing connectionAlias`, { nodeId: db.id, field: 'metadata.connectionAlias' });
  }

  for (const broker of topology.brokers) {
    if (!broker.id) issue(issues, 'error', 'BrokerNode missing id', { field: 'id' });
    if (!broker.name) issue(issues, 'warning', `BrokerNode "${broker.id}" missing name`, { nodeId: broker.id, field: 'name' });
    if (!broker.metadata.engine) issue(issues, 'error', `BrokerNode "${broker.id}" missing engine`, { nodeId: broker.id, field: 'metadata.engine' });
    if (!broker.metadata.connectionAlias) issue(issues, 'error', `BrokerNode "${broker.id}" missing connectionAlias`, { nodeId: broker.id, field: 'metadata.connectionAlias' });
  }

  for (const screen of topology.screens) {
    if (!screen.id) issue(issues, 'error', 'ScreenNode missing id', { field: 'id' });
    if (!screen.name) issue(issues, 'warning', `ScreenNode "${screen.id}" missing name`, { nodeId: screen.id, field: 'name' });
    if (!screen.metadata.filePath) issue(issues, 'warning', `ScreenNode "${screen.id}" missing filePath`, { nodeId: screen.id, field: 'metadata.filePath' });
  }
}

function validateService(svc: ServiceNode, issues: GraphValidationIssue[]): void {
  if (!svc.id) { issue(issues, 'error', 'ServiceNode missing id', { field: 'id' }); return; }
  if (!svc.name) issue(issues, 'error', `ServiceNode "${svc.id}" missing name`, { nodeId: svc.id, field: 'name' });
  if (!svc.code) issue(issues, 'warning', `ServiceNode "${svc.id}" missing code (sigla)`, { nodeId: svc.id, field: 'code' });

  const kind = svc.metadata.kind;
  const isFrontend = kind === 'frontend' || kind === 'microfrontend' || kind === 'mobile';

  // Frontend services should not have endpoints
  if (isFrontend && svc.endpoints.length > 0) {
    issue(issues, 'warning',
      `Frontend ServiceNode "${svc.name}" has ${svc.endpoints.length} endpoint(s) — frontend services should use screens, not endpoints`,
      { nodeId: svc.id, field: 'endpoints', suggestion: 'Move endpoints to screens[] or change the service kind' });
  }

  for (const ep of svc.endpoints) validateEndpoint(ep, svc, issues);
  for (const fn of svc.functions) validateFunction(fn, svc, issues);

  for (const fn of svc.functions) {
    walkCodeNodes(fn.children, (node) => validateCodeNode(node, svc, issues));
  }
  for (const ep of svc.endpoints) {
    walkCodeNodes(ep.children, (node) => validateCodeNode(node, svc, issues));
  }
}

function validateEndpoint(ep: EndpointNode, svc: ServiceNode, issues: GraphValidationIssue[]): void {
  if (!ep.id) { issue(issues, 'error', `EndpointNode in "${svc.name}" missing id`, { nodeId: svc.id }); return; }
  if (!ep.metadata.method) {
    issue(issues, 'error', `EndpointNode "${ep.id}" missing method`, { nodeId: ep.id, field: 'metadata.method' });
  } else {
    const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
    if (!validMethods.includes(ep.metadata.method)) {
      issue(issues, 'error', `EndpointNode "${ep.id}" has invalid method "${ep.metadata.method}"`, { nodeId: ep.id, field: 'metadata.method' });
    }
  }
  if (!ep.metadata.path) {
    issue(issues, 'error', `EndpointNode "${ep.id}" missing path`, { nodeId: ep.id, field: 'metadata.path' });
  }
  if (!ep.location?.file) {
    issue(issues, 'warning', `EndpointNode "${ep.id}" missing location.file`, { nodeId: ep.id, field: 'location.file' });
  }
}

function validateFunction(fn: FunctionNode, svc: ServiceNode, issues: GraphValidationIssue[]): void {
  if (!fn.id) { issue(issues, 'error', `FunctionNode in "${svc.name}" missing id`, { nodeId: svc.id }); return; }
  if (!fn.name) {
    issue(issues, 'warning', `FunctionNode "${fn.id}" missing name`, { nodeId: fn.id, field: 'name' });
  }
  const validKinds = ['declaration', 'expression', 'arrow', 'method', 'constructor', 'getter', 'setter'];
  if (fn.metadata.kind && !validKinds.includes(fn.metadata.kind)) {
    issue(issues, 'warning', `FunctionNode "${fn.id}" has unexpected kind "${fn.metadata.kind}"`, { nodeId: fn.id, field: 'metadata.kind' });
  }
}

function validateCodeNode(node: CodeNode, svc: ServiceNode, issues: GraphValidationIssue[]): void {
  if (!node.id) {
    issue(issues, 'error', `CodeNode of type "${node.type}" in "${svc.name}" missing id`, { nodeId: svc.id });
    return;
  }

  switch (node.type) {
    case 'dbProcess': {
      const db = node as DbProcessNode;
      if (!db.metadata.databaseId) {
        issue(issues, 'warning', `DbProcessNode "${db.id}" missing databaseId`, { nodeId: db.id, field: 'metadata.databaseId' });
      }
      if (!db.metadata.operation) {
        issue(issues, 'warning', `DbProcessNode "${db.id}" missing operation`, { nodeId: db.id, field: 'metadata.operation' });
      }
      break;
    }
    case 'externalCall': {
      const ec = node as ExternalCallNode;
      if (!ec.metadata.method) {
        issue(issues, 'warning', `ExternalCallNode "${ec.id}" missing method`, { nodeId: ec.id, field: 'metadata.method' });
      }
      if (!ec.metadata.path) {
        issue(issues, 'warning', `ExternalCallNode "${ec.id}" missing path`, { nodeId: ec.id, field: 'metadata.path' });
      }
      break;
    }
    case 'event': {
      const ev = node as EventNode;
      if (!ev.metadata.eventName) {
        issue(issues, 'warning', `EventNode "${ev.id}" missing eventName`, { nodeId: ev.id, field: 'metadata.eventName' });
      }
      break;
    }
    case 'log': {
      const ln = node as LogNode;
      const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'log'];
      if (ln.metadata.level && !validLevels.includes(ln.metadata.level)) {
        issue(issues, 'warning', `LogNode "${ln.id}" has invalid level "${ln.metadata.level}"`, { nodeId: ln.id, field: 'metadata.level' });
      }
      break;
    }
    case 'telemetry': {
      const tn = node as TelemetryNode;
      const validKinds = ['span', 'metric', 'trace', 'event', 'baggage', 'context'];
      if (tn.metadata.kind && !validKinds.includes(tn.metadata.kind)) {
        issue(issues, 'warning', `TelemetryNode "${tn.id}" has invalid kind "${tn.metadata.kind}"`, { nodeId: tn.id, field: 'metadata.kind' });
      }
      break;
    }
    case 'flowControl': {
      const fc = node as FlowControlNode;
      if (!fc.metadata.kind) {
        issue(issues, 'warning', `FlowControlNode "${fc.id}" missing kind`, { nodeId: fc.id, field: 'metadata.kind' });
      }
      break;
    }
  }
}

// ── Layer 2: Graph integrity ──────────────────────────────────────────────────

function validateGraphIntegrity(topology: SystemTopology, issues: GraphValidationIssue[]): void {
  // Build global node ID set
  const nodeIds = buildNodeIdSet(topology);

  const edgeKeys = new Set<string>();

  for (const edge of topology.edges) {
    // Required fields
    if (!edge.source) {
      issue(issues, 'error', 'Edge missing source', { field: 'source' });
      continue;
    }
    if (!edge.target) {
      issue(issues, 'error', 'Edge missing target', { field: 'target' });
      continue;
    }
    if (!edge.kind) {
      issue(issues, 'error', `Edge ${edge.source} → ${edge.target} missing kind`, { edgeSource: edge.source, edgeTarget: edge.target });
    }

    // Self-loops
    if (edge.source === edge.target) {
      issue(issues, 'warning', `Self-loop edge detected on node "${edge.source}"`, {
        edgeSource: edge.source, edgeTarget: edge.target,
        suggestion: 'Remove this edge — a node should not call itself',
      });
    }

    // Referential integrity — warn only (some edges may reference external/provisioned nodes)
    if (!nodeIds.has(edge.source)) {
      issue(issues, 'warning', `Edge source "${edge.source}" not found in topology node index`, {
        edgeSource: edge.source, edgeTarget: edge.target, field: 'source',
      });
    }
    if (!nodeIds.has(edge.target)) {
      issue(issues, 'warning', `Edge target "${edge.target}" not found in topology node index`, {
        edgeSource: edge.source, edgeTarget: edge.target, field: 'target',
      });
    }

    // Duplicates
    const key = `${edge.source}→${edge.target}:${edge.kind}`;
    if (edgeKeys.has(key)) {
      issue(issues, 'info', `Duplicate edge: ${edge.source} →[${edge.kind}]→ ${edge.target}`, {
        edgeSource: edge.source, edgeTarget: edge.target,
      });
    }
    edgeKeys.add(key);

    // Metadata requirements per kind
    if (edge.kind === 'reads_from' || edge.kind === 'writes_to') {
      if (!edge.metadata?.operation) {
        issue(issues, 'info', `Edge ${edge.source} →[${edge.kind}]→ ${edge.target} missing metadata.operation`, {
          edgeSource: edge.source, edgeTarget: edge.target, field: 'metadata.operation',
        });
      }
    }
    if (edge.kind === 'publishes_to' || edge.kind === 'consumes_from') {
      if (!edge.metadata?.topic) {
        issue(issues, 'info', `Edge ${edge.source} →[${edge.kind}]→ ${edge.target} missing metadata.topic`, {
          edgeSource: edge.source, edgeTarget: edge.target, field: 'metadata.topic',
        });
      }
    }
  }

  // Check: every endpoint should have at least one outgoing edge (calls / reads_from / writes_to)
  const edgeSources = new Set(topology.edges.map(e => e.source));
  for (const svc of topology.services) {
    for (const ep of svc.endpoints) {
      if (!edgeSources.has(ep.id)) {
        issue(issues, 'info', `EndpointNode "${ep.id}" (${ep.metadata.method} ${ep.metadata.path}) has no outgoing edges — may be a stub or dead endpoint`, {
          nodeId: ep.id,
          suggestion: 'Verify this endpoint has a handler function',
        });
      }
    }
  }
}

function buildNodeIdSet(topology: SystemTopology): Set<string> {
  const ids = new Set<string>();

  for (const svc of topology.services) {
    ids.add(svc.id);
    for (const ep of svc.endpoints) addCodeNodeIds(ep, ids);
    for (const fn of svc.functions) addCodeNodeIds(fn, ids);
    for (const g of svc.globals) addCodeNodeIds(g, ids);
  }
  for (const db of topology.databases) {
    ids.add(db.id);
    for (const t of db.tables) ids.add(t.id);
  }
  for (const broker of topology.brokers) ids.add(broker.id);
  for (const storage of topology.storages) ids.add(storage.id);
  for (const screen of topology.screens) {
    ids.add(screen.id);
    addComponentIds(screen.components, ids);
  }

  return ids;
}

function addCodeNodeIds(node: CodeNode | { id: string; children: CodeNode[] }, ids: Set<string>): void {
  ids.add(node.id);
  for (const child of node.children) {
    addCodeNodeIds(child, ids);
  }
}

function addComponentIds(components: import('../types/topology').ComponentNode[], ids: Set<string>): void {
  for (const c of components) {
    ids.add(c.id);
    for (const ev of c.events) ids.add(ev.id);
    addComponentIds(c.children, ids);
  }
}

// ── Layer 3: Flow graph ───────────────────────────────────────────────────────

function validateFlowGraph(topology: SystemTopology, issues: GraphValidationIssue[]): void {
  for (const svc of topology.services) {
    for (const ep of svc.endpoints) {
      validateEndpointFlow(ep, svc, issues);
    }
  }
}

function validateEndpointFlow(ep: EndpointNode, svc: ServiceNode, issues: GraphValidationIssue[]): void {
  if (ep.children.length === 0) return; // Stub endpoint — already flagged by graph integrity

  // Check: all execution leaves should be return or throw nodes
  const leaves = collectLeaves(ep.children);
  const nonTerminalLeaves = leaves.filter(n => n.type !== 'return' && n.type !== 'throw');

  if (nonTerminalLeaves.length > 0 && leaves.length > 0) {
    // Check if any leaf IS terminal — if all branches have at least one return/throw, that's acceptable
    const terminalLeaves = leaves.filter(n => n.type === 'return' || n.type === 'throw');
    if (terminalLeaves.length === 0) {
      issue(issues, 'warning',
        `EndpointNode "${ep.id}" (${ep.metadata.method} ${ep.metadata.path}) has no return or throw nodes — may lack proper termination`,
        { nodeId: ep.id, suggestion: 'Add explicit return or throw nodes to all execution paths' });
    }
  }

  // Check: FlowControl nodes should have children (non-empty branches)
  walkCodeNodes(ep.children, (node) => {
    if (node.type === 'flowControl') {
      const fc = node as FlowControlNode;
      if (fc.children.length === 0 && fc.metadata.branches?.length === 0) {
        issue(issues, 'info',
          `FlowControlNode "${fc.id}" (${fc.metadata.kind}) in endpoint "${ep.id}" has no children or branches`,
          { nodeId: fc.id, suggestion: 'This branch may have been extracted incorrectly' });
      }
    }
  });

  // Check: try blocks should have a corresponding catch
  validateTryCatch(ep.children, ep.id, issues);
}

function collectLeaves(nodes: CodeNode[]): CodeNode[] {
  const leaves: CodeNode[] = [];
  for (const node of nodes) {
    // flowControl children can branch — don't treat the fc itself as a leaf
    if (node.type === 'flowControl') {
      const fc = node as FlowControlNode;
      // Recurse into branches
      if (fc.metadata.branches && fc.metadata.branches.length > 0) {
        for (const branch of fc.metadata.branches) {
          leaves.push(...collectLeaves(branch.children));
        }
      }
      if (fc.children.length > 0) {
        leaves.push(...collectLeaves(fc.children));
      }
    } else if (node.children.length > 0) {
      leaves.push(...collectLeaves(node.children));
    } else {
      leaves.push(node);
    }
  }
  return leaves;
}

function validateTryCatch(nodes: CodeNode[], contextId: string, issues: GraphValidationIssue[]): void {
  for (const node of nodes) {
    if (node.type === 'flowControl') {
      const fc = node as FlowControlNode;
      if (fc.metadata.kind === 'try') {
        const siblings = nodes;
        const hasCatch = siblings.some(s =>
          s.type === 'flowControl' &&
          (s as FlowControlNode).metadata.kind === 'catch'
        ) || fc.children.some(c =>
          c.type === 'flowControl' &&
          (c as FlowControlNode).metadata.kind === 'catch'
        );

        if (!hasCatch) {
          issue(issues, 'info',
            `Try block "${fc.id}" in "${contextId}" has no corresponding catch — unhandled rejections possible`,
            { nodeId: fc.id, suggestion: 'Add a catch block or ensure errors propagate intentionally' });
        }
      }
    }
    if (node.children.length > 0) {
      validateTryCatch(node.children, contextId, issues);
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function walkCodeNodes(nodes: CodeNode[], visitor: (node: CodeNode) => void): void {
  for (const node of nodes) {
    visitor(node);
    if (node.children.length > 0) walkCodeNodes(node.children, visitor);
  }
}

function issue(
  issues: GraphValidationIssue[],
  severity: GraphValidationIssue['severity'],
  description: string,
  extra: Partial<GraphValidationIssue> = {},
): void {
  issues.push({ severity, description, ...extra });
}

function issueToDiagnostic(i: GraphValidationIssue): Diagnostic {
  const parts: string[] = [i.description];
  if (i.suggestion) parts.push(`Suggestion: ${i.suggestion}`);
  if (i.nodeId) parts.push(`Node: ${i.nodeId}`);
  if (i.edgeSource) parts.push(`Edge: ${i.edgeSource} → ${i.edgeTarget}`);

  const level: Diagnostic['level'] =
    i.severity === 'error' ? 'error' :
    i.severity === 'warning' ? 'warning' : 'info';

  return {
    level,
    message: parts.join(' | '),
    rule: i.field ?? undefined,
  };
}
