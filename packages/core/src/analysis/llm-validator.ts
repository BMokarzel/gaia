import Anthropic from '@anthropic-ai/sdk';
import { spawnSync } from 'child_process';
import { sanitizeForPrompt } from '../utils/prompt-sanitizer';
import type {
  ServiceNode, EndpointNode, FunctionNode, CodeNode,
  DbProcessNode, ExternalCallNode, ReturnNode, ThrowNode,
  FlowControlNode, CallNode, GraphValidationResult, GraphValidationIssue,
} from '../types/topology';

// ── LLM caller (SDK or CLI fallback) ─────────────────────────────────────────

type LLMCaller = (prompt: string, model: string) => Promise<string>;

function makeLLMCaller(apiKey?: string): LLMCaller {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;

  if (key) {
    const client = new Anthropic({ apiKey: key });
    return async (prompt, model) => {
      const res = await client.messages.create({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });
      return res.content[0].type === 'text' ? res.content[0].text : '';
    };
  }

  return async (prompt) => {
    const result = spawnSync('claude', ['-p'], {
      input: prompt,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 2,
      shell: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || 'claude CLI failed');
    return result.stdout.trim();
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface LLMValidatorConfig {
  /** Anthropic API key — defaults to process.env.ANTHROPIC_API_KEY */
  apiKey?: string;
  /** Model for scoring (cheap, fast) — default: claude-haiku-4-5-20251001 */
  modelScorer?: string;
  /** Model for detailed feedback (if score is low) — default: claude-sonnet-4-6 */
  modelReviewer?: string;
  /** Coherence score threshold below which detailed feedback is requested (0–100) */
  feedbackThreshold?: number;
  /** Only validate endpoints with children (has extracted flow) */
  onlyWithFlow?: boolean;
  /** Max endpoints to validate per service call (to limit cost) */
  maxEndpointsPerService?: number;
}

const DEFAULTS = {
  modelScorer: 'claude-haiku-4-5-20251001',
  modelReviewer: 'claude-sonnet-4-6',
  feedbackThreshold: 70,
  onlyWithFlow: true,
  maxEndpointsPerService: 10,
};

/**
 * Runs LLM-based coherence validation on a service's endpoint flows.
 * Returns a GraphValidationResult per service.
 */
export async function validateServiceWithLLM(
  service: ServiceNode,
  config: LLMValidatorConfig = {},
): Promise<GraphValidationResult> {
  const cfg = { ...DEFAULTS, ...config };
  const caller = makeLLMCaller(cfg.apiKey);
  const issues: GraphValidationIssue[] = [];
  let totalScore = 0;
  let scoredCount = 0;

  let endpoints = service.endpoints;
  if (cfg.onlyWithFlow) {
    endpoints = endpoints.filter(ep => ep.children.length > 0);
  }
  if (endpoints.length > cfg.maxEndpointsPerService) {
    endpoints = endpoints.slice(0, cfg.maxEndpointsPerService);
  }

  for (const ep of endpoints) {
    try {
      const result = await validateEndpointFlow(ep, service, caller, cfg);
      issues.push(...result.issues);
      totalScore += result.score;
      scoredCount++;
    } catch (err) {
      issues.push({
        severity: 'warning',
        description: `LLM validation failed for endpoint "${ep.id}": ${(err as Error).message}`,
        nodeId: ep.id,
      });
    }
  }

  return {
    serviceId: service.id,
    issues,
    coherenceScore: scoredCount > 0 ? Math.round(totalScore / scoredCount) : 100,
    validatedAt: new Date().toISOString(),
  };
}

// ── Endpoint flow validation ──────────────────────────────────────────────────

interface EndpointValidationResult {
  score: number;
  issues: GraphValidationIssue[];
}

async function validateEndpointFlow(
  ep: EndpointNode,
  svc: ServiceNode,
  caller: LLMCaller,
  cfg: typeof DEFAULTS,
): Promise<EndpointValidationResult> {
  const issues: GraphValidationIssue[] = [];
  const flowSummary = serializeEndpointFlow(ep, svc);

  const scorePrompt = buildScorerPrompt(ep, svc, flowSummary);
  const scoreText = await caller(scorePrompt, cfg.modelScorer);

  const parsed = parseScoreResponse(scoreText);

  if (parsed.score < cfg.feedbackThreshold) {
    // Request detailed feedback with a better model
    const reviewPrompt = buildReviewerPrompt(ep, svc, flowSummary, parsed.score, parsed.reason);
    const reviewText = await caller(reviewPrompt, cfg.modelReviewer);
    const feedbackIssues = parseFeedbackResponse(reviewText, ep.id);
    issues.push(...feedbackIssues);
  } else if (parsed.issues && parsed.issues.length > 0) {
    for (const i of parsed.issues) {
      issues.push({
        severity: 'info',
        description: i,
        nodeId: ep.id,
      });
    }
  }

  if (parsed.score < cfg.feedbackThreshold) {
    issues.push({
      severity: 'warning',
      description: `EndpointNode "${ep.id}" (${ep.metadata.method} ${ep.metadata.path}) has low coherence score: ${parsed.score}/100`,
      nodeId: ep.id,
      suggestion: parsed.reason,
    });
  }

  return { score: parsed.score, issues };
}

// ── Flow serialization ────────────────────────────────────────────────────────

function serializeEndpointFlow(ep: EndpointNode, svc: ServiceNode): string {
  const lines: string[] = [];

  lines.push(`ENDPOINT: ${ep.metadata.method} ${ep.metadata.path}`);
  if (ep.metadata.request.params?.length) {
    lines.push(`  Params: ${ep.metadata.request.params.map(p => `${p.name}:${p.type}`).join(', ')}`);
  }
  if (ep.metadata.request.body?.length) {
    lines.push(`  Body: ${ep.metadata.request.body.map(f => `${f.name}:${f.type}`).join(', ')}`);
  }
  if (ep.metadata.responses.length > 0) {
    lines.push(`  Responses: ${ep.metadata.responses.map(r => `${r.httpStatus}(${r.source})`).join(', ')}`);
  }

  lines.push('  Flow:');
  serializeNodes(ep.children, svc, lines, 2);

  return lines.join('\n');
}

function serializeNodes(nodes: CodeNode[], svc: ServiceNode, lines: string[], depth: number): void {
  const indent = '    '.repeat(depth);
  for (const node of nodes) {
    switch (node.type) {
      case 'call': {
        const c = node as CallNode;
        lines.push(`${indent}CALL ${c.metadata.callee}${c.metadata.awaited ? ' (await)' : ''}`);
        break;
      }
      case 'dbProcess': {
        const db = node as DbProcessNode;
        lines.push(`${indent}DB ${db.metadata.operation} → ${db.metadata.tableId || db.metadata.databaseId}`);
        break;
      }
      case 'externalCall': {
        const ec = node as ExternalCallNode;
        lines.push(`${indent}HTTP ${ec.metadata.method} ${ec.metadata.path}${ec.metadata.mergeStatus === 'resolved' ? ` → ${ec.metadata.resolvedEndpointId}` : ' (unresolved)'}`);
        break;
      }
      case 'flowControl': {
        const fc = node as FlowControlNode;
        lines.push(`${indent}${fc.metadata.kind.toUpperCase()}${fc.metadata.condition ? ` (${fc.metadata.condition})` : ''}`);
        if (fc.children.length > 0) serializeNodes(fc.children, svc, lines, depth + 1);
        if (fc.metadata.branches) {
          for (const branch of fc.metadata.branches) {
            lines.push(`${indent}  [${branch.label}]`);
            serializeNodes(branch.children, svc, lines, depth + 2);
          }
        }
        break;
      }
      case 'return': {
        const r = node as ReturnNode;
        lines.push(`${indent}RETURN${r.metadata.httpStatus ? ` ${r.metadata.httpStatus}` : ''}${r.metadata.value ? ` → ${r.metadata.value}` : ''}`);
        break;
      }
      case 'throw': {
        const t = node as ThrowNode;
        lines.push(`${indent}THROW ${t.metadata.errorClass}${t.metadata.httpStatus ? ` (${t.metadata.httpStatus})` : ''}`);
        break;
      }
      default:
        if (node.children.length > 0) serializeNodes(node.children, svc, lines, depth);
        break;
    }
  }
}

// ── Prompts ───────────────────────────────────────────────────────────────────

function buildScorerPrompt(ep: EndpointNode, svc: ServiceNode, flowSummary: string): string {
  return `You are a senior software architect reviewing an automatically extracted endpoint flow from a ${sanitizeForPrompt(svc.metadata.language ?? 'unknown')} microservice named "${sanitizeForPrompt(svc.name)}".

Rate the coherence and completeness of this extracted endpoint flow on a scale of 0–100.

Consider:
- Does the flow make sense for the endpoint's HTTP method and path?
- Are database operations appropriate for this endpoint?
- Are there obvious missing steps (auth check, validation, error handling)?
- Does the return/throw pattern match HTTP conventions?

Extracted flow:
${sanitizeForPrompt(flowSummary)}

Respond with JSON only:
{
  "score": 85,
  "reason": "brief explanation of the score",
  "issues": ["optional list of minor issues even at high scores"]
}`;
}

function buildReviewerPrompt(
  ep: EndpointNode,
  svc: ServiceNode,
  flowSummary: string,
  score: number,
  reason: string,
): string {
  return `You are a senior software architect. An automated tool scored the following endpoint flow ${score}/100 with reason: "${sanitizeForPrompt(reason)}".

Service: ${sanitizeForPrompt(svc.name)} (${sanitizeForPrompt(svc.metadata.language ?? 'unknown')})
Endpoint: ${ep.metadata.method} ${sanitizeForPrompt(ep.metadata.path)}

Extracted flow:
${sanitizeForPrompt(flowSummary)}

Provide specific, actionable feedback. What is likely wrong or missing in this extracted flow?

Respond with JSON only:
{
  "issues": [
    {
      "severity": "warning",
      "description": "specific issue description",
      "suggestion": "how to fix or investigate"
    }
  ]
}`;
}

// ── Response parsers ──────────────────────────────────────────────────────────

interface ScoreResponse {
  score: number;
  reason: string;
  issues?: string[];
}

function parseScoreResponse(text: string): ScoreResponse {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { score: 50, reason: 'Could not parse LLM response' };
    const parsed = JSON.parse(match[0]);
    return {
      score: typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      issues: Array.isArray(parsed.issues) ? parsed.issues.filter((i: unknown) => typeof i === 'string') : [],
    };
  } catch {
    return { score: 50, reason: 'JSON parse error in LLM response' };
  }
}

function parseFeedbackResponse(text: string, endpointId: string): GraphValidationIssue[] {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.issues)) return [];

    return parsed.issues.map((i: { severity?: string; description?: string; suggestion?: string }) => ({
      severity: (i.severity === 'error' || i.severity === 'warning' || i.severity === 'info')
        ? i.severity
        : 'info' as const,
      description: typeof i.description === 'string' ? i.description : 'LLM feedback',
      suggestion: typeof i.suggestion === 'string' ? i.suggestion : undefined,
      nodeId: endpointId,
    }));
  } catch {
    return [];
  }
}
