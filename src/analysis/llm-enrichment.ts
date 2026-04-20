import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { sanitizeForPrompt } from '../utils/prompt-sanitizer';
import type {
  ServiceNode, EndpointNode, FunctionNode, ColumnNode,
  TableNode, DatabaseNode, LLMEnrichment,
  GraphValidationResult, GraphValidationIssue,
} from '../types/topology';

export interface EnrichmentConfig {
  /** Chave da API Anthropic — padrão: process.env.ANTHROPIC_API_KEY */
  apiKey?: string;
  /** Modelo para nós simples (colunas, funções curtas) */
  modelSimple?: string;
  /** Modelo para nós complexos (endpoints, serviços) */
  modelComplex?: string;
  /** Nós por request de batch */
  batchSize?: number;
  /** Requests LLM em paralelo */
  maxConcurrency?: number;
  /** Só enriquecer nós cujo hash mudou desde o último enriquecimento */
  incrementalOnly?: boolean;
  /** Rodar validação do grafo por serviço */
  validateGraph?: boolean;
  /** Enriquecer colunas (mais caro — só colunas com edges) */
  enrichColumns?: boolean;
  /** Não chamar API — apenas mostrar o que seria enviado */
  dryRun?: boolean;
  /** Callback de progresso */
  onProgress?: (msg: string) => void;
}

const DEFAULT_CONFIG: Required<Omit<EnrichmentConfig, 'apiKey' | 'onProgress'>> = {
  modelSimple: 'claude-haiku-4-5-20251001',
  modelComplex: 'claude-sonnet-4-6',
  batchSize: 8,
  maxConcurrency: 3,
  incrementalOnly: true,
  validateGraph: true,
  enrichColumns: false,
  dryRun: false,
};

interface EnrichableNode {
  id: string;
  name: string;
  type: string;
  getPromptData(): object;
  applyEnrichment(e: LLMEnrichment): void;
  currentHash(): string;
}

// ── Hash utilities ─────────────────────────────────────────

function hashObject(obj: object): string {
  return createHash('sha1')
    .update(JSON.stringify(obj))
    .digest('hex')
    .slice(0, 12);
}

// ── Bottom-up enrichment ───────────────────────────────────

export async function enrichService(
  service: ServiceNode,
  databases: DatabaseNode[],
  config: EnrichmentConfig = {},
): Promise<GraphValidationResult | undefined> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const log = cfg.onProgress ?? (() => {});
  const client = new Anthropic({ apiKey: cfg.apiKey ?? process.env.ANTHROPIC_API_KEY });

  log(`Enriching service: ${service.name}`);

  // 1. Columns (seletivo — só com edges conhecidos)
  if (cfg.enrichColumns) {
    const usedColumnIds = collectUsedColumnIds(service);
    for (const db of databases) {
      for (const table of db.tables) {
        const targetCols = table.columns.filter(c => usedColumnIds.has(c.id));
        if (targetCols.length > 0) {
          await batchEnrichColumns(targetCols, table, client, cfg);
        }
      }
    }
  }

  // 2. Functions (nós de serviço/usecase que têm children)
  const enrichableFunctions = service.functions.filter(f =>
    f.metadata.kind !== 'constructor' && f.children.length > 0,
  );
  if (enrichableFunctions.length > 0) {
    await batchEnrichFunctions(enrichableFunctions, service.name, client, cfg);
  }

  // 3. Endpoints
  if (service.endpoints.length > 0) {
    await batchEnrichEndpoints(service.endpoints, service, client, cfg);
  }

  // 4. Service level
  await enrichServiceNode(service, client, cfg);

  // 5. Graph validation
  if (cfg.validateGraph && !cfg.dryRun) {
    return await validateServiceGraph(service, client, cfg);
  }

  return undefined;
}

// ── Column enrichment ──────────────────────────────────────

