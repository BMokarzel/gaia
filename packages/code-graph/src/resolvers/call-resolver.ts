/**
 * CallResolver (§5.3)
 *
 * Resolve cada `call_site` em uma de três categorias:
 *   1. `this.<receiver>.<method>(...)` — usa injectionMap para achar a
 *      classe injetada no field `receiver`, depois acha o método.
 *   2. método/função local (sem `this.`) — busca função/método com mesmo
 *      nome no mesmo módulo.
 *   3. import direto — `import_binding.localName === calleeText` e o
 *      binding já tem `resolvedElementId`.
 *
 * Quando resolve, preenche `meta.resolvedElementId` + `resolvedClassName`
 * e adiciona edge `calls`. Quando não resolve, marca `meta.isExternal=true`.
 */

import type { ElementGraph } from '../graph';
import type { Element, CallSiteMeta, ImportBindingMeta } from '../element';
import { makeEdgeId } from '../ids';
import type { ResolverContext } from './resolver-context';

export function runCallResolver(graph: ElementGraph, ctx: ResolverContext): void {
  for (const call of graph.getElementsByKind('call_site')) {
    const meta = call.meta as CallSiteMeta;
    const callee = meta.calleeText;
    if (!callee) continue;

    const enclosingClass = findEnclosingClass(graph, call);
    const enclosingModule = findEnclosingModule(graph, call);

    let resolved: Element | null = null;

    // CASO 1 — this.<receiver>.<method>
    if (callee.startsWith('this.') && enclosingClass) {
      const parts = callee.split('.');
      // this . receiver . method [. ...]
      if (parts.length >= 3) {
        const receiver = parts[1];
        const methodName = parts[2];
        const className = enclosingClass.name ?? '';
        const injectedClassId = ctx.injectionMap[className]?.[receiver];
        if (injectedClassId) {
          const injectedTarget = graph.getElement(injectedClassId);
          let method: Element | null = null;
          let resolvedTarget: Element | undefined = injectedTarget;
          // Se o tipo injetado é uma interface, prefere a implementação
          // concreta (interface signature não tem corpo, truncaria a flow tree).
          if (injectedTarget?.kind === 'interface') {
            for (const impl of graph.getIncoming(injectedClassId, 'implements')) {
              const m = findMethodInClass(graph, impl.from, methodName);
              if (m) {
                method = m;
                resolvedTarget = graph.getElement(impl.from);
                break;
              }
            }
            // Fallback para o method_signature da própria interface.
            if (!method) method = findMethodInClass(graph, injectedClassId, methodName);
          } else {
            method = findMethodInClass(graph, injectedClassId, methodName);
          }
          if (method) {
            resolved = method;
            meta.resolvedClassName = resolvedTarget?.name;
          }
        }
      } else if (parts.length === 2) {
        // this.<method>() — método da própria classe
        const methodName = parts[1];
        const method = findMethodInClass(graph, enclosingClass.id, methodName);
        if (method) {
          resolved = method;
          meta.resolvedClassName = enclosingClass.name;
        }
      }
    }

    // CASO 2 — método/função local
    if (!resolved && enclosingModule) {
      const local = findLocalFunctionOrMethod(graph, enclosingModule, callee);
      if (local) resolved = local;
    }

    // CASO 3 — import direto
    if (!resolved && enclosingModule) {
      const localName = callee.split('.')[0];
      const binding = findImportBinding(graph, enclosingModule, localName);
      if (binding?.meta) {
        const m = binding.meta as ImportBindingMeta;
        if (m.resolvedElementId) {
          const target = graph.getElement(m.resolvedElementId);
          if (target) resolved = target;
        }
      }
    }

    if (resolved) {
      meta.resolvedElementId = resolved.id;
      meta.isExternal = false;
      graph.addEdge({
        id: makeEdgeId(call.id, 'calls', resolved.id),
        from: call.id,
        to: resolved.id,
        kind: 'calls',
      });
      ctx.stats.callsResolved++;
    } else {
      meta.isExternal = true;
      ctx.stats.callsExternal++;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

function findEnclosingClass(graph: ElementGraph, el: Element): Element | null {
  let cur: Element | undefined = graph.getParent(el.id);
  while (cur) {
    if (cur.kind === 'class') return cur;
    cur = graph.getParent(cur.id);
  }
  return null;
}

function findEnclosingModule(graph: ElementGraph, el: Element): Element | null {
  let cur: Element | undefined = el;
  while (cur) {
    if (cur.kind === 'module') return cur;
    cur = graph.getParent(cur.id);
  }
  return null;
}

function findMethodInClass(graph: ElementGraph, classId: string, name: string): Element | null {
  const children = graph.getChildren(classId);
  for (const c of children) {
    if (c.name !== name) continue;
    if (c.kind === 'method' || c.kind === 'getter' || c.kind === 'setter' || c.kind === 'constructor') {
      return c;
    }
  }
  return null;
}

function findLocalFunctionOrMethod(
  graph: ElementGraph,
  module: Element,
  callee: string,
): Element | null {
  // se o callee é um identificador simples
  const simple = callee.includes('.') ? null : callee;
  if (!simple) return null;
  const inFile = graph.getElementsInFile(module.location.file);
  for (const el of inFile) {
    if (el.name !== simple) continue;
    if (el.kind === 'function' || el.kind === 'arrow_function') return el;
  }
  return null;
}

function findImportBinding(graph: ElementGraph, module: Element, localName: string): Element | null {
  const inFile = graph.getElementsInFile(module.location.file);
  for (const el of inFile) {
    if (el.kind !== 'import_binding') continue;
    if ((el.meta as ImportBindingMeta).localName === localName) return el;
  }
  return null;
}
