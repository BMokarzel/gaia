import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type {
  ExternalCallNode, SystemTopology, PendingMergeEntry,
} from '@topology/core';
import { runCrossServiceMerge, enrichService } from '@topology/core';
import { EXTRACTION_SERVICE } from '../../extraction/tokens';
import { TOPOLOGY_STORAGE } from '../../storage/tokens';
import type { IExtractionService } from '../../extraction/interfaces/extraction-service.interface';
import type {
  ITopologyStorageRepository,
  StoredTopology,
} from '../../storage/interfaces/topology-storage.interface';
import type { ITopologyService, ExportSections } from './interfaces/topology-service.interface';
import type { AnalyzeRequestDto } from './dto/analyze-request.dto';
import type { UpdateTopologyDto } from './dto/update-topology.dto';
import type { ListTopologiesDto } from './dto/list-topologies.dto';
import type { AnalyzeResponseDto } from './dto/analyze-response.dto';
import type { MergeDecisionDto } from './dto/merge-decision.dto';
import type { ExportDescribeDto, EndpointContextDto, ServiceContextDto } from './dto/export-describe.dto';
import { spawnSync } from 'child_process';
import { PagedResult } from '../../common/dto/paged-result.dto';
import type { SourceDescriptor } from '../../extraction/interfaces/extraction-source-adapter.interface';
import { EcosystemService } from '../ecosystem/ecosystem.service';

interface AnalysisSession {
  repoName: string;
  name: string;
  source: SourceDescriptor;
  tags: string[];
  topology: SystemTopology;
  pendingMerges: PendingMergeEntry[];
  createdAt: number;
}

@Injectable()
export class TopologyService implements ITopologyService {
  /** In-memory sessions for extractions awaiting merge decisions */
  private readonly sessions = new Map<string, AnalysisSession>();

  constructor(
    @Inject(EXTRACTION_SERVICE) private readonly extraction: IExtractionService,
    @Inject(TOPOLOGY_STORAGE) private readonly storage: ITopologyStorageRepository,
    private readonly ecosystem: EcosystemService,
  ) {
    // Clean up stale sessions every 10 minutes (abandoned extractions)
    setInterval(() => this.pruneStaleSessions(), 10 * 60 * 1000);
  }

  async analyze(dto: AnalyzeRequestDto): Promise<AnalyzeResponseDto> {
    const source = dto.source as SourceDescriptor;
    const repoName = this.deriveRepoName(source, dto.name);

    // Duplicate check
    const existing = await this.storage.findById(repoName);
    if (existing) {
      throw new ConflictException(
        `A topology for "${repoName}" already exists. Delete it first or use a different name.`,
      );
    }

    const topology = await this.extraction.extract(source, dto.options, dto.clonePolicy);
    const name = dto.name ?? repoName;

    // Collect all ExternalCallNodes from the extracted topology
    const externalCalls = collectExternalCalls(topology);

    // Load existing topologies for cross-service merge (Direction 1)
    const [existingTopologies] = await this.storage.findAll({ limit: 1000 });
    const allServices = existingTopologies.flatMap(t => t.topology.services);

    const { edges, pending } = await runCrossServiceMerge(
      allServices,
      externalCalls,
      process.env.ANTHROPIC_API_KEY,
    );

    // Attach resolved edges to topology
    topology.edges.push(...edges);

    if (pending.length > 0) {
      const sessionId = nanoid();
      this.sessions.set(sessionId, {
        repoName,
        name,
        source,
        tags: dto.tags ?? [],
        topology,
        pendingMerges: pending,
        createdAt: Date.now(),
      });

      return {
        status: 'pending_merge_decisions',
        sessionId,
        pendingMerges: pending,
        progress: buildProgress(topology, externalCalls, pending),
      };
    }

    // No pending merges — enrich and persist
    await this.runEnrichment(topology);
    const stored = await this.persistTopology(repoName, name, source, dto.tags ?? [], topology);

    return {
      status: 'complete',
      topologyId: stored.id,
      summary: buildProgress(topology, externalCalls, []),
    };
  }

