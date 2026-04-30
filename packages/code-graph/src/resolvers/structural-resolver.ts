/**
 * StructuralResolver (§5.5)
 *
 * Para cada `class`:
 *   - se `meta.extendsName`, resolve para outra class e adiciona edge
 *     `extends`.
 *   - para cada nome em `meta.implementsNames`, resolve para interface
 *     (ou class) e adiciona edge `implements`.
 */

import type { ElementGraph } from '../graph';
import type { Element, ClassMeta, ImportBindingMeta } from '../element';
import { makeEdgeId } from '../ids';
import type { ResolverContext } from './resolver-context';

export function runStructuralResolver(graph: ElementGraph, ctx: ResolverContext): void {
  for (const cls of graph.getElementsByKind('class')) {
    const meta = cls.meta as ClassMeta;

    if (meta.extendsName) {
      const parent = resolveSymbol(graph, cls, stripGenerics(meta.extendsName), ['class']);
      if (parent) {
        graph.addEdge({
          id: makeEdgeId(cls.id, 'extends', parent.id),
          from: cls.id,
          to: parent.id,
          kind: 'extends',
        });
        ctx.stats.extendsResolved++;
      }
    }

    for (const implName of meta.implementsNames) {
      const target = resolveSymbol(graph, cls, stripGenerics(implName), ['interface', 'class']);
      if (target) {
        graph.addEdge({
          id: makeEdgeId(cls.id, 'implements', target.id),
          from: cls.id,
          to: target.id,
          kind: 'implements',
        });
        ctx.stats.implementsResolved++;
      }
    }
  }
}

function stripGenerics(t: string): string {
  const i = t.indexOf('<');
  return i >= 0 ? t.slice(0, i).trim() : t.trim();
}

function resolveSymbol(
  graph: ElementGraph,
  from: Element,
  name: string,
  preferredKinds: ReadonlyArray<string>,
): Element | null {
  if (!name) return null;
  const inFile = graph.getElementsInFile(from.location.file);

  // local
  for (const el of inFile) {
    if (el.name === name && preferredKinds.includes(el.kind)) return el;
  }
  // import_binding
  for (const el of inFile) {
    if (el.kind !== 'import_binding') continue;
    const m = el.meta as ImportBindingMeta;
    if (m.localName !== name) continue;
    if (m.resolvedElementId) {
      const t = graph.getElement(m.resolvedElementId);
      if (t) return t;
    }
  }
  // fallback global
  for (const kind of preferredKinds) {
    const found = graph.getElementsByKind(kind as never).find(e => e.name === name);
    if (found) return found;
  }
  return null;
}
