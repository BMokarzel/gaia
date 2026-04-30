/**
 * `code-graph query <graph.json> <query> [args]`
 *
 * Subcomandos:
 *   - callers <id>
 *   - callees <id>
 *   - dead-code
 *   - cycles
 *   - depth <fromId> <toId>
 *   - throws-from <id>
 *   - flow-tree <id> [--max-depth N]
 *   - find <name>            (procura element por nome)
 *   - stats                  (counts por kind/edgeKind)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { deserializeGraph } from '../serializer';
import {
  callersOf,
  calleesOf,
  deadCode,
  throwSitesReachableFrom,
  depthFromEntry,
  cycles as findCycles,
  unresolvedCalls,
} from '../queries';
import { buildFlowTree } from '../flow/flow-tree-builder';
import type { FlowNode } from '../flow/flow-tree';
import type { ElementGraph } from '../graph';
import type { Element } from '../element';

export interface QueryArgs {
  graphFile: string;
  query: string;
  positional: string[];
  flags: Record<string, string | boolean>;
  out?: string;
}

export async function runQuery(args: QueryArgs): Promise<void> {
  const graph = await loadGraph(args.graphFile);
  const out = await dispatch(graph, args);
  await writeOutput(out, args.out);
}

async function dispatch(graph: ElementGraph, args: QueryArgs): Promise<unknown> {
  const [a, b] = args.positional;
  switch (args.query) {
    case 'callers': {
      requireArg(a, 'callers <elementId>');
      return callersOf(graph, a).map(toElementSummary);
    }
    case 'callees': {
      requireArg(a, 'callees <elementId>');
      return calleesOf(graph, a).map(toElementSummary);
    }
    case 'dead-code': {
      const items = deadCode(graph);
      return items.map(toElementSummary);
    }
    case 'cycles': {
      return findCycles(graph);
    }
    case 'depth': {
      requireArg(a, 'depth <fromId> <toId>');
      requireArg(b, 'depth <fromId> <toId>');
      return { depth: depthFromEntry(graph, a, b) };
    }
    case 'throws-from': {
      requireArg(a, 'throws-from <elementId>');
      return throwSitesReachableFrom(graph, a).map(toElementSummary);
    }
    case 'flow-tree': {
      requireArg(a, 'flow-tree <elementId>');
      const maxDepthArg = args.flags['max-depth'];
      const maxDepth = typeof maxDepthArg === 'string' ? Number(maxDepthArg) : undefined;
      const tree = buildFlowTree(a, graph, { maxDepth });
      return serializeFlowTree(tree.root, tree.stats);
    }
    case 'find': {
      requireArg(a, 'find <name>');
      const allKinds = [
        'class', 'interface', 'method', 'function', 'constructor',
        'arrow_function', 'getter', 'setter',
      ] as const;
      const matches: Element[] = [];
      for (const k of allKinds) {
        for (const el of graph.getElementsByKind(k)) {
          if (el.name === a || el.name?.includes(a)) matches.push(el);
        }
      }
      return matches.map(toElementSummary);
    }
    case 'unresolved-calls': {
      return unresolvedCalls(graph).map(toElementSummary);
    }
    case 'stats': {
      return {
        elements: graph.size.elements,
        edges: graph.size.edges,
        byKind: graph.countByKind(),
        byEdgeKind: graph.countByEdgeKind(),
      };
    }
    default:
      throw new Error(
        `query desconhecida: '${args.query}'. válidas: callers, callees, dead-code, cycles, depth, throws-from, flow-tree, find, unresolved-calls, stats`,
      );
  }
}

function toElementSummary(el: Element): Record<string, unknown> {
  return {
    id: el.id,
    kind: el.kind,
    name: el.name,
    location: `${el.location.file}:${el.location.startLine + 1}:${el.location.startCol + 1}`,
  };
}

function serializeFlowTree(node: FlowNode, stats: unknown): unknown {
  return {
    stats,
    tree: serializeFlowNode(node),
  };
}

function serializeFlowNode(node: FlowNode): unknown {
  return {
    id: node.elementId,
    kind: node.element.kind,
    label: node.label,
    edgeKind: node.edgeKind,
    edgeMeta: node.edgeMeta,
    marker: node.marker,
    children: node.children.map(serializeFlowNode),
  };
}

function requireArg(v: string | undefined, usage: string): asserts v is string {
  if (!v) throw new Error(`argumento faltando — uso: ${usage}`);
}

async function loadGraph(file: string): Promise<ElementGraph> {
  const path = isAbsolute(file) ? file : resolve(process.cwd(), file);
  const raw = await readFile(path, 'utf8');
  const json = JSON.parse(raw);
  return deserializeGraph(json);
}

async function writeOutput(out: unknown, outFile?: string): Promise<void> {
  const text = JSON.stringify(out, null, 2);
  if (outFile) {
    const path = isAbsolute(outFile) ? outFile : resolve(process.cwd(), outFile);
    await writeFile(path, text, 'utf8');
    process.stderr.write(`wrote ${path}\n`);
  } else {
    process.stdout.write(text + '\n');
  }
}
