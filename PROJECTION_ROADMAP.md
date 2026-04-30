# Projection Roadmap

Plano de melhorias para o pipeline `code-graph → projection → core → api → web`,
após o MVP do flow profundo (2026-04-29).

Itens priorizados (ordem ≈ impacto sobre o UX "entender o fluxo só de bater o olho"):
**#4, #5, #6, #11, #14, #16**.

---

## 1. Projeção (`@topology/core` ↔ `@topology/code-graph`)

### 1. Deduplicar `call → call` espelho
Hoje `call this.ormRepo.findOne` aparece duas vezes (a chamada e seu único filho
não-resolvido com mesmo callee). Em `mapCall` / `flattenChildren`, colapsar
`call A` cuja única child é `call A` sem `resolvedTo`.

**Arquivo:** `packages/core/src/projections/topology-projection.ts`

### 2. Preservar nome da variável em `assign_site` que envolve `call`
Hoje o assign vira invisível e perdemos `const sanitized = ...`. Emitir um
`data` "fantasma" antes do call ou anexar `metadata.assignedTo` no CallNode.

### 3. Cobrir `await_site` que envolve `assign`
Padrão `const x = await svc.foo()` precisa ser validado — provavelmente cai no
branch genérico do `flattenChildren`.

### 4. ⭐ External APIs como nó próprio
Hoje `httpClient.post(...)` vira `call` genérico. Detectar callees de http-clients
(axios/fetch/got/http) e emitir `externalCall` com URL inferida — vira nó
visualmente distinto na web.

### 5. ⭐ `dbProcess` na projeção
A versão antiga emite `dbProcess` com tabela/operação. A projeção nova ainda
não — então rotas com TypeORM perdem o "este call é uma escrita no DB".
Detectar callees `.find/.save/.update/.delete` em repositórios (e equivalentes
Prisma/Sequelize/Mongoose) e emitir `dbProcess`.

### 6. ⭐ Branches dentro de `flowControl`
O `CodeNode` tem `metadata.branches[]` que o web usa pra "fan out" if/else.
A projeção atual coloca tudo em `children` — nunca preenche `branches`. Isso
significa que ifs renderizam como caixa única em vez de diamante com ramos
labeled `then`/`else`.

---

## 2. API (`@topology/api`)

### 7. Re-analyze idempotente
Hoje precisa `DELETE` antes de `POST /analyze`. Aceitar `?force=true` ou um
`PUT /topologies/:id/reanalyze`.

### 8. Endpoint pra ver só o flow projetado de um endpoint
`GET /topologies/:id/endpoints/:eid/flow` — útil pra debug e pra clientes leves.

### 9. Webhook/SSE no analyze
Pra projetos grandes, hoje o `POST /analyze` fica pendurado. Stream de progresso
via SSE.

---

## 3. Web (`apps/web`)

### 10. Layout swimlane horizontal por camada
Spec original menciona controller → service → repo → db como faixas. Hoje
sub-funções viram regiões aninhadas verticais sem separação semântica.

### 11. ⭐ Expand/collapse on click
`MAX_DEPTH=12` resolve o "tudo invisível" mas joga uma árvore enorme na tela.
Idealmente: começa colapsado em `depth=2`, e clicar num call expande mais um
nível.

**Arquivo:** `apps/web/src/views/EndpointView.tsx`

### 12. Badges de dependência herdada no ServiceView
O serviço deveria mostrar "depende de Postgres + 2 APIs externas" agregando os
endpoints. Hoje só lista endpoints.

### 13. EcosystemView com edges service↔db / service↔service derivadas
Mesma origem (agregação dos endpoints).

### 14. ⭐ Detail panel: mostrar trecho do source
Hoje mostra só metadata. Carregar `±5 linhas` do `node.location.file:line`
daria contexto enorme. Requer endpoint API pra ler arquivo do projeto analisado.

### 15. Throw labels mais ricos
Já mostramos `errorClass.slice(0,10)` — adicionar `httpStatus` no badge e a
mensagem no hover.

### 16. ⭐ Middlewares como nós antes do handler
NestJS guards/interceptors/pipes não aparecem. Em `sample-api` temos
`ParseUUIDPipe` no `@Param` — perdido. Idem express middlewares, NestJS
`@UseGuards`, etc.

---

## 4. Tooling / DX

### 17. Snapshot test da projeção
Congelar a árvore esperada pra `sample-api/POST /users`. Qualquer regressão na
projeção quebra.

### 18. CLI `topology project --endpoint <id>`
Imprime a árvore projetada — mais rápido que rodar API + Web pra debugar.

### 19. Limpar arquivos de scratch
`dump-ast.ts`, `sample-api-ast.json`, `ast-types-reference.csv`,
`AST_FLOW_EXTRACTION_PLAN.md`, `test-projection.mjs` — decidir o que vira teste,
o que vai pra `docs/`, e o que apaga.

---

## 5. Code-graph

### 20. Resolver chamadas em propriedades de objeto
O log "12/28 calls resolved" significa ~57% de calls anônimos. Casos comuns
provavelmente: chamadas em `Array.prototype` (`.map`, `.filter`), property-access
dinâmico, libs externas. Mapear quais e decidir o que vale resolver.

### 21. Anotar calls externos com nome do pacote
`crypto.randomUUID` ou `axios.get` poderiam virar metadata
`externalPackage: 'axios'` mesmo sem resolver pra um element.

---

## Estado em 2026-04-29

- ✅ Pipeline core: `analyzeRepository → buildServiceFlowGraph → projectEndpointFlow`
  está integrado (ver `service.builder.ts:applyDeepFlowProjection`).
- ✅ `flattenChildren` em `topology-projection.ts` desempacota
  `return/throw/assign/await` que envolvem call_sites.
- ✅ Web (`EndpointView.tsx`): `MAX_DEPTH=12`, `resolveHandlerFn` prefere
  `function` filho inline, `buildSeqV` e `buildOne` idem, top-level loop renderiza
  return/throw/flowControl/data direto em `endpoint.children`.
- ✅ End-to-end validado em `sample-api`: `GET /users/:id` 45 nós,
  `POST /users` 33 nós, profundidade ~9.
