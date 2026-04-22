# Plano de Implementação

> Gerado a partir do ALIGNMENT.md. Define ordem, dependências, riscos e tamanho de cada mudança. Nada deve ser implementado fora desta ordem sem justificativa explícita.

---

## Diagnóstico: o que o código legado já resolve

O `src/` contém ~1.500 linhas funcionais que **não devem ser reescritas**. O único problema é que importam tipos que ainda não existem em `packages/core/src/types/topology.ts`. A Fase 0 destrava tudo.

| Arquivo legado | O que resolve | Bloqueio atual |
|---|---|---|
| `src/analysis/service-merger.ts` | Merge cross-service com LLM, scoring, `runCrossServiceMerge()` | Tipos `ExternalCallNode`, `PendingMergeEntry` ausentes no core |
| `src/analysis/llm-enrichment.ts` | Enriquecimento bottom-up, `computeResolvedDependencies()` | Tipos `ColumnNode`, `LLMEnrichment`, `GraphValidationResult` ausentes no core |
| `src/extractors/ts/http-client.extractor.ts` | Extração de HTTP clients externos, `normalizeHttpPath()` | Ausente de `packages/core/src/extractors/ts/` |
| `src/utils/prompt-sanitizer.ts` | Sanitização de inputs para prompts LLM | Ausente de `packages/core/src/utils/` |

---

## DAG de Dependências

```
Fase 0: topology.ts (tipos centrais)
    ↓
Fase 1: Integração src/ → packages/core
    ↓
Fase 2: API — novos serviços e endpoints
    ↓
Fase 3a: Web — store + API client
    ↓
Fase 3b: Web — views
```

Fase 3a depende dos contratos de resposta da Fase 2. Fase 3b pode usar mocks enquanto a API não está pronta, mas deve ser feita após 3a.

---

## FASE 0 — Tipos centrais `topology.ts`

**Arquivo**: `packages/core/src/types/topology.ts`
**Tamanho**: Pequeno
**Risco**: ALTO — tudo depende deste arquivo. Apenas adições, zero remoções.

### 0.1 — Adicionar `ExternalCallNode`

Campos obrigatórios (derivados do uso real no legado):

```typescript
export interface ExternalCallNode extends BaseCodeNode {
  type: 'externalCall';
  metadata: {
    method: string;
    path: string;
    pathNormalized: string;
    baseUrl?: string;
    httpClient: string;
    bodyFields?: string[];
    mergeStatus: 'provisional' | 'resolved' | 'pending_review' | 'unresolvable';
    resolvedEndpointId?: string;
    mergeConfidence?: number;
    mergeReason?: string;
    provisionalEntryId?: string;
  };
}
```

### 0.2 — Expandir `CodeNodeType` e `CodeNode`

Adicionar `'externalCall'` ao union `CodeNodeType` e `ExternalCallNode` ao union `CodeNode`.

**Impacto no frontend**: `EndpointView.tsx` tem `switch (node.type)` com `default` — não quebra em runtime, mas TypeScript pode emitir aviso de switch não-exaustivo. O default já está presente.

### 0.3 — Adicionar `externalDependencies` e `resolvedDependencies` em `ServiceNode`

```typescript
// Em ServiceNode, adicionar campos opcionais:
externalDependencies?: ExternalDependency[];
resolvedDependencies?: ResolvedDependencies;

// Novos tipos:
export interface ExternalDependency {
  externalCallNodeId: string;
  method: string;
  path: string;
  mergeStatus: 'resolved' | 'pending_review' | 'unresolvable';
  resolvedEndpointId?: string;
  provisionalEntryId?: string;
}

export interface ResolvedDependencies {
  services: ResolvedServiceDep[];
  databases: ResolvedDatabaseDep[];
  brokers: never[];
}

export interface ResolvedServiceDep {
  serviceId: string;
  serviceName: string;
  via: string[];
  callCount: number;
}

export interface ResolvedDatabaseDep {
  databaseId: string;
  databaseName: string;
  operations: ('read' | 'write' | 'delete')[];
  tablesAccessed: string[];
}
```