  async resolveMergeDecisions(dto: MergeDecisionDto): Promise<AnalyzeResponseDto> {
    const session = this.sessions.get(dto.sessionId);
    if (!session) {
      throw new NotFoundException(`Session "${dto.sessionId}" not found or expired.`);
    }

    // Apply user decisions to pending merge entries
    const extCallMap = buildExternalCallMap(session.topology);

    for (const item of dto.decisions) {
      const entry = session.pendingMerges.find(m => m.externalCallId === item.externalCallId);
      if (!entry) continue;

      entry.decision = item.decision;

      // If approved, add resolves_to edge and update the ExternalCallNode
      if (item.decision && item.decision !== 'unresolvable') {
        const extCall = extCallMap.get(item.externalCallId);
        if (extCall) {
          extCall.metadata.resolvedEndpointId = item.decision;
          extCall.metadata.mergeStatus = 'resolved';
        }
        session.topology.edges.push({
          source: item.externalCallId,
          target: item.decision,
          kind: 'resolves_to',
          metadata: { via: 'user_decision' },
        });
      } else if (item.decision === 'unresolvable') {
        const extCall = extCallMap.get(item.externalCallId);
        if (extCall) extCall.metadata.mergeStatus = 'unresolvable';
      }
    }

    this.sessions.delete(dto.sessionId);

    await this.runEnrichment(session.topology);
    const stored = await this.persistTopology(
      session.repoName,
      session.name,
      session.source,
      session.tags,
      session.topology,
    );

    const allExternalCalls = collectExternalCalls(session.topology);

    return {
      status: 'complete',
      topologyId: stored.id,
      summary: buildProgress(session.topology, allExternalCalls, []),
    };
  }

  async list(dto: ListTopologiesDto): Promise<PagedResult<StoredTopology>> {
    const [items, total] = await this.storage.findAll({
      name: dto.name,
      tags: dto.tags,
      limit: dto.limit,
      offset: dto.offset,
    });
    return new PagedResult(items, total, dto.limit, dto.offset);
  }

  async get(id: string): Promise<StoredTopology> {
    const found = await this.storage.findById(id);
    if (!found) throw new NotFoundException(`Topology ${id} not found`);
    return found;
  }

  async update(id: string, dto: UpdateTopologyDto): Promise<StoredTopology> {
    await this.get(id);
    return this.storage.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.storage.delete(id);
    // Remove from ecosystem index
    const eco = this.ecosystem.getEcosystem();
    eco.services = eco.services.filter(s => s.id !== id);
    eco.databases = eco.databases.filter(d => !d.topologyFile.includes(id));
    eco.edges = eco.edges.filter(e => e.from !== id && e.to !== id);
    this.ecosystem.saveEcosystem(eco);
  }

  async describe(dto: ExportDescribeDto): Promise<{ sections: ExportSections }> {
    const prompt = dto.type === 'endpoint'
      ? this.buildEndpointPrompt(dto.context as EndpointContextDto)
      : this.buildServicePrompt(dto.context as ServiceContextDto);

    const raw = this.callLLM(prompt);
    return { sections: this.parseSections(raw, dto.type) };
  }

