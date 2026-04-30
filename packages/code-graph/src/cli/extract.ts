/**
 * `code-graph extract <repoDir> [--out graph.json]`
 *
 * Lê todos os arquivos suportados sob repoDir, roda buildGraph, e
 * serializa o grafo em JSON (schema versionado).
 */

import { writeFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { stdout } from 'node:process';

import { buildGraph } from '../builder';
import { serializeGraph } from '../serializer';
import { collectFiles } from './fs-walk';

export interface ExtractArgs {
  repoDir: string;
  out?: string;
  pretty?: boolean;
  quiet?: boolean;
}

export async function runExtract(args: ExtractArgs): Promise<void> {
  const root = isAbsolute(args.repoDir) ? args.repoDir : resolve(process.cwd(), args.repoDir);

  if (!args.quiet) stderr(`scanning ${root}...`);
  const files = await collectFiles(root);
  if (!args.quiet) stderr(`found ${files.length} files`);

  const t0 = Date.now();
  const result = buildGraph(files, { rootDir: root, continueOnFileError: true });
  const ms = Date.now() - t0;

  if (!args.quiet) {
    stderr(
      `built graph: ${result.stats.elementCount} elements / ${result.stats.edgeCount} edges in ${ms}ms`,
    );
    stderr(
      `resolver: imports ${result.stats.resolver.importsResolved}/${result.stats.resolver.importsExternal + result.stats.resolver.importsResolved}` +
        ` | calls ${result.stats.resolver.callsResolved} resolved (${result.stats.resolver.callsExternal} external)` +
        ` | DI ${result.stats.resolver.diResolved} | types ${result.stats.resolver.typesResolved}`,
    );
    if (result.stats.errors.length) {
      stderr(`warning: ${result.stats.errors.length} files raised errors`);
    }
  }

  const json = serializeGraph(result.graph);
  const text = args.pretty ? JSON.stringify(json, null, 2) : JSON.stringify(json);

  if (args.out) {
    const outPath = isAbsolute(args.out) ? args.out : resolve(process.cwd(), args.out);
    await writeFile(outPath, text, 'utf8');
    if (!args.quiet) stderr(`wrote ${outPath}`);
  } else {
    stdout.write(text);
    stdout.write('\n');
  }
}

function stderr(s: string): void {
  process.stderr.write(s + '\n');
}
