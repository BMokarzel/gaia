/**
 * FlowTree — view computada sobre o ElementGraph.
 *
 * É uma árvore (não grafo) — ciclos detectados durante a construção
 * viram folhas marcadoras. A árvore mistura semântica de:
 *   - 'contains' (filhos estruturais que são fluxo-relevantes)
 *   - 'calls'    (expansão da função chamada num call_site)
 *   - 'branches_to' (then/else explícitos sob branch)
 */

import type { Element, ElementKind } from '../element';
import type { EdgeKind, EdgeMeta } from '../edge';

export interface FlowNode {
  elementId: string;
  element: Element;
  label: string;
  /** Como chegamos aqui. `null` na raiz. */
  edgeKind: EdgeKind | null;
  edgeMeta?: EdgeMeta;
  children: FlowNode[];
  /** Marcadores opcionais — ciclos, max-depth, etc. */
  marker?: 'cycle' | 'max_depth' | 'unresolved';
}

export interface FlowStats {
  totalNodes: number;
  maxDepth: number;
  unresolvedCalls: number;
  detectedCycles: string[][];
}

export interface FlowTree {
  root: FlowNode;
  stats: FlowStats;
}

export interface FlowOptions {
  maxDepth?: number;
  /** Se true, expande call_sites externos como folhas marcadoras. */
  showExternalCalls?: boolean;
}

export const DEFAULT_FLOW_OPTIONS: Required<FlowOptions> = {
  maxDepth: 32,
  showExternalCalls: true,
};

/**
 * Conjunto de kinds que aparecem na FlowTree (§6.3).
 */
export const FLOW_RELEVANT_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>([
  'method',
  'function',
  'constructor',
  'arrow_function',
  'getter',
  'setter',
  'branch',
  'branch_then',
  'branch_else',
  'loop',
  'loop_body',
  'try_block',
  'catch_block',
  'finally_block',
  'call_site',
  'return_site',
  'throw_site',
  'assign_site',
  'await_site',
]);

export function isFlowRelevant(element: Element): boolean {
  return FLOW_RELEVANT_KINDS.has(element.kind);
}
