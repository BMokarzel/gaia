/**
 * Serializer — ElementGraph ↔ JSON estável e versionado.
 *
 * Formato de saída é um objeto plano (não Map) para JSON nativo. A versão
 * `graphSchemaVersion` permite evolução semver futura.
 */

import type { Element } from './element';
import type { Edge } from './edge';
import { ElementGraph } from './graph';

export const GRAPH_SCHEMA_VERSION = '1.0.0';

export interface SerializedGraph {
  graphSchemaVersion: string;
  elements: Element[];
  edges: Edge[];
  /** Estatísticas opcionais; consumidores podem ignorar. */
  stats?: {
    elementsByKind: Record<string, number>;
    edgesByKind: Record<string, number>;
  };
}

export function serializeGraph(graph: ElementGraph, options: { includeStats?: boolean } = {}): SerializedGraph {
  const out: SerializedGraph = {
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    elements: Array.from(graph.elements.values()),
    edges: Array.from(graph.edges.values()),
  };
  if (options.includeStats) {
    out.stats = {
      elementsByKind: graph.countByKind(),
      edgesByKind: graph.countByEdgeKind(),
    };
  }
  return out;
}

export function deserializeGraph(data: SerializedGraph): ElementGraph {
  if (!data || typeof data !== 'object') {
    throw new Error('SerializedGraph: payload inválido');
  }
  if (data.graphSchemaVersion !== GRAPH_SCHEMA_VERSION) {
    // Por enquanto, schema major único. Mudanças minor devem ser aceitas.
    const [major] = data.graphSchemaVersion.split('.');
    const [expectedMajor] = GRAPH_SCHEMA_VERSION.split('.');
    if (major !== expectedMajor) {
      throw new Error(
        `graphSchemaVersion incompatível: recebido ${data.graphSchemaVersion}, esperado ${GRAPH_SCHEMA_VERSION}`,
      );
    }
  }

  const graph = new ElementGraph();
  for (const el of data.elements ?? []) graph.addElement(el);
  for (const edge of data.edges ?? []) graph.addEdge(edge);
  return graph;
}

export function serializeGraphToString(graph: ElementGraph, pretty = true): string {
  return JSON.stringify(serializeGraph(graph), null, pretty ? 2 : 0);
}

export function deserializeGraphFromString(json: string): ElementGraph {
  return deserializeGraph(JSON.parse(json) as SerializedGraph);
}
