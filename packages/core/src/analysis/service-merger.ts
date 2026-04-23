import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import { sanitizeForPrompt } from '../utils/prompt-sanitizer';
import { writeFileSync, readFileSync, existsSync } from 'fs';

function callViaCLI(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p'], { stdio: ['pipe', 'pipe', 'pipe'], shell: true });
    let out = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stdin.write(prompt);
    child.stdin.end();
    child.on('close', (code) => {
      if (code !== 0) reject(new Error('claude CLI failed'));
      else resolve(out.trim());
    });
    child.on('error', reject);
  });
}
import { resolve } from 'path';
import type {
  ServiceNode, EndpointNode, ExternalCallNode, Edge,
  PendingMergeEntry, PendingMergesFile, PendingMergeCandidate,
} from '../types/topology';
import { normalizeHttpPath } from '../extractors/ts/http-client.extractor';

interface MergeLLMResult {
  resolvedEndpointId: string | 'unresolvable';
  confidence: number;
  certain: boolean;
  reason: string;
}

/**
 * Executa o merge cross-service: para cada ExternalCallNode provisional,
 * encontra candidatos e confirma com LLM.
 * Retorna edges resolves_to + PendingMergeEntry[] para casos incertos.
 */
export async function runCrossServiceMerge(
  services: ServiceNode[],
  externalCalls: ExternalCallNode[],
  apiKey?: string,
): Promise<{ edges: Edge[]; pending: PendingMergeEntry[] }> {
  const edges: Edge[] = [];
  const pending: PendingMergeEntry[] = [];

  if (externalCalls.length === 0) return { edges, pending };

  const resolvedKey = apiKey ?? process.env.ANTHROPIC_API_KEY;
  const client = resolvedKey ? new Anthropic({ apiKey: resolvedKey }) : null;

  // Índice global de endpoints por (method, pathNormalized)
  const endpointIndex = buildEndpointIndex(services);

  // Mapa de serviceId → serviceName
  const serviceNames = new Map(services.map(s => [s.id, s.name]));

  for (const extCall of externalCalls) {
    if (extCall.metadata.mergeStatus === 'resolved') continue;

    const candidates = findCandidates(extCall, endpointIndex, services);

    if (candidates.length === 0) {
      extCall.metadata.mergeStatus = 'unresolvable';
      continue;
    }

    if (candidates.length === 1 && candidates[0].confidence >= 0.95) {
      // Alta confiança + único candidato → merge direto sem LLM
      applyResolution(extCall, candidates[0].endpointId, candidates[0].serviceId, candidates[0].confidence, 'unique high-confidence match', edges, services);
      continue;
    }

    // Consulta LLM para confirmar
    try {
      const callerService = findCallerService(extCall, services);
      const result = await confirmWithLLM(client, extCall, candidates, callerService, serviceNames);

      if (result.certain && result.resolvedEndpointId !== 'unresolvable') {
        const winnerServiceId = candidates.find(c => c.endpointId === result.resolvedEndpointId)?.serviceId ?? 'unknown';
        applyResolution(extCall, result.resolvedEndpointId, winnerServiceId, result.confidence, result.reason, edges, services);
      } else {
        extCall.metadata.mergeStatus = 'pending_review';
        extCall.metadata.mergeConfidence = result.confidence;
        extCall.metadata.mergeReason = result.reason;

        pending.push({
          externalCallId: extCall.id,
          context: {
            callerServiceId: callerService?.id ?? 'unknown',
            callerServiceName: callerService?.name ?? 'unknown',
            method: extCall.metadata.method,
            path: extCall.metadata.path,
            bodyFields: extCall.metadata.bodyFields,
          },
          candidates,
          llmReason: result.reason,
          decision: null,
        });
      }
    } catch (err) {
      extCall.metadata.mergeStatus = 'pending_review';
      extCall.metadata.mergeReason = `LLM error: ${(err as Error).message}`;
    }
  }

  return { edges, pending };
}

/**
 * Lê pending-merges.json, aplica as decisões e retorna edges.
 */
