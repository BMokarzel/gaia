/**
 * Tool definitions exposed to the Anthropic chat agent.
 *
 * Each tool has:
 *   - schema: passed to Anthropic so the model knows the contract
 *   - handle: server-side execution, given a {@link ToolContext} that
 *     carries references to storage + topology service.
 *
 * Keeping schema and handler co-located avoids drift; the chat service
 * iterates a single registry to dispatch tool_use blocks.
 */
import {
  runTopologyQuery,
  simulateEndpoint,
  type TopologyQuery,
  type SimulationToggles,
} from '@topology/core';
import type { ITopologyStorageRepository } from '../../../storage/interfaces/topology-storage.interface';
import type { ITopologyService } from '../../topology/interfaces/topology-service.interface';

export interface ToolContext {
  storage: ITopologyStorageRepository;
  topology: ITopologyService;
  /** Optional default topology id; tools fall back to this when input omits topologyId. */
  defaultTopologyId?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  // Anthropic uses JSON schema for tool input validation.
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolDef extends ToolSchema {
  handle(input: any, ctx: ToolContext): Promise<unknown>;
}

/** Resolves the topology id from input or context default; throws when neither set. */
function resolveTopologyId(input: { topologyId?: string }, ctx: ToolContext): string {
  const id = input.topologyId ?? ctx.defaultTopologyId;
  if (!id) throw new Error('topologyId is required (no default set in chat context)');
  return id;
}

const listTopologies: ToolDef = {
  name: 'list_topologies',
  description:
    'Lists all available topologies (analyzed code repos) by id, name, tags, and source. Use this when the user asks "what topologies / projects / services are there".',
  input_schema: { type: 'object', properties: {}, required: [] },
  async handle(_input, ctx) {
    const [items] = await ctx.storage.findAll({ limit: 1000 });
    return items.map(t => ({
      id: t.id,
      name: t.name,
      tags: t.tags,
      source: t.source,
      analyzedAt: t.analyzedAt ?? t.updatedAt,
      commitSha: t.commitSha,
      services: t.topology.services.length,
      endpoints: t.topology.services.reduce((n, s) => n + s.endpoints.length, 0),
      databases: t.topology.databases.length,
    }));
  },
};

const getTopologySummary: ToolDef = {
  name: 'get_topology_summary',
  description:
    'Returns a high-level summary of a topology: service names, endpoint counts per service, databases, brokers, top external dependencies. Cheap and structured — call this before drilling into a specific service.',
  input_schema: {
    type: 'object',
    properties: {
      topologyId: { type: 'string', description: 'Topology id (optional if a default is set)' },
    },
    required: [],
  },
  async handle(input: { topologyId?: string }, ctx) {
    const id = resolveTopologyId(input, ctx);
    const stored = await ctx.topology.get(id);
    const t = stored.topology;
    return {
      id: stored.id,
      name: stored.name,
      analyzedAt: stored.analyzedAt ?? stored.updatedAt,
      commitSha: stored.commitSha,
      services: t.services.map(s => ({
        id: s.id,
        name: s.name,
        language: s.metadata.language,
        framework: s.metadata.framework,
        endpoints: s.endpoints.length,
        functions: s.functions.length,
        team: s.metadata.team,
      })),
      databases: t.databases.map(d => ({ id: d.id, name: d.name, engine: d.metadata.engine })),
      brokerCount: (t as any).brokers?.length ?? 0,
      ownership: t.ownership ? { owners: t.ownership.owners.length, edges: t.ownership.edges.length } : null,
    };
  },
};

const queryEndpoints: ToolDef = {
  name: 'query_endpoints',
  description:
    'Lists endpoints in a topology, optionally filtered by service id, HTTP method, path substring, or "throws status" (e.g. only endpoints that throw 401). Returns id, method, path, service, throwStatuses.',
  input_schema: {
    type: 'object',
    properties: {
      topologyId: { type: 'string' },
      serviceId: { type: 'string', description: 'Restrict to one service' },
      method: { type: 'string', description: 'GET, POST, PUT, DELETE, etc.' },
      pathContains: { type: 'string', description: 'Substring match on path' },
      throwsStatus: { type: 'number', description: 'Only endpoints that throw this HTTP code' },
      limit: { type: 'number', description: 'Cap results (default 100)' },
    },
    required: [],
  },
  async handle(input: any, ctx) {
    const id = resolveTopologyId(input, ctx);
    const stored = await ctx.topology.get(id);
    const limit = typeof input.limit === 'number' ? input.limit : 100;
    const results: any[] = [];
    for (const svc of stored.topology.services) {
      if (input.serviceId && svc.id !== input.serviceId) continue;
      for (const ep of svc.endpoints) {
        if (input.method && ep.metadata.method?.toUpperCase() !== String(input.method).toUpperCase()) continue;
        if (input.pathContains && !ep.metadata.path?.includes(input.pathContains)) continue;
        const throwStatuses: number[] = collectThrowStatuses(ep);
        if (typeof input.throwsStatus === 'number' && !throwStatuses.includes(input.throwsStatus)) continue;
        results.push({
          id: ep.id,
          serviceId: svc.id,
          serviceName: svc.name,
          method: ep.metadata.method,
          path: ep.metadata.path,
          humanName: ep.metadata.llm?.humanName,
          throwStatuses,
        });
        if (results.length >= limit) return { results, truncated: true };
      }
    }
    return { results, truncated: false };
  },
};

function collectThrowStatuses(node: any): number[] {
  const out = new Set<number>();
  function walk(n: any) {
    if (!n) return;
    if (n.type === 'throw' && typeof n.metadata?.httpStatus === 'number') out.add(n.metadata.httpStatus);
    if (Array.isArray(n.children)) n.children.forEach(walk);
  }
  walk(node);
  return [...out].sort((a, b) => a - b);
}

const getEndpointFlow: ToolDef = {
  name: 'get_endpoint_flow',
  description:
    'Returns the full execution flow for a single endpoint: the endpoint node, all transitively-reachable functions (via call.metadata.resolvedTo), and the owning service. Use this to answer "how does endpoint X work" or "what does X do".',
  input_schema: {
    type: 'object',
    properties: {
      topologyId: { type: 'string' },
      endpointId: { type: 'string' },
    },
    required: ['endpointId'],
  },
  async handle(input: { topologyId?: string; endpointId: string }, ctx) {
    const id = resolveTopologyId(input, ctx);
    return ctx.topology.getEndpointFlow(id, input.endpointId);
  },
};

const getServiceDoc: ToolDef = {
  name: 'get_service_doc',
  description:
    'Generates Markdown documentation for a service (uses the LLM doc generator). Best when the user explicitly asks "document service X" or wants a polished summary. More expensive than get_topology_summary.',
  input_schema: {
    type: 'object',
    properties: {
      topologyId: { type: 'string' },
      serviceId: { type: 'string' },
    },
    required: ['serviceId'],
  },
  async handle(input: { topologyId?: string; serviceId: string }, ctx) {
    const id = resolveTopologyId(input, ctx);
    return ctx.topology.getServiceDoc(id, input.serviceId);
  },
};

const getEndpointDoc: ToolDef = {
  name: 'get_endpoint_doc',
  description:
    'Generates Markdown documentation for a single endpoint (LLM doc generator). Use when the user wants a polished endpoint write-up.',
  input_schema: {
    type: 'object',
    properties: {
      topologyId: { type: 'string' },
      endpointId: { type: 'string' },
    },
    required: ['endpointId'],
  },
  async handle(input: { topologyId?: string; endpointId: string }, ctx) {
    const id = resolveTopologyId(input, ctx);
    return ctx.topology.getEndpointDoc(id, input.endpointId);
  },
};

const getDiff: ToolDef = {
  name: 'get_diff',
  description:
    'Compares two snapshots of a topology by SHA (or "current" for the live one). Returns added/removed/modified services, endpoints, dbs, edges. Use to answer "what changed since X" or "what did this PR/commit affect".',
  input_schema: {
    type: 'object',
    properties: {
      topologyId: { type: 'string' },
      from: { type: 'string', description: 'commit SHA or snapshot id, or "current"' },
      to: { type: 'string', description: 'commit SHA or snapshot id, or "current"' },
    },
    required: ['from', 'to'],
  },
  async handle(input: { topologyId?: string; from: string; to: string }, ctx) {
    const id = resolveTopologyId(input, ctx);
    return ctx.topology.diff(id, input.from, input.to);
  },
};

const listSnapshots: ToolDef = {
  name: 'list_snapshots',
  description: 'Lists snapshot history for a topology (current + archived snapshots, newest first).',
  input_schema: {
    type: 'object',
    properties: { topologyId: { type: 'string' } },
    required: [],
  },
  async handle(input: { topologyId?: string }, ctx) {
    const id = resolveTopologyId(input, ctx);
    return ctx.topology.listSnapshots(id);
  },
};

const runQuery: ToolDef = {
  name: 'run_query',
  description:
    'Run a structured analytical query over a topology. Prefer this over scanning everything with other tools when the question fits one of the supported query kinds: ' +
    '"cycles" (find service cycles), "orphan_services" (no incoming calls), "endpoints_without_auth", "endpoints_throwing" (needs status), "services_using_database" (needs databaseId), ' +
    '"services_without_owners", "unresolved_external_calls", "duplicate_db_operations" (same db+table+op across services). Returns typed JSON results.',
  input_schema: {
    type: 'object',
    properties: {
      topologyId: { type: 'string' },
      query: {
        type: 'object',
        description: 'Discriminated union — see tool description. Example: { "kind": "endpoints_throwing", "status": 401 }.',
        properties: {
          kind: {
            type: 'string',
            enum: [
              'cycles',
              'orphan_services',
              'endpoints_without_auth',
              'endpoints_throwing',
              'services_using_database',
              'services_without_owners',
              'unresolved_external_calls',
              'duplicate_db_operations',
            ],
          },
          status: { type: 'number', description: 'For "endpoints_throwing": HTTP status code' },
          databaseId: { type: 'string', description: 'For "services_using_database"' },
        },
        required: ['kind'],
      },
    },
    required: ['query'],
  },
  async handle(input: { topologyId?: string; query: TopologyQuery }, ctx) {
    const id = resolveTopologyId(input, ctx);
    const stored = await ctx.topology.get(id);
    return runTopologyQuery(input.query, stored.topology);
  },
};

const getSourceSnippet: ToolDef = {
  name: 'get_source_snippet',
  description:
    'Reads source code lines around a target line (only works for local sources). Use to back claims with actual code; pass the file path relative to the project root.',
  input_schema: {
    type: 'object',
    properties: {
      topologyId: { type: 'string' },
      file: { type: 'string' },
      line: { type: 'number' },
      contextLines: { type: 'number', description: 'Lines before/after focus line (default 12, max 100)' },
    },
    required: ['file', 'line'],
  },
  async handle(input: { topologyId?: string; file: string; line: number; contextLines?: number }, ctx) {
    const id = resolveTopologyId(input, ctx);
    return ctx.topology.getSourceSnippet(id, input.file, input.line, input.contextLines);
  },
};

const simulateEndpointTool: ToolDef = {
  name: 'simulate_endpoint',
  description:
    'Statically simulates an endpoint to enumerate observable side effects (throws, external calls, DB ops, middlewares, returns) and likely HTTP responses. ' +
    'Optional toggles let you force failures (failingExternalIds / failingDbIds / failingMiddleware) — useful to answer "what happens if the auth guard rejects" or "what if the payments API is down". Pure static analysis; no code is executed.',
  input_schema: {
    type: 'object',
    properties: {
      topologyId: { type: 'string' },
      endpointId: { type: 'string' },
      toggles: {
        type: 'object',
        description: 'Optional failure toggles to inject synthetic throws.',
        properties: {
          failingExternalIds: { type: 'array', items: { type: 'string' }, description: 'externalCall ids to mark as failing (injects 502)' },
          failingDbIds: { type: 'array', items: { type: 'string' }, description: 'dbProcess ids to mark as failing (injects 503)' },
          failingMiddleware: { type: 'array', items: { type: 'string' }, description: 'middleware names to mark as rejecting (401/403/400 by kind)' },
        },
      },
      maxFunctionDepth: { type: 'number', description: 'Cap on transitive function expansion. Default 8.' },
    },
    required: ['endpointId'],
  },
  async handle(input: { topologyId?: string; endpointId: string; toggles?: SimulationToggles; maxFunctionDepth?: number }, ctx) {
    const id = resolveTopologyId(input, ctx);
    const stored = await ctx.topology.get(id);
    for (const svc of stored.topology.services) {
      const ep = svc.endpoints.find(e => e.id === input.endpointId);
      if (ep) {
        return simulateEndpoint(ep, svc, {
          toggles: input.toggles,
          maxFunctionDepth: input.maxFunctionDepth,
        });
      }
    }
    throw new Error(`endpoint not found: ${input.endpointId}`);
  },
};

export const TOPOLOGY_TOOLS: ToolDef[] = [
  listTopologies,
  getTopologySummary,
  queryEndpoints,
  getEndpointFlow,
  getServiceDoc,
  getEndpointDoc,
  getDiff,
  listSnapshots,
  runQuery,
  simulateEndpointTool,
  getSourceSnippet,
];

/** Return only the schema portion (what we send to Anthropic). */
export function toolSchemas(): ToolSchema[] {
  return TOPOLOGY_TOOLS.map(({ name, description, input_schema }) => ({
    name, description, input_schema,
  }));
}

export function findTool(name: string): ToolDef | undefined {
  return TOPOLOGY_TOOLS.find(t => t.name === name);
}