  private callLLM(prompt: string): string {
    if (process.env.ANTHROPIC_API_KEY) {
      // Synchronous-style via SDK would require async — use subprocess for simplicity
    }
    const result = spawnSync('claude', ['-p'], {
      input: prompt,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 4,
      shell: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || 'claude CLI failed');
    return result.stdout.trim();
  }

  private buildEndpointPrompt(ctx: EndpointContextDto): string {
    const params = ctx.params.map(p =>
      `  - ${p.name} (${p.in}, ${p.optional ? 'optional' : 'required'}, ${p.type})`
    ).join('\n') || '  (none)';
    const responses = ctx.responses.map(r => `  - ${r.status}${r.description ? ': ' + r.description : ''}`).join('\n') || '  (none)';
    const throws = ctx.throwStatuses.length ? ctx.throwStatuses.join(', ') : 'none';
    const deps = ctx.dependencies.map(d => `  - [${d.kind}] ${d.name}${d.operations?.length ? ' (' + d.operations.join(', ') + ')' : ''}`).join('\n') || '  (none)';
    const flow = ctx.flowSummary.map((s, i) => `  ${i + 1}. ${s}`).join('\n') || '  (not available)';

    return `You are a technical writer creating Confluence documentation for a REST endpoint.
Write in clear, professional English (or Portuguese if the humanName/description is already in Portuguese).
Return ONLY the requested sections, each preceded by its exact header.

Endpoint: ${ctx.method} ${ctx.path}
Service: ${ctx.serviceName}
${ctx.humanName ? `Human name: ${ctx.humanName}` : ''}
${ctx.controller ? `Controller: ${ctx.controller}` : ''}
${ctx.existingDescription ? `Existing description: ${ctx.existingDescription}` : ''}

Parameters:
${params}

Responses:
${responses}
Throws (HTTP status codes): ${throws}

Dependencies:
${deps}

Extracted flow (step-by-step with variable names, DB tables, transformations):
${flow}

Write the following sections in Markdown:

## Overview
(2-3 sentences: what this endpoint does, its purpose, when to use it)

## Flow Description
(Numbered steps describing the internal logic. Reference actual variable names, DB table names, service method calls, and data transformations exactly as they appear in the extracted flow above. Explain what each called service/method does with the data.)

## Outputs
(Table or bullet list of all HTTP response codes returned — both success (2xx) and errors (4xx/5xx) — with a brief description of when each is returned. Use the Responses list above as the source of truth.)

## Error Handling
(Bullet list of error scenarios with their HTTP codes and what triggers each, referencing the specific validation or service call that raises each error)

## Dependencies
(Bullet list of external systems/services/databases accessed and how, referencing actual table/entity names from the flow)`;
  }

  private buildServicePrompt(ctx: ServiceContextDto): string {
    const eps = ctx.endpoints.map(e =>
      `  - ${e.method} ${e.path}${e.humanName ? ': ' + e.humanName : ''}${e.description ? ' — ' + e.description : ''}`
    ).join('\n') || '  (none)';
    const dbs = ctx.databases.join(', ') || 'none';
    const brokers = ctx.brokers.join(', ') || 'none';

    return `You are a technical writer creating Confluence documentation for a microservice.
Write in clear, professional English (or Portuguese if the humanName/description is already in Portuguese).
Return ONLY the requested sections, each preceded by its exact header.

Service: ${ctx.name}
Language: ${ctx.language} | Framework: ${ctx.framework}
${ctx.humanName ? `Human name: ${ctx.humanName}` : ''}
${ctx.existingDescription ? `Existing description: ${ctx.existingDescription}` : ''}

Endpoints (${ctx.endpoints.length}):
${eps}

Databases: ${dbs}
Brokers: ${brokers}

Write the following sections in Markdown:

## Service Description
(3-4 sentences: the service's purpose, its responsibilities, and its role in the broader ecosystem)

## Architecture Notes
(Notable technical characteristics: patterns used, key dependencies, scalability considerations, important design decisions)`;
  }

  private parseSections(raw: string, type: 'endpoint' | 'service'): ExportSections {
    const sections: ExportSections = {};
    const headerMap: Record<string, keyof ExportSections> = {
      'overview': 'overview',
      'flow description': 'flowDescription',
      'outputs': 'outputs',
      'error handling': 'errorHandling',
      'dependencies': 'dependencies',
      'service description': 'serviceDescription',
      'architecture notes': 'architectureNotes',
    };

    // Split on ## headers
    const parts = raw.split(/^##\s+/m);
    for (const part of parts) {
      const newline = part.indexOf('\n');
      if (newline === -1) continue;
      const header = part.slice(0, newline).trim().toLowerCase();
      const body = part.slice(newline + 1).trim();
      const key = headerMap[header];
      if (key) (sections as any)[key] = body;
    }

    // Fallback: if nothing parsed, put entire response in the primary section
    if (Object.keys(sections).length === 0) {
      if (type === 'endpoint') sections.overview = raw;
      else sections.serviceDescription = raw;
    }

    return sections;
  }

  // ── Private helpers ────────────────────────────────────────

  private async runEnrichment(topology: SystemTopology): Promise<void> {
    for (const service of topology.services) {
      try {
        await enrichService(service, topology.databases, {
          apiKey: process.env.ANTHROPIC_API_KEY,
        });
      } catch {
        // Enrichment is best-effort — log and continue
      }
    }
  }

  private async persistTopology(
    repoName: string,
    name: string,
    source: SourceDescriptor,
    tags: string[],
    topology: SystemTopology,
  ): Promise<StoredTopology> {
    const stored = await this.storage.save(topology, { repoName, name, source, tags });
    this.updateEcosystem(stored);
    return stored;
  }

  private updateEcosystem(stored: StoredTopology): void {
    const eco = this.ecosystem.getEcosystem();
    const topologyFile = `topologies/${stored.id}.json`;

    // Upsert service entries
    for (const svc of stored.topology.services) {
      const existing = eco.services.findIndex(s => s.id === stored.id);
      const entry = {
        id: stored.id,
        name: svc.name,
        language: svc.metadata.language ?? 'unknown',
        framework: svc.metadata.framework ?? 'unknown',
        team: svc.metadata.team,
        repoUrl: svc.metadata.repository?.url,
        topologyFile,
        endpointCount: svc.endpoints.length,
        status: 'active' as const,
      };
      if (existing >= 0) eco.services[existing] = entry;
      else eco.services.push(entry);
    }

    // Upsert database entries
    for (const db of stored.topology.databases) {
      const dbId = `${stored.id}:${db.name}`;
      const existing = eco.databases.findIndex(d => d.id === dbId);
      const connCount = stored.topology.services.reduce(
        (n, svc) => n + svc.dependencies.filter(dep => dep.id === db.id).length, 0,
      );
      const entry = {
        id: dbId,
        name: db.name,
        kind: db.metadata.engine,
        topologyFile,
        connectionCount: connCount,
        status: 'active' as const,
      };
      if (existing >= 0) eco.databases[existing] = entry;
      else eco.databases.push(entry);
    }

    // Add edges from service → service (resolves_to edges)
    // targetServiceId is embedded in edge.metadata by service-merger so we can resolve
    // cross-topology calls without loading all stored topologies here.
    for (const edge of stored.topology.edges) {
      if (edge.kind !== 'resolves_to') continue;
      const targetServiceId = (edge.metadata as any)?.targetServiceId as string | undefined;
      if (!targetServiceId) continue;
      const ecoEdge = { from: stored.id, to: targetServiceId };
      const alreadyExists = eco.edges.some(e => e.from === ecoEdge.from && e.to === ecoEdge.to);
      if (!alreadyExists) eco.edges.push(ecoEdge);
    }

    // Add edges from service → database
    for (const svc of stored.topology.services) {
      for (const dep of svc.dependencies) {
        if (dep.targetKind === 'database') {
          const dbId = `${stored.id}:${dep.id}`;
          const ecoEdge = { from: stored.id, to: dbId };
          const alreadyExists = eco.edges.some(e => e.from === ecoEdge.from && e.to === ecoEdge.to);
          if (!alreadyExists) eco.edges.push(ecoEdge);
        }
      }
    }

    this.ecosystem.saveEcosystem(eco);
  }

  private deriveRepoName(source: SourceDescriptor, overrideName?: string): string {
    if (overrideName) return toRepoName(overrideName);
    switch (source.kind) {
      case 'local':  return toRepoName(source.path.split(/[\\/]/).pop() ?? source.path);
      case 'git':    return toRepoName(source.url.split('/').pop()?.replace(/\.git$/, '') ?? source.url);
      case 'github': return toRepoName(`${source.owner}-${source.repo}`);
    }
  }

  private pruneStaleSessions(): void {
    const cutoff = Date.now() - 30 * 60 * 1000; // 30 minutes
    for (const [id, session] of this.sessions) {
      if (session.createdAt < cutoff) this.sessions.delete(id);
    }
  }
}

// ── Utility functions ──────────────────────────────────────

function toRepoName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function collectExternalCalls(topology: SystemTopology): ExternalCallNode[] {
  const results: ExternalCallNode[] = [];
  function walk(nodes: import('@topology/core').CodeNode[]): void {
    for (const n of nodes) {
      if (n.type === 'externalCall') results.push(n as ExternalCallNode);
      walk(n.children);
    }
  }
  for (const svc of topology.services) {
    walk(svc.endpoints as import('@topology/core').CodeNode[]);
    walk(svc.functions as import('@topology/core').CodeNode[]);
  }
  return results;
}

function buildExternalCallMap(topology: SystemTopology): Map<string, ExternalCallNode> {
  const map = new Map<string, ExternalCallNode>();
  for (const call of collectExternalCalls(topology)) map.set(call.id, call);
  return map;
}

function buildProgress(
  topology: SystemTopology,
  externalCalls: ExternalCallNode[],
  pending: PendingMergeEntry[],
) {
  const resolved = externalCalls.filter(c => c.metadata.mergeStatus === 'resolved').length;
  return {
    servicesDetected: topology.services.length,
    endpointsExtracted: topology.services.reduce((n, s) => n + s.endpoints.length, 0),
    databasesFound: topology.databases.length,
    externalCallsTotal: externalCalls.length,
    externalCallsResolved: resolved,
    externalCallsPending: pending.length,
  };
}
