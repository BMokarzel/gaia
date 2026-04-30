/**
 * Detecção de ciclos em grafos dirigidos via DFS.
 * Usado pelas queries (`cycles`) e indiretamente como referência mental
 * pelo FlowTreeBuilder (que faz a sua própria detecção via path stack).
 */

import type { ElementGraph } from '../graph';
import type { EdgeKind } from '../edge';

export interface CycleDetectorOptions {
  /** Quais edge kinds seguir. Default: ['calls']. */
  followEdges?: ReadonlyArray<EdgeKind>;
  /** Limite duro de tamanho de ciclo capturado. */
  maxCycleLength?: number;
}

export function detectCycles(
  graph: ElementGraph,
  options: CycleDetectorOptions = {},
): string[][] {
  const follow = new Set<EdgeKind>(options.followEdges ?? ['calls']);
  const maxLen = options.maxCycleLength ?? 64;

  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();

  function dfs(id: string): void {
    if (stack.has(id)) {
      // ciclo encontrado — extrair sub-path desde a primeira ocorrência
      const idx = path.indexOf(id);
      if (idx >= 0) {
        const cycle = path.slice(idx).concat(id);
        if (cycle.length <= maxLen) {
          const key = canonicalCycleKey(cycle);
          if (!seenCycleKeys.has(key)) {
            seenCycleKeys.add(key);
            cycles.push(cycle);
          }
        }
      }
      return;
    }
    if (visited.has(id)) return;

    visited.add(id);
    stack.add(id);
    path.push(id);

    const outgoing = [...graph.getOutgoing(id)].filter(e => follow.has(e.kind));
    for (const e of outgoing) dfs(e.to);

    path.pop();
    stack.delete(id);
  }

  for (const el of [...graph.getElementsByKind('method'), ...graph.getElementsByKind('function')]) {
    if (!visited.has(el.id)) dfs(el.id);
  }

  return cycles;
}

function canonicalCycleKey(cycle: string[]): string {
  // Rotaciona para começar pelo menor id — torna ciclos equivalentes
  // (mesma sequência rotacionada) um único registro.
  // Ignora o último elemento (que é igual ao primeiro).
  const ring = cycle.slice(0, -1);
  let minIdx = 0;
  for (let i = 1; i < ring.length; i++) {
    if (ring[i] < ring[minIdx]) minIdx = i;
  }
  const rotated = [...ring.slice(minIdx), ...ring.slice(0, minIdx)];
  return rotated.join('→');
}