async function batchEnrichColumns(
  columns: ColumnNode[],
  table: TableNode,
  client: Anthropic,
  cfg: typeof DEFAULT_CONFIG,
): Promise<void> {
  const batches = chunk(columns, cfg.batchSize);

  for (const batch of batches) {
    if (cfg.dryRun) continue;

    const prompt = `You are documenting database columns for a software architecture graph.
Table: ${sanitizeForPrompt(table.name)}

Columns to document:
${batch.map(c => `- ${sanitizeForPrompt(c.name)}: ${sanitizeForPrompt(c.metadata.dataType)}, nullable=${c.metadata.nullable}, pk=${c.metadata.primaryKey}`).join('\n')}

For each column, provide a JSON array with objects:
{ "name": "column_name", "humanName": "Human Readable Name", "description": "one sentence flow summary: what data this stores, who writes it, who reads it, why it exists", "tags": ["pii"?, "security"?, "write-protected"?, "generated"?] }

Rules:
- description: only what's observable from the column definition. Don't invent business logic.
- tags: only from the allowed list: ["pii", "security", "write-protected", "generated", "indexed", "audit"]
- Respond with JSON array only.`;

    try {
      const response = await client.messages.create({
        model: cfg.modelSimple,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = extractJsonArray(text);
      if (!parsed) continue;

      for (const item of parsed) {
        const col = batch.find(c => c.name === item.name);
        if (!col) continue;
        col.metadata.llm = {
          humanName: item.humanName,
          description: item.description,
          tags: item.tags,
          enrichedAt: new Date().toISOString(),
          enrichedBy: cfg.modelSimple,
        };
      }
    } catch { /* skip batch on error */ }
  }
}

// ── Function enrichment ────────────────────────────────────

async function batchEnrichFunctions(
  functions: FunctionNode[],
  serviceName: string,
  client: Anthropic,
  cfg: typeof DEFAULT_CONFIG,
): Promise<void> {
  const batches = chunk(functions, cfg.batchSize);

  for (const batch of batches) {
    if (cfg.dryRun) continue;

    const fnDescriptions = batch.map(fn => {
      const dbOps = fn.children
        .filter(c => c.type === 'dbProcess')
        .map(c => {
          const db = c as import('../types/topology').DbProcessNode;
          return `${db.metadata.operation} on ${db.metadata.tableId}`;
        });
      const calls = fn.children
        .filter(c => c.type === 'call')
        .map(c => (c as import('../types/topology').CallNode).metadata.callee)
        .slice(0, 5);
      const extCalls = fn.children
        .filter(c => c.type === 'externalCall')
        .map(c => `${(c as import('../types/topology').ExternalCallNode).metadata.method} ${(c as import('../types/topology').ExternalCallNode).metadata.path}`);
      const params = fn.metadata.params
        .map(p => {
          if (p.resolvedFields && p.resolvedFields.length > 0) {
            const fields = p.resolvedFields.map(f => `${f.name}:${f.type}`).join(', ');
            return `${p.name}:{${fields}}`;
          }
          return `${p.name}:${p.type ?? 'unknown'}`;
        })
        .join(', ');

      return {
        name: fn.name,
        async: fn.metadata.async,
        params,
        returnType: fn.metadata.returnType,
        dbOps,
        calls,
        extCalls,
      };
    });

    const prompt = `You are documenting service functions for a software architecture graph.
Service: ${sanitizeForPrompt(serviceName)}

Functions:
${JSON.stringify(fnDescriptions, null, 2)}

For each function, respond with a JSON array:
{ "name": "exact_function_name", "humanName": "Human Readable Name (3-5 words)", "description": "Flow summary: what it receives, what logic it applies, what it queries/calls and from where, what it returns, under what conditions it fails" }

Rules:
- Describe only what is visible in the provided data. Do not invent business logic.
- description: 2-4 sentences covering the flow, not just what the function is named.
- Respond with JSON array only.`;

    try {
      const response = await client.messages.create({
        model: cfg.modelSimple,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = extractJsonArray(text);
      if (!parsed) continue;

      for (const item of parsed) {
        const fn = batch.find(f => f.name === item.name);
        if (!fn) continue;
        fn.metadata.llm = {
          humanName: item.humanName,
          description: item.description,
          enrichedAt: new Date().toISOString(),
          enrichedBy: cfg.modelSimple,
        };
      }
    } catch { /* skip batch on error */ }
  }
}

// ── Endpoint enrichment ────────────────────────────────────

async function batchEnrichEndpoints(
  endpoints: EndpointNode[],
  service: ServiceNode,
  client: Anthropic,
  cfg: typeof DEFAULT_CONFIG,
): Promise<void> {
  const batches = chunk(endpoints, Math.min(cfg.batchSize, 5));

  for (const batch of batches) {
    if (cfg.dryRun) continue;

    const epDescriptions = batch.map(ep => {
      const params = ep.metadata.request;
      const bodyFields = params.body?.map(f => `${f.name}:${f.type}`) ?? [];
      const queryFields = params.query?.map(f => `${f.name}:${f.type}`) ?? [];
      const pathParams = params.params?.map(f => f.name) ?? [];

      const dbOps = collectDbOps(ep, service);
      const extCalls = collectExtCalls(ep, service);
      const responses = ep.metadata.responses.map(r => `${r.httpStatus}${r.bodyType ? ':' + r.bodyType : ''}${r.errorClass ? '(' + r.errorClass + ')' : ''}`);
      const fnWithLLM = service.functions.find(f =>
        f.name === ep.name && f.metadata.llm?.description,
      );

      return {
        method: ep.metadata.method,
        path: ep.metadata.path,
        framework: ep.metadata.framework,
        middleware: ep.metadata.middleware,
        pathParams,
        queryParams: queryFields,
        bodyType: params.bodyType,
        body: bodyFields,
        responses,
        dbOperations: dbOps,
        externalCalls: extCalls,
        implementationSummary: fnWithLLM?.metadata.llm?.description,
      };
    });

    const prompt = `You are documenting HTTP endpoints for a software architecture graph.
Service: ${sanitizeForPrompt(service.name)} (${service.metadata.language ?? 'unknown'}, ${service.metadata.framework ?? 'unknown'})

Endpoints:
${JSON.stringify(epDescriptions, null, 2)}

For each endpoint, respond with a JSON array:
{ "method": "GET", "path": "/exact/path", "humanName": "Action Name (3-5 words)", "description": "Flow summary: what it receives (params/body), what logic/validation applies, what it queries or calls and from whom, what it returns on success, under what conditions it returns each error status" }

Rules:
- Describe only what is present in the provided data. Do not invent business context.
- description: 3-5 sentences covering the complete request-response flow.
- Respond with JSON array only.`;

    try {
      const response = await client.messages.create({
        model: cfg.modelComplex,
        max_tokens: 3072,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = extractJsonArray(text);
      if (!parsed) continue;

      for (const item of parsed) {
        const ep = batch.find(e => e.metadata.method === item.method && e.metadata.path === item.path);
        if (!ep) continue;
        ep.metadata.llm = {
          humanName: item.humanName,
          description: item.description,
          enrichedAt: new Date().toISOString(),
          enrichedBy: cfg.modelComplex,
        };
      }
    } catch { /* skip batch on error */ }
  }
}

// ── Service node enrichment ────────────────────────────────

async function enrichServiceNode(
  service: ServiceNode,
  client: Anthropic,
  cfg: typeof DEFAULT_CONFIG,
): Promise<void> {
  if (cfg.dryRun) return;

  const endpointSummaries = service.endpoints
    .map(ep => {
      const llm = ep.metadata.llm;
      return `${ep.metadata.method} ${ep.metadata.path}${llm ? ': ' + llm.humanName : ''}`;
    })
    .join('\n');

  const deps = service.dependencies.map(d => `${d.targetType}:${d.targetId}`).join(', ');

  const prompt = `You are documenting a microservice for a software architecture graph.

Service: ${sanitizeForPrompt(service.name)}
Language: ${service.metadata.language ?? 'unknown'}
Framework: ${service.metadata.framework ?? 'unknown'}
Protocol: ${service.metadata.protocol ?? 'unknown'}

Endpoints (${service.endpoints.length}):
${endpointSummaries}

Dependencies: ${deps || 'none'}

Respond with JSON only:
{ "humanName": "Service Name (2-4 words)", "description": "Service summary: what domain it covers, what operations it exposes, what it depends on, what type of clients use it" }

Rules:
- description: 3-5 sentences. Cover domain, responsibilities, dependencies, and consumers.
- Respond with JSON only.`;

  try {
    const response = await client.messages.create({
      model: cfg.modelComplex,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = extractJsonObject(text);
    if (!parsed) return;

    service.metadata.llm = {
      humanName: parsed.humanName,
      description: parsed.description,
      enrichedAt: new Date().toISOString(),
      enrichedBy: cfg.modelComplex,
    };
  } catch { /* skip */ }
}

// ── Graph validation ───────────────────────────────────────

async function validateServiceGraph(
  service: ServiceNode,
  client: Anthropic,
  cfg: typeof DEFAULT_CONFIG,
): Promise<GraphValidationResult> {
  const issues: GraphValidationIssue[] = [];

  // Validações determinísticas (sem LLM)
  for (const ep of service.endpoints) {
    const hasDbOrExternal = hasDbOrExternalInTree(ep);
    if (!hasDbOrExternal && ep.children.length === 0) {
      issues.push({
        severity: 'info',
        nodeId: ep.id,
        description: `Endpoint ${ep.metadata.method} ${ep.metadata.path} has no database operations or external calls.`,
        suggestion: 'Verify this endpoint is fully extracted.',
      });
    }
  }

  for (const fn of service.functions) {
    if (fn.metadata.kind !== 'constructor' && fn.name.length <= 2) {
      issues.push({
        severity: 'warning',
        nodeId: fn.id,
        description: `Function name "${fn.name}" is too short to be meaningful.`,
        suggestion: 'Check if extraction missed the actual function name.',
      });
    }
  }

  // Validação LLM (coerência e completude)
  const endpointSummaries = service.endpoints.map(ep => ({
    method: ep.metadata.method,
    path: ep.metadata.path,
    humanName: ep.metadata.llm?.humanName,
    hasImpl: service.functions.some(f => f.name === ep.name),
  }));

  try {
    const prompt = `You are validating a microservices topology graph for the service "${service.name}".

Endpoints:
${JSON.stringify(endpointSummaries, null, 2)}

Functions extracted: ${service.functions.length}
Globals extracted: ${service.globals.length}
DB operations found: ${countDbOps(service)}
External calls found: ${countExtCalls(service)}

Check for:
1. Endpoints that seem to be missing implementation functions
2. Inconsistent naming patterns
3. Any obvious gaps that suggest incomplete extraction

Respond with JSON:
{ "coherenceScore": 85, "issues": [{ "severity": "warning", "description": "...", "suggestion": "..." }] }
If no issues: { "coherenceScore": 95, "issues": [] }`;

    const response = await client.messages.create({
      model: cfg.modelSimple,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = extractJsonObject(text);

    if (parsed?.issues) {
      for (const issue of parsed.issues) {
        issues.push({
          severity: issue.severity ?? 'info',
          description: issue.description,
          suggestion: issue.suggestion,
        });
      }
    }

    return {
      serviceId: service.id,
      issues,
      coherenceScore: parsed?.coherenceScore ?? 80,
      validatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      serviceId: service.id,
      issues,
      coherenceScore: 80,
      validatedAt: new Date().toISOString(),
    };
  }
}

// ── Aggregated service dependencies ──────────────────────────

export function computeResolvedDependencies(
  service: ServiceNode,
  allServices: ServiceNode[],
  allDatabases: DatabaseNode[],
): void {
  const serviceDepMap = new Map<string, { serviceId: string; serviceName: string; via: string[]; callCount: number }>();
  const dbDepMap = new Map<string, { databaseId: string; databaseName: string; operations: Set<string>; tables: Set<string> }>();

  function walkNodes(nodes: import('../types/topology').CodeNode[]): void {
    for (const node of nodes) {
      if (node.type === 'externalCall') {
        const ext = node as import('../types/topology').ExternalCallNode;
        if (ext.metadata.mergeStatus === 'resolved' && ext.metadata.resolvedEndpointId) {
          const targetService = allServices.find(s =>
            s.endpoints.some(e => e.id === ext.metadata.resolvedEndpointId),
          );
          if (targetService) {
            const existing = serviceDepMap.get(targetService.id);
            if (existing) {
              existing.via.push(ext.id);
              existing.callCount++;
            } else {
              serviceDepMap.set(targetService.id, {
                serviceId: targetService.id,
                serviceName: targetService.name,
                via: [ext.id],
                callCount: 1,
              });
            }
          }
        }
      }

      if (node.type === 'dbProcess') {
        const db = node as import('../types/topology').DbProcessNode;
        const database = allDatabases.find(d => d.id === db.metadata.databaseId);
        if (database) {
          const isWrite = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'raw', 'migrate']
            .includes(db.metadata.operation);
          const isDelete = ['delete', 'deleteMany'].includes(db.metadata.operation);
          const opKind = isDelete ? 'delete' : isWrite ? 'write' : 'read';

          const existing = dbDepMap.get(database.id);
          if (existing) {
            existing.operations.add(opKind);
            if (db.metadata.tableId) existing.tables.add(db.metadata.tableId);
          } else {
            dbDepMap.set(database.id, {
              databaseId: database.id,
              databaseName: database.name,
              operations: new Set([opKind]),
              tables: db.metadata.tableId ? new Set([db.metadata.tableId]) : new Set(),
            });
          }
        }
      }

      walkNodes(node.children);
    }
  }

  walkNodes(service.endpoints as import('../types/topology').CodeNode[]);
  walkNodes(service.functions as import('../types/topology').CodeNode[]);

  service.resolvedDependencies = {
    services: Array.from(serviceDepMap.values()),
    databases: Array.from(dbDepMap.values()).map(d => ({
      databaseId: d.databaseId,
      databaseName: d.databaseName,
      operations: Array.from(d.operations) as ('read' | 'write' | 'delete')[],
      tablesAccessed: Array.from(d.tables),
    })),
    brokers: [],
  };
}

// ── Helpers ────────────────────────────────────────────────

function collectUsedColumnIds(service: ServiceNode): Set<string> {
  const ids = new Set<string>();
  function walk(nodes: import('../types/topology').CodeNode[]): void {
    for (const n of nodes) {
      if (n.type === 'dbProcess') {
        ((n as import('../types/topology').DbProcessNode).metadata.resolvedColumnIds ?? []).forEach(id => ids.add(id));
      }
      walk(n.children);
    }
  }
  walk(service.endpoints as import('../types/topology').CodeNode[]);
  walk(service.functions as import('../types/topology').CodeNode[]);
  return ids;
}

function collectDbOps(ep: EndpointNode, service: ServiceNode): string[] {
  const ops: string[] = [];
  function walk(nodes: import('../types/topology').CodeNode[]): void {
    for (const n of nodes) {
      if (n.type === 'dbProcess') {
        const db = n as import('../types/topology').DbProcessNode;
        ops.push(`${db.metadata.operation}@${db.metadata.tableId}`);
      }
      walk(n.children);
    }
  }
  walk(ep.children);
  // Also look in functions called by this endpoint
  const fn = service.functions.find(f => f.name === ep.name && f.location.file === ep.location.file);
  if (fn) walk(fn.children);
  return ops;
}

function collectExtCalls(ep: EndpointNode, service: ServiceNode): string[] {
  const calls: string[] = [];
  function walk(nodes: import('../types/topology').CodeNode[]): void {
    for (const n of nodes) {
      if (n.type === 'externalCall') {
        const ext = n as import('../types/topology').ExternalCallNode;
        calls.push(`${ext.metadata.method} ${ext.metadata.path}`);
      }
      walk(n.children);
    }
  }
  walk(ep.children);
  return calls;
}

function hasDbOrExternalInTree(node: import('../types/topology').BaseCodeNode): boolean {
  if (node.type === 'dbProcess' || node.type === 'externalCall') return true;
  return node.children.some(c => hasDbOrExternalInTree(c as import('../types/topology').BaseCodeNode));
}

function countDbOps(service: ServiceNode): number {
  let count = 0;
  function walk(nodes: import('../types/topology').CodeNode[]): void {
    for (const n of nodes) {
      if (n.type === 'dbProcess') count++;
      walk(n.children);
    }
  }
  walk(service.endpoints as import('../types/topology').CodeNode[]);
  walk(service.functions as import('../types/topology').CodeNode[]);
  return count;
}

function countExtCalls(service: ServiceNode): number {
  let count = 0;
  function walk(nodes: import('../types/topology').CodeNode[]): void {
    for (const n of nodes) {
      if (n.type === 'externalCall') count++;
      walk(n.children);
    }
  }
  walk(service.endpoints as import('../types/topology').CodeNode[]);
  walk(service.functions as import('../types/topology').CodeNode[]);
  return count;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function extractJsonArray(text: string): any[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function extractJsonObject(text: string): any | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}