export function applyPendingMerges(
  pendingMergesPath: string,
  services: ServiceNode[],
  externalCalls: ExternalCallNode[],
): Edge[] {
  if (!existsSync(pendingMergesPath)) {
    throw new Error(`pending-merges.json not found: ${pendingMergesPath}`);
  }

  const file: PendingMergesFile = JSON.parse(readFileSync(pendingMergesPath, 'utf-8'));
  const edges: Edge[] = [];

  const extCallMap = new Map(externalCalls.map(e => [e.id, e]));

  for (const entry of file.pendingMerges) {
    if (!entry.decision) continue;

    const extCall = extCallMap.get(entry.externalCallId);
    if (!extCall) continue;

    if (entry.decision === 'unresolvable') {
      extCall.metadata.mergeStatus = 'unresolvable';
      continue;
    }

    const targetSvcId = services.find(s => s.endpoints.some(ep => ep.id === entry.decision))?.id ?? 'unknown';
    applyResolution(extCall, entry.decision, targetSvcId, 1.0, 'user decision', edges, services);
  }

  return edges;
}

/**
 * Persiste pending-merges.json ao lado do topology.json.
 */
export function writePendingMerges(
  topologyPath: string,
  pending: PendingMergeEntry[],
): string {
  const dir = topologyPath.replace(/[/\\][^/\\]+$/, '');
  const outPath = resolve(dir, 'pending-merges.json');

  const file: PendingMergesFile = {
    generatedAt: new Date().toISOString(),
    topologyPath,
    pendingMerges: pending,
  };

  writeFileSync(outPath, JSON.stringify(file, null, 2), 'utf-8');
  return outPath;
}

// ── Internals ──────────────────────────────────────────────

interface EndpointEntry {
  endpointId: string;
  serviceId: string;
  method: string;
  pathNormalized: string;
  path: string;
}

function buildEndpointIndex(services: ServiceNode[]): EndpointEntry[] {
  const entries: EndpointEntry[] = [];
  for (const service of services) {
    for (const ep of service.endpoints) {
      entries.push({
        endpointId: ep.id,
        serviceId: service.id,
        method: ep.metadata.method,
        pathNormalized: normalizeHttpPath(ep.metadata.path),
        path: ep.metadata.path,
      });
    }
  }
  return entries;
}

