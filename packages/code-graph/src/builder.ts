/**
 * buildGraph — orquestrador: lê arquivos → walker → ElementGraph → resolvers.
 *
 * É o ponto único de entrada para qualquer consumidor que queira o grafo
 * pronto. Permite registrar walkers por extensão (default: TsAstWalker
 * para .ts/.tsx/.js/.jsx).
 */

import { ElementGraph } from './graph';
import type { ASTWalker } from './walkers/ast-walker';
import { TsAstWalker } from './walkers/ts-ast-walker';
import type { SourceFile } from './walkers/source-file';
import { runResolvers, type ResolverStats } from './resolvers';

export interface BuildGraphOptions {
  /** Walkers a usar. Default: [new TsAstWalker()]. */
  walkers?: ASTWalker[];
  /** Diretório raiz para resolução de paths nos resolvers. */
  rootDir?: string;
  /** Se true, captura erros por arquivo em vez de propagar. */
  continueOnFileError?: boolean;
}

export interface BuildGraphResult {
  graph: ElementGraph;
  stats: {
    filesProcessed: number;
    filesSkipped: number;
    elementCount: number;
    edgeCount: number;
    resolver: ResolverStats;
    errors: Array<{ file: string; error: string }>;
  };
}

export function buildGraph(files: SourceFile[], options: BuildGraphOptions = {}): BuildGraphResult {
  const walkers = options.walkers ?? [new TsAstWalker()];
  const graph = new ElementGraph();
  const errors: Array<{ file: string; error: string }> = [];
  let filesProcessed = 0;
  let filesSkipped = 0;

  for (const file of files) {
    const walker = pickWalker(walkers, file.extension);
    if (!walker) {
      filesSkipped++;
      continue;
    }
    try {
      const batch = walker.walk(file);
      if (!batch) {
        filesSkipped++;
        continue;
      }
      for (const el of batch.elements) graph.addElement(el);
      for (const ed of batch.edges) graph.addEdge(ed);
      filesProcessed++;
    } catch (err) {
      errors.push({ file: file.path, error: String(err) });
      if (!options.continueOnFileError) throw err;
    }
  }

  const { stats: resolver } = runResolvers(graph, { rootDir: options.rootDir });

  return {
    graph,
    stats: {
      filesProcessed,
      filesSkipped,
      elementCount: graph.size.elements,
      edgeCount: graph.size.edges,
      resolver,
      errors,
    },
  };
}

function pickWalker(walkers: ASTWalker[], extension: string): ASTWalker | null {
  for (const w of walkers) {
    if (w.supportedExtensions.includes(extension)) return w;
  }
  return null;
}