### 0.4 — Adicionar tipos de merge

```typescript
export interface PendingMergeCandidate {
  endpointId: string;
  serviceId: string;
  serviceName: string;
  method: string;
  path: string;
  confidence: number;
}

export interface PendingMergeEntry {
  externalCallId: string;
  context: {
    callerServiceId: string;
    callerServiceName: string;
    method: string;
    path: string;
    bodyFields?: string[];
  };
  candidates: PendingMergeCandidate[];
  llmReason: string;
  decision: string | 'unresolvable' | null;
}

export interface PendingMergesFile {
  generatedAt: string;
  topologyPath: string;
  pendingMerges: PendingMergeEntry[];
}
```

### 0.5 — Adicionar tipos de enriquecimento LLM

Necessários para mover `llm-enrichment.ts`:

```typescript
export interface LLMEnrichment {
  humanName?: string;
  description?: string;
  tags?: string[];
  enrichedAt: string;
  enrichedBy: string;
}

export interface GraphValidationIssue {
  severity: 'error' | 'warning' | 'info';
  nodeId?: string;
  description: string;
  suggestion?: string;
}

export interface GraphValidationResult {
  serviceId: string;
  issues: GraphValidationIssue[];
  coherenceScore: number;
  validatedAt: string;
}
```

Adicionar campo `llm?: LLMEnrichment` em: `EndpointNode.metadata`, `FunctionNode.metadata`, `ServiceNode.metadata`, `ColumnDef`.

### 0.6 — Expandir `EdgeKind`

Adicionar `'resolves_to'` e `'depends_on'` ao union existente.

**Impacto no frontend**: nenhum switch exaustivo sobre `EdgeKind` foi encontrado nas views. Safe.

### 0.7 — Atualizar `packages/core/src/index.ts`

Exportar todos os novos tipos adicionados nas etapas anteriores.

---

## FASE 1 — Integrar `src/` ao monorepo

**Pré-condição**: Fase 0 completa e compilando sem erros.
**Tamanho**: Médio
**Risco**: Médio

### 1.1 — Mover `src/utils/prompt-sanitizer.ts`

Destino: `packages/core/src/utils/prompt-sanitizer.ts`

Sem dependências externas. Mover e exportar em `index.ts`.

### 1.2 — Mover `src/extractors/ts/http-client.extractor.ts`

Destino: `packages/core/src/extractors/ts/http-client.extractor.ts`

Ajustar imports relativos (`../../utils/`, `../../types/topology`). Verificar se `ast-helpers` e `id` existem no core com o mesmo path — se não, ajustar para os equivalentes existentes.

### 1.3 — Mover `src/analysis/service-merger.ts`

Destino: `packages/core/src/analysis/service-merger.ts`

Ajustar imports:
- `@anthropic-ai/sdk` — verificar se está em `packages/core/package.json`. Se não, adicionar.
- `../utils/prompt-sanitizer` — disponível após 1.1
- `../extractors/ts/http-client.extractor` — disponível após 1.2
- `../types/topology` — disponível após Fase 0

### 1.4 — Mover `src/analysis/llm-enrichment.ts`

Destino: `packages/core/src/analysis/llm-enrichment.ts`

Ajustar imports (mesmos que 1.3). Tipos `LLMEnrichment`, `GraphValidationResult`, `GraphValidationIssue` agora existem após 0.5.

Verificar: o arquivo usa `ColumnNode` para tipar iterações sobre `table.columns`. O tipo correto no core é `ColumnDef`. Ajustar o import e os cast internos.

### 1.5 — Exportar novos módulos em `packages/core/src/index.ts`

