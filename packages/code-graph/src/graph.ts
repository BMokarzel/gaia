/**
 * ElementGraph — coleção indexada de Elements + Edges.
 *
 * Os índices são mantidos invariantes a cada add/remove: byKind, byFile,
 * childrenOf/parentOf (derivados das edges 'contains'), e
 * outgoing/incoming (derivados de todas as edges).
 *
 * Referência: AST_FLOW_EXTRACTION_PLAN.md §2.5
 */

import type { Element, ElementKind } from './element';
import type { Edge, EdgeKind } from './edge';

export class ElementGraph {
  readonly elements = new Map<string, Element>();
  readonly edges = new Map<string, Edge>();

  // Índices
  readonly byKind = new Map<ElementKind, Set<string>>();
  readonly byFile = new Map<string, Set<string>>();
  readonly childrenOf = new Map<string, string[]>();
  readonly parentOf = new Map<string, string>();
  readonly outgoing = new Map<string, Edge[]>();
  readonly incoming = new Map<string, Edge[]>();

  // ─── Mutadores ─────────────────────────────────────────────────────────

  addElement(el: Element): void {
    if (this.elements.has(el.id)) {
      // Idempotente — re-adicionar o mesmo Element é no-op.
      return;
    }
    this.elements.set(el.id, el);

    let kindSet = this.byKind.get(el.kind);
    if (!kindSet) {
      kindSet = new Set();
      this.byKind.set(el.kind, kindSet);
    }
    kindSet.add(el.id);

    let fileSet = this.byFile.get(el.location.file);
    if (!fileSet) {
      fileSet = new Set();
      this.byFile.set(el.location.file, fileSet);
    }
    fileSet.add(el.id);
  }

  addEdge(edge: Edge): void {
    if (this.edges.has(edge.id)) return;
    if (!this.elements.has(edge.from) || !this.elements.has(edge.to)) {
      throw new Error(
        `Edge ${edge.id} (${edge.kind}) refere-se a element inexistente: ${edge.from} → ${edge.to}`,
      );
    }
    this.edges.set(edge.id, edge);

    pushIntoMapList(this.outgoing, edge.from, edge);
    pushIntoMapList(this.incoming, edge.to, edge);

    if (edge.kind === 'contains') {
      pushIntoMapList(this.childrenOf, edge.from, edge.to);
      // pai único — primeiro 'contains' que chega vence; subsequente é
      // ignorado para preservar a árvore.
      if (!this.parentOf.has(edge.to)) {
        this.parentOf.set(edge.to, edge.from);
      }
    }
  }

  // ─── Acessores ─────────────────────────────────────────────────────────

  getElement(id: string): Element | undefined {
    return this.elements.get(id);
  }

  getEdge(id: string): Edge | undefined {
    return this.edges.get(id);
  }

  getChildren(id: string): Element[] {
    const childIds = this.childrenOf.get(id) ?? [];
    return childIds
      .map(cid => this.elements.get(cid))
      .filter((e): e is Element => e !== undefined);
  }

  getParent(id: string): Element | undefined {
    const pid = this.parentOf.get(id);
    return pid ? this.elements.get(pid) : undefined;
  }

  getElementsByKind(kind: ElementKind): Element[] {
    const ids = this.byKind.get(kind);
    if (!ids) return [];
    return Array.from(ids, id => this.elements.get(id)!).filter(Boolean);
  }

  getElementsInFile(file: string): Element[] {
    const ids = this.byFile.get(file);
    if (!ids) return [];
    return Array.from(ids, id => this.elements.get(id)!).filter(Boolean);
  }

  getOutgoing(id: string, kind?: EdgeKind): Edge[] {
    const all = this.outgoing.get(id) ?? [];
    return kind ? all.filter(e => e.kind === kind) : all;
  }

  getIncoming(id: string, kind?: EdgeKind): Edge[] {
    const all = this.incoming.get(id) ?? [];
    return kind ? all.filter(e => e.kind === kind) : all;
  }

  // ─── Estatísticas básicas ──────────────────────────────────────────────

  get size(): { elements: number; edges: number } {
    return { elements: this.elements.size, edges: this.edges.size };
  }

  countByKind(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [kind, ids] of this.byKind) out[kind] = ids.size;
    return out;
  }

  countByEdgeKind(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const edge of this.edges.values()) {
      out[edge.kind] = (out[edge.kind] ?? 0) + 1;
    }
    return out;
  }
}

function pushIntoMapList<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}
