/**
 * Queries de alto nível sobre um ElementGraph já resolvido.
 *
 * Estas funções não mutam o grafo — apenas leem índices.
 */

import type { ElementGraph } from './graph';
import type { Element, ElementKind, CallSiteMeta } from './element';
import { detectCycles } from './flow/cycle-detector';

/**
 * Retorna todos os elementos cujos call_sites internos chamam o `targetId`.
 * O resultado contém methods/functions/constructors — o ANCESTRAL fluxo
 * do call_site, não o call_site em si.
 */
export function callersOf(graph: ElementGraph, targetId: string): Element[] {
  const callers: Element[] = [];
  const seen = new Set<string>();
  for (const inc of graph.getIncoming(targetId, 'calls')) {
    const callSite = graph.getElement(inc.from);
    if (!callSite) continue;
    const enclosing = findEnclosingFunction(graph, callSite);
    if (enclosing && !seen.has(enclosing.id)) {
      seen.add(enclosing.id);
      callers.push(enclosing);
    }
  }
  return callers;
}

/**
 * Retorna todas as funções/métodos chamadas DIRETAMENTE pela função
 * `sourceId` (filhos call_site dela com edge `calls`).
 */
export function calleesOf(graph: ElementGraph, sourceId: string): Element[] {
  const callees: Element[] = [];
  const seen = new Set<string>();
  const stack: string[] = [sourceId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const child of graph.getChildren(id)) {
      if (child.kind === 'call_site') {
        for (const e of graph.getOutgoing(child.id, 'calls')) {
          if (!seen.has(e.to)) {
            seen.add(e.to);
            const target = graph.getElement(e.to);
            if (target) callees.push(target);
          }
        }
      }
      // recursa em sub-blocks (branch_then, loops, try_block, etc.)
      stack.push(child.id);
    }
  }
  return callees;
}

/**
 * Retorna funções/métodos que NÃO são chamadas por ninguém (incoming
 * `calls` vazio) e que também não são pontos de entrada conhecidos.
 *
 * `entryFilter` permite excluir do dead-code aqueles tratados como
 * entradas (ex.: HTTP handlers em controllers).
 */
export function deadCode(
  graph: ElementGraph,
  entryFilter?: (el: Element) => boolean,
): Element[] {
  const callableKinds: ElementKind[] = ['method', 'function', 'arrow_function'];
  const out: Element[] = [];
  for (const k of callableKinds) {
    for (const el of graph.getElementsByKind(k)) {
      if (entryFilter && entryFilter(el)) continue;
      const incoming = graph.getIncoming(el.id, 'calls');
      if (incoming.length === 0) out.push(el);
    }
  }
  return out;
}

/**
 * Retorna todos os throw_sites alcançáveis (BFS via `contains`+`calls`)
 * a partir de um id. Útil para mapear quais erros podem subir até um
 * endpoint.
 */
export function throwSitesReachableFrom(graph: ElementGraph, entryId: string): Element[] {
  const result: Element[] = [];
  const seen = new Set<string>([entryId]);
  const queue: string[] = [entryId];

  while (queue.length) {
    const id = queue.shift()!;
    const el = graph.getElement(id);
    if (!el) continue;
    if (el.kind === 'throw_site') result.push(el);

    for (const child of graph.getChildren(id)) {
      if (!seen.has(child.id)) {
        seen.add(child.id);
        queue.push(child.id);
      }
    }
    for (const e of graph.getOutgoing(id, 'calls')) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return result;
}

/**
 * Retorna a profundidade mínima (em hops via `calls` ou `contains`) entre
 * `entryId` e `targetId`. -1 se inalcançável.
 */
export function depthFromEntry(graph: ElementGraph, entryId: string, targetId: string): number {
  if (entryId === targetId) return 0;
  const seen = new Set<string>([entryId]);
  let depth = 0;
  let frontier: string[] = [entryId];
  while (frontier.length) {
    depth++;
    const next: string[] = [];
    for (const id of frontier) {
      const neighbors = [
        ...graph.getChildren(id).map(c => c.id),
        ...graph.getOutgoing(id, 'calls').map(e => e.to),
      ];
      for (const n of neighbors) {
        if (n === targetId) return depth;
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return -1;
}

/**
 * Wrapper conveniente sobre `detectCycles` no domínio de chamadas.
 */
export function cycles(graph: ElementGraph): string[][] {
  return detectCycles(graph, { followEdges: ['calls'] });
}

/**
 * Lista call_sites ainda não-resolvidos (`isExternal`). Útil para diagnóstico.
 */
export function unresolvedCalls(graph: ElementGraph): Element[] {
  const out: Element[] = [];
  for (const c of graph.getElementsByKind('call_site')) {
    const m = c.meta as CallSiteMeta;
    if (m.isExternal === true || !m.resolvedElementId) out.push(c);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

const FUNCTION_KINDS: ReadonlySet<ElementKind> = new Set([
  'method',
  'function',
  'constructor',
  'getter',
  'setter',
  'arrow_function',
]);

function findEnclosingFunction(graph: ElementGraph, el: Element): Element | null {
  let cur: Element | undefined = graph.getParent(el.id);
  while (cur) {
    if (FUNCTION_KINDS.has(cur.kind)) return cur;
    cur = graph.getParent(cur.id);
  }
  return null;
}