```typescript
export { runCrossServiceMerge, applyPendingMerges, writePendingMerges } from './analysis/service-merger';
export { enrichService, computeResolvedDependencies } from './analysis/llm-enrichment';
export type { EnrichmentConfig, GraphValidationResult, GraphValidationIssue } from './analysis/llm-enrichment';
export { extractHttpClients, normalizeHttpPath } from './extractors/ts/http-client.extractor';
```

### 1.6 — Auditoria de extratores `src/extractors/` vs `packages/core/src/extractors/`

Mover apenas `ts/http-client.extractor.ts` nesta fase (coberto em 1.2). Os extratores de outras linguagens (C#, Go parcial, Java parcial, Kotlin, Python parcial, Rust) são movidos em fase separada para não bloquear o restante do plano.

---

## FASE 2 — API

**Pré-condição**: Fase 0 e 1 completas.
**Tamanho**: Grande
**Risco**: Médio-alto

### 2.1 — Criar `EcosystemService` e `ProvisionalService`

**Arquivos novos**:
- `apps/api/src/modules/ecosystem/ecosystem.service.ts`
- `apps/api/src/modules/ecosystem/provisional.service.ts`
- `apps/api/src/modules/ecosystem/ecosystem.module.ts`

Responsabilidades:
- `EcosystemService`: lê/escreve/atualiza `data/ecosystem.json` (índice global de serviços e edges)
- `ProvisionalService`: lê/escreve/atualiza `data/provisional.json` (calls externas não resolvidas)

Nenhum arquivo existente é tocado. Zero risco de quebra.

### 2.2 — `GET /ecosystem` e `GET /ecosystem/provisional`

**Arquivo novo**: `apps/api/src/modules/ecosystem/ecosystem.controller.ts`

Dois endpoints simples que retornam o conteúdo dos arquivos JSON. Registrar `EcosystemModule` em `AppModule`.

### 2.3 — Remover `GET /topologies/:id/services`

**Arquivos**: `topology.controller.ts`, `topology.service.ts`

Remover o método `getServices()` e o endpoint `@Get(':id/services')`. O frontend não chama esse endpoint (`topology.api.ts` não tem `getServices()`). Safe.

### 2.4 — Mudar ID de `StoredTopology` de nanoid para repoName

**Arquivos**: `json-file.adapter.ts`, `topology.service.ts`

**Atenção**: repoName pode conter `/` (GitHub) ou espaços (caminhos locais). O nome de arquivo deve ser sanitizado: `owner/repo` → `owner__repo.json`. O campo `id` no storage continua sendo o `repoName` original (com `/`), o nome do arquivo em disco usa a versão sanitizada.

Adicionar verificação de duplicata: se `findById(repoName)` retornar resultado, lançar `ConflictException` com mensagem clara.

**Impacto nos dados existentes**: arquivos gerados com nanoid ficam órfãos. Não são deletados automaticamente — apenas deixam de ser referenciados pelo index. Documentar no código.

### 2.5 — Fluxo de extração com merge bidirecional

**Arquivo**: `apps/api/src/modules/topology/topology.service.ts`

Este é o passo de maior complexidade. O método `analyze()` passa a:

1. Verificar duplicata (2.4)
2. Extrair topology via `ExtractionService`
3. Coletar todos `ExternalCallNode[]` da topologia (walk recursivo nos children de endpoints e funções)
4. Carregar todos os serviços existentes via `storage.findAll()`
5. **Direção 1**: `runCrossServiceMerge(existingServices, externalCalls)` → obtém `{ edges, pending }`
6. **Direção 2**: para cada `EndpointNode` do novo serviço, consultar `ProvisionalService` — se houver provisório com mesmo method/path, adicionar à lista de decisões pendentes
7. Retornar `{ topology, pendingMerges: [...pending_dir1, ...pending_dir2], sessionId }`
8. Após receber decisões do usuário via `POST /merge-decision`, aplicar e salvar

**Estratégia de sessão**: a topologia extraída é mantida em memória (Map keyed por `sessionId`) até todas as decisões serem recebidas. Timeout de 30 minutos para limpeza automática.

**Mitigação de inconsistência**: escrever em `ecosystem.json` e `provisional.json` apenas após `storage.save()` ter sucesso.

### 2.6 — `POST /topologies/analyze/merge-decision`

**Arquivo**: `topology.controller.ts`

Recebe `{ sessionId, decisions: [{ externalCallId, decision }] }`. Aplica as decisões à topologia em memória, persiste, atualiza `ecosystem.json` e `provisional.json`, retorna summary.

---

## FASE 3a — Web: Store e API Client

**Pré-condição**: Fase 2 completa (ou mocks dos contratos).
**Tamanho**: Médio
**Risco**: Médio

### 3a.1 — Unificar navegação no store

**Arquivo**: `apps/web/src/store/topologyStore.ts`

Substituir `appScreen` + `viewLevel` por `navigation.screen: 'home' | 'ecosystem' | 'service' | 'endpoint'`.

**Commit atômico**: esta mudança afeta `App.tsx`, `LeftRail.tsx`, `TopBar.tsx`, `EcosystemView.tsx`, `ServiceView.tsx`, `EndpointView.tsx` simultaneamente. Todos devem ser atualizados no mesmo commit para não deixar o projeto em estado não-compilável.

### 3a.2 — Adicionar estado do ecossistema ao store

```typescript
ecosystem: EcosystemIndex | null;
ecosystemStatus: 'idle' | 'loading' | 'error';
loadEcosystem: () => Promise<void>;
externalTopologies: Map<string, SystemTopology>;
expandedExternalEndpointIds: Set<string>;
toggleExpandedExternalEndpoint: (id: string) => void;
```

### 3a.3 — Atualizar API client e tipos

Adicionar `getEcosystem()`, `getProvisional()`, `submitMergeDecisions()` em `topology.api.ts`.
Adicionar `EcosystemIndex`, `EcosystemServiceEntry`, `EcosystemDatabaseEntry`, `EcosystemEdge`, `MergeDecisionDto` em `types.ts`.

---

## FASE 3b — Web: Views

**Pré-condição**: Fase 3a completa.
**Tamanho**: Grande
**Risco**: Alto (reescritas completas)

### 3b.1 — `EcosystemView.tsx`

Trocar fonte de dados de `topology` para `ecosystem`. Chamar `loadEcosystem()` ao montar.

Mudanças visuais:
- Todos os nós como círculos (ajustar `createServiceNode` / `createDatabaseNode` em `gaiaNodes.ts` para aceitar forma circular)
- Tamanho por `inDegree`: calcular antes de criar nós D3 com `edges.filter(e => e.to === id).length`
- Nós `status: 'provisional'` com estilo tracejado

### 3b.2 — `ServiceView.tsx`

Estender `buildServiceLayout()` para:
- Container principal com `service.endpoints` como nós círculo internos
- Para cada `ExternalCallNode` resolvido nos endpoints, criar container lateral do serviço alvo com seus endpoints
- DBs como nós externos sem container
- Edges conectando endpoints internos aos recursos externos

### 3b.3 — `EndpointView.tsx` — reescrita completa

Estrutura da view inicial (tudo já aberto):
- Container do serviço analisado
  - Container do endpoint
    - Fluxo vertical com setas
    - Funções como containers abertos com seus filhos
    - `ExternalCallNode` como nó no fluxo com aresta lateral para container externo
    - `dbProcess` com aresta para container de DB externo

Lógica de expansão de endpoint externo:
- Click no nó de endpoint externo → `toggleExpandedExternalEndpoint(endpointId)`
- Se não tiver a topologia em cache: `GET /topologies/{serviceId}` → armazenar em `externalTopologies`
- Renderizar o fluxo interno do endpoint expandido dentro do container externo

Adicionar case `'externalCall'` no switch de `buildOne()`.

### 3b.4 — `Breadcrumb.tsx`

Novo componente. Lê `navigation` do store e renderiza:
```
Ecossistema  >  {serviceId}  >  {method} {path}
```
Cada segmento clicável. Integrar no `TopBar.tsx`.

### 3b.5 — ExtractModal — etapas de progresso e merge UI

Adicionar etapas ao modal:
1. Formulário (existente)
2. Barra de progresso com etapas de extração (SSE ou polling de status)
3. Para cada `PendingMergeEntry`: painel com candidatos e sugestão LLM
4. Resumo final com atalhos para ecossistema e serviço extraído

---

## O que é seguro fazer primeiro (zero risco de quebra)

| Ordem | O que fazer | Por quê é seguro |
|---|---|---|
| 1 | Fase 0 completa (topology.ts) | Apenas adições, zero remoções |
| 2 | 1.1 prompt-sanitizer | Arquivo sem dependências |
| 3 | 1.2 http-client extractor | Apenas adiciona ao core, não conecta ainda |
| 4 | 2.1 EcosystemService + ProvisionalService | Arquivos novos, nada existente tocado |
| 5 | 2.2 GET /ecosystem endpoints | Novos endpoints, nada removido |
| 6 | 3a.2 ecosystem no store | Adição ao Zustand state |
| 7 | 3a.3 API client additions | Adição pura |
| 8 | 3b.4 Breadcrumb | Componente novo |

---

## Cirurgias de alto risco (requerem cuidado especial)

### Cirurgia A: Fase 0 completa (topology.ts)
Todo o resto depende deste arquivo. Erros de tipo aqui se propagam para core, api e web. Testar com `pnpm --filter @topology/core build` após cada sub-etapa.

### Cirurgia B: ID de StoredTopology (2.4)
Invalida dados existentes no storage. Fazer em commit isolado. Documentar no código que arquivos com nanoid como nome são legado e podem ser removidos manualmente.

### Cirurgia C: Navegação unificada (3a.1)
Afeta 6+ arquivos simultaneamente. Fazer em commit único e atômico. Nunca fazer em etapas.

### Cirurgia D: `analyze()` com merge bidirecional (2.5)
Efeitos colaterais em múltiplos arquivos JSON. Usar transação lógica: só escrever arquivos derivados após sucesso do save principal.

---

## Ordem de implementação recomendada

```
Bloco 1 — Fundação (sem risco de quebra)
  0.1 → 0.2 → 0.3 → 0.4 → 0.5 → 0.6 → 0.7   topology.ts + index.ts
  1.1                                            prompt-sanitizer
  1.2                                            http-client extractor
  build: pnpm --filter @topology/core build ✓

Bloco 2 — Analysis (core legado integrado)
  1.3                                            service-merger
  1.4                                            llm-enrichment
  1.5                                            exports index.ts
  build: pnpm --filter @topology/core build ✓

Bloco 3 — API novos serviços (sem tocar existentes)
  2.1                                            EcosystemService + ProvisionalService + Module
  2.2                                            GET /ecosystem + GET /ecosystem/provisional
  2.3                                            Remover GET /topologies/:id/services
  build: pnpm --filter @topology/api build ✓

Bloco 4 — API cirurgias
  2.4                                            ID repoName (commit isolado)
  2.5 + 2.6                                      Fluxo merge bidirecional + merge-decision endpoint
  test: POST /topologies/analyze end-to-end ✓

Bloco 5 — Web fundação
  3a.1                                           Navegação unificada (commit atômico)
  3a.2 → 3a.3                                    Ecosystem no store + API client
  build: pnpm --filter @topology/web build ✓

Bloco 6 — Web views
  3b.4                                           Breadcrumb
  3b.1                                           EcosystemView
  3b.2                                           ServiceView
  3b.3                                           EndpointView (maior escopo)
  3b.5                                           ExtractModal etapas
```
