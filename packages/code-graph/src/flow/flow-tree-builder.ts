/**
 * FlowTreeBuilder — algoritmo de construção de FlowTree (§6.2).
 *
 * Mistura três fontes de filhos por nó:
 *   1. `contains` filtrados por `isFlowRelevant` (estrutura interna)
 *   2. Para `call_site` resolvido → expande o método chamado via 'calls'
 *   3. Para `branch` → conecta `branch_then` e `branch_else` como
 *      'branches_to' (já capturados como contains, então nada extra
 *      é necessário aqui — preservamos a aresta como contains).
 *
 * Detecção de ciclo é via path stack: se o id atual já está na pilha,
 * empurra um marker de ciclo e registra o sub-path em stats.detectedCycles.
 */

import type { ElementGraph } from '../graph';
import type { Element } from '../element';
import type { EdgeKind, EdgeMeta } from '../edge';
import { labelFor } from '../labels';
import {
  type FlowNode,
  type FlowTree,
  type FlowOptions,
  type FlowStats,
  DEFAULT_FLOW_OPTIONS,
  isFlowRelevant,
} from './flow-tree';

interface BuildState {
  graph: ElementGraph;
  options: Required<FlowOptions>;
  stack: Set<string>;
  path: string[];
  stats: FlowStats;
}

export function buildFlowTree(
  entryId: string,
  graph: ElementGraph,
  options: FlowOptions = {},
): FlowTree {
  const merged: Required<FlowOptions> = { ...DEFAULT_FLOW_OPTIONS, ...options };
  const state: BuildState = {
    graph,
    options: merged,
    stack: new Set(),
    path: [],
    stats: { totalNodes: 0, maxDepth: 0, unresolvedCalls: 0, detectedCycles: [] },
  };

  const root = buildNode(entryId, null, undefined, 0, state);
  if (!root) {
    throw new Error(`buildFlowTree: entry element ${entryId} não encontrado no grafo`);
  }
  return { root, stats: state.stats };
}

function buildNode(
  id: string,
  edgeKind: EdgeKind | null,
  edgeMeta: EdgeMeta | undefined,
  depth: number,
  state: BuildState,
): FlowNode | null {
  const element = state.graph.getElement(id);
  if (!element) return null;

  state.stats.totalNodes++;
  if (depth > state.stats.maxDepth) state.stats.maxDepth = depth;

  if (depth >= state.options.maxDepth) {
    return makeMarker(element, edgeKind, edgeMeta, 'max_depth');
  }

  if (state.stack.has(id)) {
    const idx = state.path.indexOf(id);
    if (idx >= 0) state.stats.detectedCycles.push(state.path.slice(idx).concat(id));
    return makeMarker(element, edgeKind, edgeMeta, 'cycle');
  }

  state.stack.add(id);
  state.path.push(id);

  const node: FlowNode = {
    elementId: id,
    element,
    label: labelFor(element),
    edgeKind,
    edgeMeta,
    children: [],
  };

  // 1. filhos estruturais (contains) que sejam fluxo-relevantes
  const containsChildren = state.graph
    .getChildren(id)
    .filter(isFlowRelevant)
    .sort(byLocation);

  for (const child of containsChildren) {
    const c = buildNode(child.id, 'contains', undefined, depth + 1, state);
    if (c) node.children.push(c);
  }

  // 2. call_site → expande método chamado
  if (element.kind === 'call_site') {
    const callsEdges = state.graph.getOutgoing(id, 'calls');
    if (callsEdges.length === 0) {
      const callee = (element.meta as { calleeText?: string }).calleeText ?? '';
      state.stats.unresolvedCalls++;
      if (state.options.showExternalCalls && callee) {
        node.children.push({
          elementId: id + ':external',
          element,
          label: `→ external: ${callee}`,
          edgeKind: 'calls',
          edgeMeta: { label: callee, external: true },
          children: [],
          marker: 'unresolved',
        });
      }
    } else {
      for (const edge of callsEdges) {
        const c = buildNode(
          edge.to,
          'calls',
          { ...edge.meta, label: (element.meta as { calleeText?: string }).calleeText },
          depth + 1,
          state,
        );
        if (c) node.children.push(c);
      }
    }
  }

  state.stack.delete(id);
  state.path.pop();
  return node;
}

function makeMarker(
  element: Element,
  edgeKind: EdgeKind | null,
  edgeMeta: EdgeMeta | undefined,
  marker: 'cycle' | 'max_depth',
): FlowNode {
  return {
    elementId: element.id,
    element,
    label: marker === 'cycle' ? `↻ cycle: ${labelFor(element)}` : `… max depth (${labelFor(element)})`,
    edgeKind,
    edgeMeta,
    children: [],
    marker,
  };
}

function byLocation(a: Element, b: Element): number {
  if (a.location.startLine !== b.location.startLine) {
    return a.location.startLine - b.location.startLine;
  }
  return a.location.startCol - b.location.startCol;
}
