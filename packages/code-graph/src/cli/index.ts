#!/usr/bin/env node
/**
 * code-graph — CLI standalone do pacote @topology/code-graph.
 *
 * Subcomandos:
 *   extract <repoDir> [--out file] [--pretty] [--quiet]
 *   query <graph.json> <subquery> [args...] [--out file] [--max-depth N]
 *   validate <graph.json>
 *
 * Não usa nenhuma dependência externa de CLI — parser próprio mínimo.
 */

import { runExtract } from './extract';
import { runQuery } from './query';
import { runValidate } from './validate';

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? '';
  const rest = argv.slice(1);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const eqIdx = key.indexOf('=');
      if (eqIdx >= 0) {
        flags[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
      } else {
        const next = rest[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (a === '-o' && rest[i + 1]) {
      flags.out = rest[i + 1];
      i++;
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags };
}

function printUsage(): void {
  process.stderr.write(
    [
      'Usage: code-graph <command> [options]',
      '',
      'Commands:',
      '  extract <repoDir> [--out file] [--pretty] [--quiet]',
      '      Walks <repoDir>, builds graph, serializes to JSON.',
      '',
      '  query <graph.json> <subquery> [args] [--out file]',
      '    Subqueries:',
      '      callers <id>',
      '      callees <id>',
      '      dead-code',
      '      cycles',
      '      depth <fromId> <toId>',
      '      throws-from <id>',
      '      flow-tree <id> [--max-depth N]',
      '      find <name>',
      '      unresolved-calls',
      '      stats',
      '',
      '  validate <graph.json>',
      '      Structural validation against the schema.',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (!parsed.command || parsed.command === '-h' || parsed.command === '--help') {
    printUsage();
    process.exit(parsed.command ? 0 : 1);
  }

  switch (parsed.command) {
    case 'extract': {
      const repoDir = parsed.positional[0];
      if (!repoDir) {
        process.stderr.write('extract: missing <repoDir>\n');
        process.exit(2);
      }
      await runExtract({
        repoDir,
        out: typeof parsed.flags.out === 'string' ? parsed.flags.out : undefined,
        pretty: parsed.flags.pretty === true,
        quiet: parsed.flags.quiet === true,
      });
      return;
    }
    case 'query': {
      const graphFile = parsed.positional[0];
      const sub = parsed.positional[1];
      if (!graphFile || !sub) {
        process.stderr.write('query: missing <graph.json> or <subquery>\n');
        process.exit(2);
      }
      await runQuery({
        graphFile,
        query: sub,
        positional: parsed.positional.slice(2),
        flags: parsed.flags,
        out: typeof parsed.flags.out === 'string' ? parsed.flags.out : undefined,
      });
      return;
    }
    case 'validate': {
      const graphFile = parsed.positional[0];
      if (!graphFile) {
        process.stderr.write('validate: missing <graph.json>\n');
        process.exit(2);
      }
      const r = await runValidate({ graphFile });
      process.exit(r.ok ? 0 : 1);
    }
    default:
      process.stderr.write(`Unknown command: '${parsed.command}'\n\n`);
      printUsage();
      process.exit(2);
  }
}

main().catch(err => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
