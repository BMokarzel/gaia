/**
 * TypeResolver (§5.4)
 *
 * Para cada `type_ref`:
 *   - resolve `meta.typeName` para class/interface/type_alias/enum no
 *     mesmo módulo OU via import_binding.
 *   - preenche `meta.resolvedElementId`.
 *   - adiciona edge `typed_as` do PAI do type_ref para o element resolvido
 *     (o pai costuma ser parameter / field / method).
 *
 * Para `method`/`function`/`arrow_function` que têm `returnTypeName`:
 *   - tenta resolver e adiciona edge `returns_type`.
 *
 * Para `throw_site` com `exceptionClassName`:
 *   - resolve e adiciona edge `throws_type`.
 */

import type { ElementGraph } from '../graph';
import type {
  Element,
  TypeRefMeta,
  BehavioralMeta,
  ThrowSiteMeta,
  ImportBindingMeta,
} from '../element';
import { makeEdgeId } from '../ids';
import type { ResolverContext } from './resolver-context';

const RESOLVABLE_KINDS = new Set(['class', 'interface', 'type_alias', 'enum']);

export function runTypeResolver(graph: ElementGraph, ctx: ResolverContext): void {
  // 1. type_refs explícitos
  for (const ref of graph.getElementsByKind('type_ref')) {
    const meta = ref.meta as TypeRefMeta;
    const target = resolveTypeName(graph, ref, meta.typeName);
    if (!target) continue;
    meta.resolvedElementId = target.id;
    const parent = graph.getParent(ref.id);
    if (parent) {
      graph.addEdge({
        id: makeEdgeId(parent.id, 'typed_as', target.id),
        from: parent.id,
        to: target.id,
        kind: 'typed_as',
      });
    }
    ctx.stats.typesResolved++;
  }

  // 2. returnTypeName em behavioral
  const behavioralKinds = ['method', 'function', 'arrow_function', 'getter', 'setter', 'constructor'] as const;
  for (const kind of behavioralKinds) {
    for (const fn of graph.getElementsByKind(kind)) {
      const m = fn.meta as BehavioralMeta;
      const ret = stripGenerics(m.returnTypeName ?? '').trim();
      if (!ret) continue;
      const target = resolveTypeName(graph, fn, ret);
      if (!target) continue;
      graph.addEdge({
        id: makeEdgeId(fn.id, 'returns_type', target.id),
        from: fn.id,
        to: target.id,
        kind: 'returns_type',
      });
      ctx.stats.typesResolved++;
    }
  }

  // 3. throw_sites com exceptionClassName
  for (const t of graph.getElementsByKind('throw_site')) {
    const m = t.meta as ThrowSiteMeta;
    if (!m.exceptionClassName) continue;
    const target = resolveTypeName(graph, t, m.exceptionClassName);
    if (!target) continue;
    graph.addEdge({
      id: makeEdgeId(t.id, 'throws_type', target.id),
      from: t.id,
      to: target.id,
      kind: 'throws_type',
    });
    ctx.stats.typesResolved++;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

function stripGenerics(t: string): string {
  // Para `Promise<User>` → `Promise`. Resolução de generics fica fora do MVP.
  const i = t.indexOf('<');
  return i >= 0 ? t.slice(0, i) : t;
}

function resolveTypeName(graph: ElementGraph, from: Element, typeName: string): Element | null {
  const name = stripGenerics(typeName).trim();
  if (!name) return null;

  const file = from.location.file;
  const inFile = graph.getElementsInFile(file);

  for (const el of inFile) {
    if (el.name === name && RESOLVABLE_KINDS.has(el.kind)) return el;
  }

  // via import_binding
  for (const el of inFile) {
    if (el.kind !== 'import_binding') continue;
    const m = el.meta as ImportBindingMeta;
    if (m.localName !== name) continue;
    if (m.resolvedElementId) {
      const t = graph.getElement(m.resolvedElementId);
      if (t) return t;
    }
  }

  return null;
}
