import type { ServiceNode, FunctionNode, DataNode, Edge, Diagnostic } from '../types/topology';

const HTTP_DECORATORS = new Set([
  'Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All',
  'MessagePattern', 'EventPattern', 'GrpcMethod',
  'Cron', 'Interval', 'Timeout',
]);

const LIFECYCLE_DECORATORS = new Set([
  'OnModuleInit', 'OnModuleDestroy',
  'OnApplicationBootstrap', 'OnApplicationShutdown',
  'BeforeApplicationShutdown',
]);

const UTILITY_PATH_PATTERNS = [/\/utils?\//i, /\/helpers?\//i, /\/shared\//i, /\/common\//i, /\/lib\//i];

/**
 * Detecta funções e variáveis não utilizadas e emite Diagnostics.
 */
export function detectUnused(
  services: ServiceNode[],
  edges: Edge[],
  diagnostics: Diagnostic[],
): void {
  detectUnusedFunctions(services, edges, diagnostics);
  detectUnusedVariables(services, edges, diagnostics);
}

// ── Funções não utilizadas ────────────────────────────────────────────────────

function detectUnusedFunctions(
  services: ServiceNode[],
  edges: Edge[],
  diagnostics: Diagnostic[],
): void {
  // Conjunto de IDs que são destino de alguma edge 'calls'
  const reachedIds = new Set(
    edges.filter(e => e.kind === 'calls').map(e => e.to),
  );

  for (const svc of services) {
    for (const fn of svc.functions) {
      if (reachedIds.has(fn.id)) continue;
      if (isEntryPoint(fn)) continue;

      const isUtility = UTILITY_PATH_PATTERNS.some(p => p.test(fn.location.file));

      diagnostics.push({
        level: isUtility ? 'info' : 'warning',
        message: `Function '${fn.name}' appears to be unused (no incoming calls detected).`,
        location: fn.location,
        rule: 'unused-function',
      });
    }
  }
}

function isEntryPoint(fn: FunctionNode): boolean {
  if (fn.metadata.kind === 'constructor') return true;
  if (fn.metadata.kind === 'getter' || fn.metadata.kind === 'setter') return true;

  const decorators = fn.metadata.decorators ?? [];
  if (decorators.some(d => HTTP_DECORATORS.has(d))) return true;
  if (decorators.some(d => LIFECYCLE_DECORATORS.has(d))) return true;

  return false;
}

// ── Variáveis não utilizadas ──────────────────────────────────────────────────

function detectUnusedVariables(
  services: ServiceNode[],
  edges: Edge[],
  diagnostics: Diagnostic[],
): void {
  // Conjunto de IDs de DataNodes que aparecem como 'from' em edges 'uses'
  const usedVarIds = new Set(
    edges.filter(e => e.kind === 'uses').map(e => e.from),
  );

  for (const svc of services) {
    for (const fn of svc.functions) {
      for (const child of fn.children) {
        if (child.type !== 'data') continue;
        const dataNode = child as DataNode;
        if (dataNode.metadata.scope !== 'local') continue;
        if (usedVarIds.has(dataNode.id)) continue;

        diagnostics.push({
          level: 'warning',
          message: `Variable '${dataNode.name}' is declared but never read.`,
          location: dataNode.location,
          rule: 'unused-variable',
        });
      }
    }
  }
}
