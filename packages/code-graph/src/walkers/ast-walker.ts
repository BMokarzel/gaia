/**
 * ASTWalker — interface comum a todos os walkers de linguagem.
 *
 * O walker recebe um arquivo + root AST node e emite um lote de Elements
 * + Edge(contains). Não resolve referências (calls, imports, types) —
 * isso é responsabilidade dos resolvers.
 */

import type { Element } from '../element';
import type { Edge } from '../edge';
import type { SourceFile } from './source-file';

export interface ElementBatch {
  elements: Element[];
  edges: Edge[];
}

export interface ASTWalker {
  /** Extensões de arquivo suportadas pelo walker (com ponto). */
  readonly supportedExtensions: ReadonlyArray<string>;

  /**
   * Faz o parse do arquivo (lazy, internamente) e retorna o batch.
   * Retorna `null` se o walker não tem grammar disponível ou não
   * conseguiu fazer o parse.
   */
  walk(file: SourceFile): ElementBatch | null;
}

export function emptyBatch(): ElementBatch {
  return { elements: [], edges: [] };
}

export function mergeBatches(...batches: ElementBatch[]): ElementBatch {
  return {
    elements: batches.flatMap(b => b.elements),
    edges: batches.flatMap(b => b.edges),
  };
}