function findCandidates(
  extCall: ExternalCallNode,
  index: EndpointEntry[],
  services: ServiceNode[],
): PendingMergeCandidate[] {
  const callerServiceId = findCallerService(extCall, services)?.id;

  return index
    .filter(ep => {
      // Exclui endpoints do próprio serviço chamador
      if (ep.serviceId === callerServiceId) return false;
      return ep.method === extCall.metadata.method &&
        ep.pathNormalized === extCall.metadata.pathNormalized;
    })
    .map(ep => {
      const svc = services.find(s => s.id === ep.serviceId)!;
      const confidence = computeConfidence(extCall, ep);
      return {
        endpointId: ep.endpointId,
        serviceId: ep.serviceId,
        serviceName: svc?.name ?? ep.serviceId,
        method: ep.method,
        path: ep.path,
        confidence,
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

function computeConfidence(extCall: ExternalCallNode, ep: EndpointEntry): number {
  let score = 0;
  // Method + path normalizado já filtraram antes de chegar aqui
  score += 0.6;

  // Bonus: path original mais específico (menos :param)
  const extNorm = extCall.metadata.pathNormalized ?? '';
  const extParams = (extNorm.match(/:param/g) ?? []).length;
  const epParams = (ep.pathNormalized.match(/:param/g) ?? []).length;
  if (extParams === epParams) score += 0.2;

  // Bonus: baseUrl resolve para nome do serviço
  if (extCall.metadata.baseUrl) {
    const baseUrl = extCall.metadata.baseUrl.toLowerCase();
    const svcName = ep.serviceId.toLowerCase();
    if (baseUrl.includes(svcName.replace('service', '').replace('-', ''))) score += 0.2;
  }

  return Math.min(score, 1.0);
}

async function confirmWithLLM(
  client: Anthropic | null,
  extCall: ExternalCallNode,
  candidates: PendingMergeCandidate[],
  callerService: ServiceNode | undefined,
  serviceNames: Map<string, string>,
): Promise<MergeLLMResult> {
  const candidateList = candidates
    .map((c, i) => `[${i + 1}] ${c.serviceName}: ${c.method} ${c.path} (confidence: ${(c.confidence * 100).toFixed(0)}%)`)
    .join('\n');

  const prompt = `You are analyzing a microservices architecture graph. Determine which endpoint is being called.

Caller service: ${sanitizeForPrompt(callerService?.name ?? 'unknown')} (${callerService?.metadata?.language ?? 'unknown'})
External HTTP call: ${extCall.metadata.method} ${sanitizeForPrompt(extCall.metadata.path)}
${extCall.metadata.bodyFields?.length ? `Body fields: ${extCall.metadata.bodyFields.map(sanitizeForPrompt).join(', ')}` : ''}
${extCall.metadata.baseUrl ? `Base URL hint: ${sanitizeForPrompt(extCall.metadata.baseUrl)}` : ''}

Candidates:
${candidateList}

Respond with JSON only:
{
  "resolvedIndex": 1,
  "confidence": 0.85,
  "certain": true,
  "reason": "brief explanation"
}

If none match or you cannot determine: { "resolvedIndex": 0, "confidence": 0, "certain": false, "reason": "..." }
If multiple equally plausible: { "resolvedIndex": 0, "confidence": 0.5, "certain": false, "reason": "..." }`;

  let text: string;
  if (client) {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });
    text = response.content[0].type === 'text' ? response.content[0].text : '';
  } else {
    text = await callViaCLI(prompt);
  }

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const parsed = JSON.parse(jsonMatch[0]);
    const idx = (parsed.resolvedIndex as number) - 1;
    const resolvedCandidate = idx >= 0 && idx < candidates.length ? candidates[idx] : null;

    return {
      resolvedEndpointId: resolvedCandidate?.endpointId ?? 'unresolvable',
      confidence: parsed.confidence ?? 0,
      certain: parsed.certain === true && resolvedCandidate !== null,
      reason: parsed.reason ?? '',
    };
  } catch {
    return { resolvedEndpointId: 'unresolvable', confidence: 0, certain: false, reason: 'LLM parse error' };
  }
}

function applyResolution(
  extCall: ExternalCallNode,
  endpointId: string,
  targetServiceId: string,
  confidence: number,
  reason: string,
  edges: Edge[],
  services: ServiceNode[],
): void {
  extCall.metadata.resolvedEndpointId = endpointId;
  extCall.metadata.mergeStatus = 'resolved';
  extCall.metadata.mergeConfidence = confidence;
  extCall.metadata.mergeReason = reason;

  // Use parent function/endpoint ID as source so the edge references a top-level node
  const sourceId = findParentContainerId(extCall, services) ?? extCall.id;

  edges.push({
    source: sourceId,
    target: endpointId,
    kind: 'resolves_to',
    metadata: { confidence, reason, targetServiceId },
  });
}

function findParentContainerId(
  extCall: ExternalCallNode,
  services: ServiceNode[],
): string | undefined {
  const file = extCall.location.file;
  const line = extCall.location.line;
  let best: { id: string; span: number } | undefined;

  for (const svc of services) {
    for (const container of [...svc.functions, ...svc.endpoints]) {
      if (container.location.file !== file) continue;
      const start = container.location.line;
      const end = container.location.endLine ?? start;
      if (line >= start && line <= end) {
        const span = end - start;
        if (!best || span < best.span) best = { id: container.id, span };
      }
    }
  }

  return best?.id;
}

function findCallerService(
  extCall: ExternalCallNode,
  services: ServiceNode[],
): ServiceNode | undefined {
  const file = extCall.location.file;
  return services.find(s =>
    s.functions.some(f => f.location.file === file) ||
    s.endpoints.some(e => e.location.file === file),
  );
}
