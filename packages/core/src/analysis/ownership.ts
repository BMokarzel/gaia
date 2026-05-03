// ============================================================
// Ownership analysis (Fase 3)
// ------------------------------------------------------------
// Builds an OwnershipMap by matching service/endpoint files
// against CODEOWNERS rules. Service-level ownership is derived
// by aggregating endpoint-level matches: the dominant owner
// (most matched files) wins, ties broken by first appearance.
//
// Future sources (git blame, manual config) will plug in here
// by producing additional OwnershipEdge entries with a
// different `source` value and merging into the same map.
// ============================================================

import type {
  ServiceNode,
  EndpointNode,
  OwnerNode,
  OwnershipEdge,
  OwnershipMap,
} from '../types/topology';
import { loadCodeOwners, matchOwners, type ParsedCodeOwners, type CodeOwnersRule } from './codeowners-parser';

interface OwnerInternal {
  node: OwnerNode;
  /** Number of files attributing to this owner across all services. */
  fileCount: number;
}

/**
 * Run ownership analysis on the assembled services. If `parsed` is omitted
 * we attempt to load CODEOWNERS from `repoPath`. When no CODEOWNERS file
 * is found, returns null (caller should leave `topology.ownership`
 * undefined rather than producing an empty map).
 */
export function analyzeOwnership(
  services: ServiceNode[],
  repoPath: string,
  parsed?: ParsedCodeOwners | null,
): OwnershipMap | null {
  const owners = new Map<string, OwnerInternal>();
  const edges: OwnershipEdge[] = [];
  const co = parsed === undefined ? loadCodeOwners(repoPath) : parsed;
  if (!co || co.rules.length === 0) return null;

  for (const service of services) {
    const serviceOwnerCounts = new Map<string, number>();

    for (const endpoint of service.endpoints) {
      const file = endpointFile(endpoint);
      if (!file) continue;
      const rule = matchOwners(co, file);
      if (!rule) continue;

      for (const ownerSpec of rule.owners) {
        const owner = ensureOwner(owners, ownerSpec);
        owner.fileCount++;
        serviceOwnerCounts.set(owner.node.id, (serviceOwnerCounts.get(owner.node.id) ?? 0) + 1);
        edges.push({
          ownerId: owner.node.id,
          targetId: endpoint.id,
          targetKind: 'endpoint',
          kind: 'owns',
          pattern: rule.pattern,
          source: 'codeowners',
        });
      }
    }

    // Service-level edge: the owner that won the most endpoints owns the service.
    const top = pickDominantOwner(serviceOwnerCounts);
    if (top) {
      edges.push({
        ownerId: top,
        targetId: service.id,
        targetKind: 'service',
        kind: 'owns',
        source: 'codeowners',
      });
    }
  }

  return {
    owners: Array.from(owners.values()).map(o => o.node),
    edges,
  };
}

/**
 * Endpoints expose their declaration site via metadata.location.file. Some
 * extractors omit this field when the endpoint is registered indirectly
 * (e.g. Go route registration in main.go without a handler match) — in
 * that case we return null and the endpoint is skipped from ownership.
 */
function endpointFile(endpoint: EndpointNode): string | null {
  const f = (endpoint as { location?: { file?: string } }).location?.file;
  return typeof f === 'string' && f.length > 0 ? f : null;
}

/**
 * Owner spec → OwnerNode with stable id. "@org/team" becomes a team,
 * "@user" becomes a person, an email becomes a person too. Anything else
 * is recorded as a person with the raw spec as both name and handle so
 * the data isn't silently dropped.
 */
function ensureOwner(map: Map<string, OwnerInternal>, spec: string): OwnerInternal {
  const { id, kind, name, email, handle } = classifyOwner(spec);
  const existing = map.get(id);
  if (existing) return existing;
  const node: OwnerNode = {
    id,
    type: 'owner',
    name,
    metadata: {
      kind,
      handle,
      email,
      source: 'codeowners',
    },
  };
  const created: OwnerInternal = { node, fileCount: 0 };
  map.set(id, created);
  return created;
}

interface ClassifiedOwner {
  id: string;
  kind: 'team' | 'person';
  name: string;
  handle?: string;
  email?: string;
}

function classifyOwner(spec: string): ClassifiedOwner {
  // Email → person
  if (spec.includes('@') && !spec.startsWith('@')) {
    return {
      id: `person:${spec.toLowerCase()}`,
      kind: 'person',
      name: spec,
      email: spec,
    };
  }
  // Team handle: @org/team
  if (spec.startsWith('@') && spec.includes('/')) {
    const handle = spec.toLowerCase();
    const team = spec.slice(1); // org/team
    return {
      id: `team:${handle.slice(1)}`, // strip leading @
      kind: 'team',
      name: team,
      handle,
    };
  }
  // Individual user handle: @user
  if (spec.startsWith('@')) {
    const handle = spec.toLowerCase();
    return {
      id: `person:${handle.slice(1)}`,
      kind: 'person',
      name: spec.slice(1),
      handle,
    };
  }
  // Fallback — treat as opaque person handle
  return {
    id: `person:${spec.toLowerCase()}`,
    kind: 'person',
    name: spec,
    handle: spec,
  };
}

function pickDominantOwner(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, n] of counts) {
    if (n > bestCount) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}

// Re-export for callers that want to drive the parser independently
// (e.g. CLI dry-run, future API endpoint listing matched files).
export { loadCodeOwners, matchOwners } from './codeowners-parser';
export type { ParsedCodeOwners, CodeOwnersRule };
