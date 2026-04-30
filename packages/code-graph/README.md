# @topology/code-graph

Pacote autônomo: AST → `ElementGraph` (nós + arestas) → `FlowTree`.

## Princípio

Este pacote **não conhece** `@topology/core`, `SystemTopology`, `CodeNode`,
`apps/cli` ou `apps/web`. Ele é o produto primário do qual outros consumidores
(topologia, Gaia, queries de CI) extraem projeções.

## Uso programático

```typescript
import { buildGraph, buildFlowTree, queries } from '@topology/code-graph';

const graph = buildGraph(files);
const tree  = buildFlowTree(endpointId, graph);
const dead  = queries.deadCode(graph);
```

## CLI

```bash
code-graph extract  <repo>           [--out graph.json]
code-graph query    <graph.json> <query> [args]
code-graph validate <graph.json>
```

## Schema externo

`schema/element-graph.schema.json` é o contrato versionado — consumidores
não-TS validam o `graph.json` contra ele sem importar este pacote.
