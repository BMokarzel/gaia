/**
 * ImportResolver (§5.1)
 *
 * Para cada `import_binding`:
 *   1. resolve `meta.sourceModule` para um module element existente no grafo
 *   2. cria edge `imports` entre módulos (idempotente)
 *   3. localiza o element exportado com `originalName` e preenche
 *      `meta.resolvedElementId` + cria edge `imports` (binding → element)
 *
 * Resolução de path: tenta extensions e index files. Não tenta resolver
 * para fora do conjunto de módulos presentes no grafo (qualquer coisa que
 * não bata é tratada como external).
 */

import path from 'node:path';

import type { ElementGraph } from '../graph';
import type { Element, ImportBindingMeta } from '../element';
import { makeEdgeId } from '../ids';
import type { ResolverContext } from './resolver-context';

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.cts', '.mts'];
const INDEX_NAMES = EXTENSIONS.map(e => 'index' + e);

export function runImportResolver(graph: ElementGraph, ctx: ResolverContext): void {
  // Indexa módulos por path normalizado (sem extensão também).
  const moduleByPath = new Map<string, Element>();
  for (const mod of graph.getElementsByKind('module')) {
    const p = normalize(mod.location.file);
    moduleByPath.set(p, mod);
    moduleByPath.set(stripExt(p), mod);
  }

  for (const binding of graph.getElementsByKind('import_binding')) {
    const meta = binding.meta as ImportBindingMeta;
    const importerModule = findModuleOf(graph, binding);
    if (!importerModule) continue;

    const targetModule = resolveModule(meta.sourceModule, importerModule.location.file, moduleByPath);
    if (!targetModule) {
      ctx.stats.importsExternal++;
      continue;
    }

    meta.resolvedModuleId = targetModule.id;
    addImportEdge(graph, importerModule.id, targetModule.id);
    ctx.stats.importsResolved++;

    const exportedEl = findExportedElement(graph, targetModule, meta.originalName);
    if (exportedEl) {
      meta.resolvedElementId = exportedEl.id;
      addImportEdge(graph, binding.id, exportedEl.id);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

function addImportEdge(graph: ElementGraph, fromId: string, toId: string): void {
  if (fromId === toId) return;
  graph.addEdge({
    id: makeEdgeId(fromId, 'imports', toId),
    from: fromId,
    to: toId,
    kind: 'imports',
  });
}

function findModuleOf(graph: ElementGraph, el: Element): Element | null {
  // O módulo é o ancestral kind=module via cadeia 'contains'.
  let cur: Element | undefined = el;
  while (cur) {
    if (cur.kind === 'module') return cur;
    cur = graph.getParent(cur.id);
  }
  return null;
}

function findExportedElement(
  graph: ElementGraph,
  module: Element,
  originalName: string,
): Element | null {
  if (originalName === 'default' || originalName === '*') {
    // resolução de default/namespace fica como melhor-esforço — tenta achar
    // o primeiro símbolo exportado de mesmo nome do arquivo.
    return null;
  }
  // Procura entre todos os elements no mesmo arquivo do módulo.
  const inFile = graph.getElementsInFile(module.location.file);
  for (const el of inFile) {
    if (el.name !== originalName) continue;
    if (el.kind === 'class' || el.kind === 'interface' || el.kind === 'function' ||
        el.kind === 'enum' || el.kind === 'type_alias' || el.kind === 'arrow_function') {
      return el;
    }
  }
  return null;
}

function resolveModule(
  sourceModule: string,
  importerFile: string,
  moduleByPath: Map<string, Element>,
): Element | null {
  if (!sourceModule) return null;
  const isRelative = sourceModule.startsWith('.') || sourceModule.startsWith('/');
  if (!isRelative) return null;

  const importerDir = path.posix.dirname(normalize(importerFile));
  const base = normalize(path.posix.join(importerDir, sourceModule));

  // tentativas: exato, com extensões, /index.*
  const candidates: string[] = [base, ...EXTENSIONS.map(e => base + e), ...INDEX_NAMES.map(i => `${base}/${i}`)];

  for (const cand of candidates) {
    const mod = moduleByPath.get(cand) ?? moduleByPath.get(stripExt(cand));
    if (mod) return mod;
  }
  return null;
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

function stripExt(p: string): string {
  const i = p.lastIndexOf('.');
  if (i < 0) return p;
  const ext = p.slice(i);
  if (EXTENSIONS.includes(ext)) return p.slice(0, i);
  return p;
}
