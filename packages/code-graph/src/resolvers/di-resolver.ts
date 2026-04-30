/**
 * DIResolver (§5.2)
 *
 * Para cada constructor:
 *   - para cada parameter filho com `meta.typeName`:
 *       * resolve o nome via:
 *           a) class no mesmo módulo
 *           b) interface no mesmo módulo
 *           c) import_binding (se importado de outro módulo já resolvido)
 *       * preenche `meta.injectedClassId`
 *       * adiciona edge `injects` (parameter → class/interface)
 *   - constrói `injectionMap[className][fieldName] = resolvedClassId`
 *
 * O `fieldName` é o `parameter.name` (em TS, em construtores parameter
 * properties como `private readonly usersService: UsersService` o nome
 * do parâmetro vira o nome do field).
 */

import type { ElementGraph } from '../graph';
import type { Element, ParameterMeta, ImportBindingMeta } from '../element';
import { makeEdgeId } from '../ids';
import type { ResolverContext } from './resolver-context';

export function runDIResolver(graph: ElementGraph, ctx: ResolverContext): void {
  for (const ctor of graph.getElementsByKind('constructor')) {
    const parentClass = graph.getParent(ctor.id);
    if (!parentClass || parentClass.kind !== 'class') continue;

    const className = parentClass.name ?? '';
    if (!className) continue;
    if (!ctx.injectionMap[className]) ctx.injectionMap[className] = {};

    const params = graph.getChildren(ctor.id).filter(c => c.kind === 'parameter');
    for (const param of params) {
      const meta = param.meta as ParameterMeta;
      const typeName = stripGenerics(meta.typeName ?? '').trim();
      if (!typeName) continue;

      const resolved = resolveTypeToElement(graph, parentClass, typeName);
      if (!resolved) continue;

      meta.injectedClassId = resolved.id;
      graph.addEdge({
        id: makeEdgeId(param.id, 'injects', resolved.id),
        from: param.id,
        to: resolved.id,
        kind: 'injects',
      });

      const fieldName = param.name ?? '';
      if (fieldName) {
        ctx.injectionMap[className][fieldName] = resolved.id;
      }
      ctx.stats.diResolved++;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

function stripGenerics(t: string): string {
  const i = t.indexOf('<');
  return i >= 0 ? t.slice(0, i) : t;
}

function resolveTypeToElement(
  graph: ElementGraph,
  fromClass: Element,
  typeName: string,
): Element | null {
  const file = fromClass.location.file;

  // a) mesmo módulo: class/interface/type_alias com aquele nome
  const inFile = graph.getElementsInFile(file);
  for (const el of inFile) {
    if (el.name === typeName && (el.kind === 'class' || el.kind === 'interface')) {
      return el;
    }
  }

  // c) import binding com localName === typeName
  for (const binding of inFile) {
    if (binding.kind !== 'import_binding') continue;
    const meta = binding.meta as ImportBindingMeta;
    if (meta.localName !== typeName) continue;
    if (meta.resolvedElementId) {
      const target = graph.getElement(meta.resolvedElementId);
      if (target) return target;
    }
  }

  // fallback: qualquer class/interface com aquele nome no grafo (último recurso)
  const allClasses = [
    ...graph.getElementsByKind('class'),
    ...graph.getElementsByKind('interface'),
  ];
  const exact = allClasses.find(e => e.name === typeName);
  return exact ?? null;
}
