# Gaia — Relatório de Alinhamento

> Documento de referência para implementação. Define jornada do usuário, modelo de dados, contratos de API, estados de tela e plano de migração. Nada aqui deve ser implementado antes de aprovação deste documento.

---

## 1. Estado atual do codebase

### O que existe e funciona (integrado ao monorepo)

| Camada | Local | Estado |
|---|---|---|
| Engine de extração AST | `packages/core` | Funcional, sem ExternalCallNode |
| CLI | `apps/cli` | Funcional |
| API REST (CRUD de topologias) | `apps/api` | Funcional, sem ecossistema |
| Web (4 views) | `apps/web` | Funcional, EcosystemView renderiza 1 topologia |

### O que existe mas NÃO está integrado

| Arquivo | O que tem | Problema |
|---|---|---|
| `src/analysis/llm-enrichment.ts` | Enriquecimento LLM de nós (endpoints, funções, colunas) | Orphaned — `../types/topology` não existe nesse path |
| `src/analysis/service-merger.ts` | Merge cross-service com LLM + `PendingMergeEntry` | Orphaned — tipos `ExternalCallNode`, `PendingMerge` não existem em `packages/core/src/types/topology.ts` |
| `src/extractors/` | Extratores para C#, Go, Java, Kotlin, Python, Rust | Orphaned — duplica ou complementa `packages/core/src/extractors/` |

**Conclusão:** `src/` é código legado de pré-monorepo. A integração dessas funcionalidades ao `packages/core` é pré-requisito para o fluxo de merge.

---

## 2. Modelo de dados

### 2.1 Arquivos de persistência

```
apps/api/data/
├── ecosystem.json          ← índice global do ecossistema
├── provisional.json        ← nós externos não resolvidos
└── topologies/
    ├── {repoName}.json     ← topologia completa por repositório
    └── {repoName}.json
```

> **ID do sistema = nome do repositório.** Ex: repositório `auth-service` → arquivo `auth-service.json`. Não é possível ter dois sistemas com o mesmo nome. Tentativa de extrair um repositório já existente → erro com mensagem clara.

---

### 2.2 `ecosystem.json` — Índice global

Lido diretamente pela Web para renderizar o EcosystemView. Atualizado a cada extração concluída.

```ts
interface EcosystemIndex {
  version: string;                    // "1.0"
  updatedAt: string;                  // ISO timestamp
  services: EcosystemServiceEntry[];
  databases: EcosystemDatabaseEntry[];
  edges: EcosystemEdge[];
}

interface EcosystemServiceEntry {
  id: string;                         // = repoName (ex: "auth-service")
  name: string;                       // sigla/nome exibido no nó
  language: string;
  framework: string;
  team?: string;                      // time responsável
  repoUrl?: string;                   // link do repositório
  topologyFile: string;               // path relativo: "topologies/auth-service.json"
  endpointCount: number;              // para dimensionar nó no grafo
  status: 'active' | 'provisional';
}

interface EcosystemDatabaseEntry {
  id: string;
  name: string;
  kind: string;                       // postgres, mysql, mongodb, redis...
  topologyFile: string;               // arquivo onde está definido
  connectionCount: number;            // para dimensionar nó no grafo
  status: 'active' | 'provisional';
}

interface EcosystemEdge {
  from: string;                       // id do serviço/db de origem
  to: string;                         // id do serviço/db de destino
  // sem kind — direção é suficiente
}
```

---

### 2.3 `provisional.json` — Nós externos não resolvidos

Contém chamadas externas detectadas na extração que ainda não foram vinculadas a um endpoint/serviço real. Consultado no início de cada nova extração para tentar match com os novos dados.

```ts
interface ProvisionalFile {
  version: string;
  updatedAt: string;
  entries: ProvisionalEntry[];
}

interface ProvisionalEntry {
  id: string;                         // nanoid, estável
  status: 'pending' | 'resolved';
  resolvedTo?: string;                // id do endpoint real (quando resolvido)
  resolvedAt?: string;

  // Dados do endpoint provisório (coletados na extração, sem inferência)
  provisionalService: {
    name: string;                     // melhor guess do nome do serviço chamado
    status: 'provisional';
  };
  provisionalEndpoint: {
    method: string;                   // GET, POST, etc.
    path: string;                     // /orders/:id
    headers?: Record<string, string>;
    params?: string[];
    bodyFields?: string[];
    context?: string;                 // descrição gerada pela LLM do que aquela call faz
  };

  // Origem da call (quem fez essa chamada)
  callerServiceId: string;
  callerServiceName: string;
  callerEndpointId?: string;          // endpoint dentro do caller que faz essa call
  externalCallNodeId: string;         // id do ExternalCallNode no topology file
}
```

---

### 2.4 `topologies/{repoName}.json` — Topologia completa

O `SystemTopology` atual de `packages/core/src/types/topology.ts` é a estrutura base. As seguintes adições são necessárias:

```ts
// Adições ao ServiceNode existente:
interface ServiceNode {
  // ... campos existentes ...
  externalDependencies: ExternalDependency[];  // todas as calls externas deste serviço
}

interface ExternalDependency {
  externalCallNodeId: string;         // id do ExternalCallNode no tree AST
  method: string;
  path: string;
  mergeStatus: 'resolved' | 'pending_review' | 'unresolvable';
  resolvedEndpointId?: string;        // preenchido após merge aprovado
  provisionalEntryId?: string;        // id em provisional.json (quando pending)
}
```

```ts
// Novo tipo de nó de código — adição ao CodeNodeType e union CodeNode:
type CodeNodeType = ... | 'externalCall';

interface ExternalCallNode extends BaseCodeNode {
  type: 'externalCall';
  metadata: {
    method: string;
    path: string;
    pathNormalized: string;
    baseUrl?: string;
    headers?: Record<string, string>;
    params?: string[];
    bodyFields?: string[];
    mergeStatus: 'unresolved' | 'pending_review' | 'resolved' | 'unresolvable';
    mergeConfidence?: number;
    mergeReason?: string;
    resolvedEndpointId?: string;
    provisionalEntryId?: string;
  };
}
```

```ts
// Novos tipos para merge — adição ao topology.ts:
interface PendingMergeEntry {
  externalCallId: string;
  context: {
    callerServiceId: string;
    callerServiceName: string;
    method: string;
    path: string;
    bodyFields?: string[];
  };
  candidates: PendingMergeCandidate[];
  llmSuggestion: {
    resolvedEndpointId: string | null;
    confidence: number;               // 0–1
    certain: boolean;
    reason: string;
  };
  decision: string | 'unresolvable' | null;  // null = aguardando usuário
}

interface PendingMergeCandidate {
  endpointId: string;
  serviceId: string;
  serviceName: string;
  method: string;
  path: string;
  confidence: number;
}
```

---

### 2.5 EdgeKind — adições

```ts
type EdgeKind =
  // ... existentes ...
  | 'resolves_to'       // ExternalCallNode → EndpointNode (após merge)
  | 'depends_on';       // ServiceNode → ServiceNode/DatabaseNode (nível de ecossistema)
```

---

## 3. Fluxo de extração

### 3.1 Visão geral

```
[Usuário informa repo]
        ↓
[API clona/lê repositório]
        ↓
[Carrega provisional.json + todas as topologias existentes]
        ↓
[Engine extrai topology do novo serviço (AST)]
        ↓
[MERGE BIDIRECIONAL]
  │
  ├── DIREÇÃO 1 — calls externas do novo serviço → endpoints já extraídos
  │     ├── match único ≥ 0.95 → resolve automaticamente
  │     ├── match incerto → LLM sugere → aguarda usuário
  │     └── sem match → cria nova entrada em provisional.json
  │
  └── DIREÇÃO 2 — endpoints do novo serviço → provisional.json de outras extrações
        ├── match encontrado → LLM confirma → aguarda usuário
        └── sem match → provisional.json permanece inalterado para esse entry
        ↓
[Para cada decisão pendente (ambas as direções): UI exibe + aguarda confirmação]
        ↓
[Salva {repoName}.json]
        ↓
[Atualiza topologias dos serviços que tiveram calls resolvidas pela Direção 2]
        ↓
[Atualiza ecosystem.json]
        ↓
[Atualiza provisional.json — remove resolvidos, adiciona novos]
        ↓
[Exibe resumo]
```

### 3.2 Estados de um ExternalCallNode durante extração

```
unresolved
    → match único ≥ 0.95 → resolved (automático)
    → LLM certa → pending_user_confirmation → resolved (usuário aprova)
    → LLM incerta → pending_user_confirmation → resolved / unresolvable (usuário decide)
    → sem candidatos → unresolvable → entrada criada em provisional.json
```

### 3.3 Fluxo de merge na UI (síncrono, um por um)

Cada decisão pendente exibe um painel com:

```
┌─────────────────────────────────────────────────────┐
│  Chamada externa detectada                          │
│                                                     │
│  Serviço chamador:  auth-service                    │
│  Chamada:           POST /orders                    │
│  Body:              { userId, items[], total }      │
│                                                     │
│  Sugestão da IA:  order-service → POST /orders      │
│  Confiança: 91% — "Path e body fields coincidem"    │
│                                                     │
│  Candidatos:                                        │
│  ● order-service   POST /orders          91%        │
│  ○ cart-service    POST /checkout        43%        │
│                                                     │
│  [Aprovar sugestão]  [Escolher outro]  [Ignorar]   │
└─────────────────────────────────────────────────────┘
```

- **Aprovar sugestão**: resolve com o candidato sugerido pela LLM
- **Escolher outro**: usuário seleciona manualmente entre candidatos
- **Ignorar**: marca como `unresolvable`, cria entrada em `provisional.json`

> A LLM sempre roda antes de mostrar para o usuário. Se LLM for certa (`certain: true`), o painel destaca a sugestão com mais ênfase. Se incerta, apresenta os candidatos com igual destaque.

### 3.4 Merge bidirecional — detalhe

O merge opera em duas direções na mesma fase:

**Direção 1:** Para cada `ExternalCallNode` do novo serviço, busca candidatos nos endpoints de todos os serviços já extraídos. Também consulta `provisional.json` — se a mesma call já foi inferida por outra extração, reutiliza a entrada existente em vez de criar duplicata.

**Direção 2:** Para cada endpoint do novo serviço, verifica se existe alguma entrada `pending` em `provisional.json` de outras extrações que corresponda a ele. Se sim, propõe a resolução desse provisório com o endpoint recém-extraído. As topologias dos serviços chamadores são atualizadas após confirmação do usuário.

### 3.5 Resumo final da extração

Exibido após todas as decisões de merge:

```
Extração concluída — auth-service

  Serviços detectados:     1
  Endpoints extraídos:    18
  Bancos identificados:    2
  Calls externas:          6
    ↳ Resolvidas:          4
    ↳ Pendentes (novas):   2

  [Ver no ecossistema]  [Ver este serviço]
```

---

## 4. API — Endpoints

### 4.1 O que permanece (sem mudança de comportamento)

| Método | Path | Descrição |
|---|---|---|
| POST | /topologies/analyze | Extrai e persiste (ganha fluxo de merge) |
| GET | /topologies | Lista metadados das topologias salvas |
| GET | /topologies/:id | Retorna topologia completa |
| PATCH | /topologies/:id | Atualiza name, team, repoUrl, tags |
| DELETE | /topologies/:id | Remove topologia e atualiza ecosystem.json |

### 4.2 Removido

| Método | Path | Motivo |
|---|---|---|
| GET | /topologies/:id/services | Incompleto — não retorna DBs/edges. Substituído por /ecosystem |

### 4.3 Adicionado

| Método | Path | Descrição |
|---|---|---|
| GET | /ecosystem | Retorna ecosystem.json completo |
| GET | /ecosystem/provisional | Retorna provisional.json completo |
| POST | /topologies/analyze/merge-decision | Recebe decisão de merge durante extração ativa |

### 4.4 Contrato de `GET /ecosystem`

```ts
// Response
interface EcosystemResponse {
  updatedAt: string;
  services: EcosystemServiceEntry[];
  databases: EcosystemDatabaseEntry[];
  edges: EcosystemEdge[];
}
```

### 4.5 Contrato de `POST /topologies/analyze`

O endpoint passa a ser de longa duração com SSE (Server-Sent Events) ou WebSocket para enviar progresso e pausar para decisões de merge.

**Alternativa mais simples (primeira implementação):** Extração síncrona com retorno que inclui `pendingMerges[]`. O cliente então chama `/analyze/merge-decision` para cada decisão e o backend finaliza a persistência após todas resolvidas.

```ts
// Response intermediário (quando há merges pendentes)
interface AnalyzeInterimResponse {
  sessionId: string;                  // identifica a extração em andamento
  status: 'pending_merge_decisions';
  pendingMerges: PendingMergeEntry[];
  progress: ExtractionProgressSummary;
}

// Response final (após todas decisões)
interface AnalyzeCompleteResponse {
  status: 'complete';
  topologyId: string;                 // = repoName
  summary: ExtractionSummary;
}
```

---

## 5. Web — Telas e estados

### 5.1 HomeView

**Quando aparece:** sempre que o usuário está na raiz da aplicação.

**Elementos:**

```
┌──────────────────────────────────────────┐
│  GAIA                                    │
│                                          │
│  [Extract]   [Navigate]                  │
│  [Config*]   [Dashboard*]                │
│                                          │
│  * desabilitado na versão atual          │
└──────────────────────────────────────────┘
```

**Navigate desabilitado quando:** `ecosystem.services.length === 0`

**Estado do store necessário:**
```ts
hasEcosystem: boolean;  // true se ecosystem.json tem pelo menos 1 serviço
```

---

### 5.2 ExtractModal (dentro de HomeView)

Abre ao clicar em Extract. Fluxo em etapas:

**Etapa 1 — Formulário:**
```
  Fonte:   ● Local   ○ Git
  Path:    [/caminho/para/repo        ]

  [Iniciar extração]
```

**Etapa 2 — Progresso:**
```
  Extraindo auth-service...

  ████████████░░░░  67%

  › Detectando stack tecnológica
  › Extraindo endpoints (12/18)
  › Analisando chamadas externas
```

**Etapa 3 — Decisões de merge (repetida para cada pendente):**
```
  [painel de merge — ver seção 3.3]
```

**Etapa 4 — Resumo:**
```
  [resumo — ver seção 3.5]
  [Ver no ecossistema]  [Ver este serviço]
```

---

### 5.3 EcosystemView

**Dados:** carregados de `GET /ecosystem` ao entrar na tela.

**Nós renderizados:**
- Todos os nós são **círculos** — tanto serviços quanto bancos de dados
- Tamanho proporcional ao número de edges que **chegam** no nó (quanto mais dependências recebe, maior o círculo)
- Nós com `status: 'provisional'`: estilo tracejado/opaco

**Edges:** direcionados (from → to). Cor neutra por padrão.

**Comportamento de interação:**

| Ação | Resultado |
|---|---|
| Single click num nó | O nó clicado e os edges que **saem** dele ficam em destaque. Os demais nós e edges permanecem na cor original, sem dim. |
| Double click num nó | Painel de informações (nome, linguagem, framework, team, repoUrl, contagem de endpoints) |
| Double click num edge | Painel com informações do edge |
| Botão "Explorar serviço" (no painel de info) | Navega para ServiceView do serviço |
| Click fora de qualquer nó | Remove destaque, volta ao estado neutro |

**Estado do store necessário:**
```ts
ecosystem: EcosystemIndex | null;
ecosystemStatus: 'idle' | 'loading' | 'error';
highlightedNodeId: string | null;        // nó com single click ativo
infoPanelNode: EcosystemNode | null;     // nó com double click ativo
```

---

### 5.4 ServiceView

**Dados:** carregados de `GET /topologies/{repoName}` ao entrar na tela.

**Layout do grafo:**

O serviço analisado ocupa um container central. Dentro dele, os endpoints do serviço são exibidos como nós (círculos). Fora do container principal, à direita ou ao redor, ficam os recursos externos: bancos de dados e outros serviços. Cada serviço externo que já foi extraído aparece dentro do seu próprio container, com seus endpoints visíveis dentro dele. Bancos de dados aparecem como nós externos sem container.

Edges conectam os endpoints do serviço analisado aos recursos externos. Edges entre endpoints do mesmo serviço ficam ocultos por padrão e aparecem apenas quando o endpoint é clicado.

```
┌──────────────────────────────────────────┐
│  auth-service                            │
│  ○ POST /login  ○ GET /me  ○ DELETE /... │
└──────────────────────────────────────────┘
         │                │
         ▼                ▼
  ○ postgres     ┌─────────────────────┐
                 │  order-service      │
                 │  ○ POST /orders     │
                 │  ○ GET /orders/:id  │
                 └─────────────────────┘
```

**Comportamento de interação:**

| Ação | Resultado |
|---|---|
| Single click num endpoint | Destaca o endpoint e os edges que saem dele (para recursos externos). Edges entre endpoints do mesmo serviço aparecem. |
| Double click num endpoint | Painel de informações (method, path, humanName, description da LLM) |
| Double click num recurso externo | Painel de informações do recurso |
| Botão "Ver fluxo" (no painel de endpoint) | Navega para EndpointView |
| Click fora | Remove destaque |

**Estado do store necessário:**
```ts
activeTopology: SystemTopology | null;
activeTopologyId: string | null;          // repoName
serviceViewStatus: 'idle' | 'loading' | 'error';
highlightedEndpointId: string | null;
infoPanelItem: ServiceViewItem | null;
```

---

### 5.5 EndpointView (Flow)

**Dados:** extraídos da `activeTopology` já carregada (sem novo request). Topologias de serviços externos expandidos são carregadas sob demanda via `GET /topologies/{repoName}`.

---

#### Estrutura da view inicial

A view exibe o container do serviço analisado. Dentro dele, o container do endpoint. Dentro do endpoint, o fluxo já está completamente renderizado — nenhuma interação é necessária para revelar o conteúdo interno.

O fluxo segue uma sequência vertical com setas indicando a ordem de execução. Cada passo pode ser um nó simples (folha) ou um container.

**Funções internas** são sempre renderizadas como containers abertos desde o início, exibindo seus filhos dentro. Se uma função chama outra, o container da função chamada aparece dentro do fluxo da chamadora.

**Nós de controle de fluxo** (`IF`, `switch`, `try/catch`) são containers com ramos internos explícitos.

**Nós de retorno e throw** são folhas simples ao final de um ramo.

**Nós de call externo** (`ExternalCallNode` resolvido) aparecem no fluxo na posição correta da sequência. Deles saem duas arestas: uma para baixo continuando o fluxo, e uma lateral apontando para o container do serviço externo que fica fora do container do serviço analisado. O endpoint externo dentro desse container aparece colapsado — apenas o nó identificando o endpoint é visível.

**Nós de operação em banco** (`db.find`, `db.insert`, etc.) aparecem no fluxo na posição correta. Deles sai uma aresta apontando para o container do banco externo, que fica fora do container do serviço analisado. Esse container agrupa as tabelas acessadas e, dentro de cada tabela, as colunas consultadas ou modificadas. Múltiplas operações no mesmo banco apontam para o mesmo container.

```
┌──────────────────────────────────────────────────────────┐   ┌────────────────────────────────┐
│  auth-service                                             │   │  user-service                  │
│  ┌─────────────────────────────────────────────────────┐ │   │  ┌────────────────────────────┐ │
│  │  POST /orders                                        │ │   │  │  ◉ GET /users/:id (colaps.) │ │
│  │  ┌───────────────────────────────────────────────┐  │ │   │  └────────────────────────────┘ │
│  │  │  handleOrder                                   │  │ │   └────────────────────────────────┘
│  │  │  ┌─────────────┐  ┌──────────────────┐        │  │ │
│  │  │  │ validateInput│  │ IF items.length>0 │        │  │ │   ┌────────────────────────────────┐
│  │  │  │  ...         │  │  ...              │        │  │ │   │  postgres                       │
│  │  │  └─────────────┘  └──────────────────┘        │  │ │   │  ┌──────────────────────────┐   │
│  │  │         ↓                                      │  │ │   │  │  orders                  │   │
│  │  │  ┌──────────────────────────┐                  │  │ │   │  │  id · userId · total     │   │
│  │  │  │  getUserById             │                  │  │ │   │  └──────────────────────────┘   │
│  │  │  │  call: GET /users/:id ───────────────────────────►   │  ┌──────────────────────────┐   │
│  │  │  │         ↓                │                  │  │ │   │  │  order_items             │   │
│  │  │  │  [usa resultado]         │                  │  │ │   │  │  orderId · productId     │   │
│  │  │  └──────────────────────────┘                  │  │ │   │  └──────────────────────────┘   │
│  │  │         ↓                                      │  │ │   └────────────────────────────────┘
│  │  │  ┌──────────────────────────┐                  │  │ │
│  │  │  │  createOrder             │                  │  │ │
│  │  │  │  db.insert ──────────────────────────────────────►   (mesmo container postgres acima)
│  │  │  │         ↓                │                  │  │ │
│  │  │  │  db.insert ──────────────────────────────────────►   (mesmo container postgres acima)
│  │  │  └──────────────────────────┘                  │  │ │
│  │  │         ↓                                      │  │ │
│  │  │  → return 201 OrderDto                         │  │ │
│  │  └───────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

---

#### Interação

**Single click em qualquer nó ou aresta** — destaca o elemento clicado e o caminho relacionado (ancestrais e descendentes diretos no fluxo). Os demais elementos permanecem visíveis sem alteração visual.

**Double click em qualquer nó ou aresta** — abre o painel de informações. O conteúdo varia por tipo: endpoint exibe método, path, descrição LLM; função exibe assinatura e parâmetros; db.find exibe operação, tabela e colunas; call exibe o endpoint de destino.

**Click no nó de endpoint externo colapsado** — expande o endpoint externo dentro do container do serviço externo, revelando o fluxo interno daquele endpoint com a mesma estrutura hierárquica: containers de função, nós de db, calls externas. O processo pode se repetir indefinidamente.

**Click no mesmo nó expandido** — colapsa de volta.

**Click fora de qualquer nó** — remove qualquer destaque ativo.

---

#### Casos especiais

**Endpoint externo provisório** (serviço ainda não extraído) — aparece no container do serviço externo com estilo tracejado. Não é expansível. Double click abre painel informando que o serviço não foi extraído, com opção de iniciar extração.

**Endpoint externo com merge pendente** — aparece com estilo de pendência. Double click abre painel de decisão de merge.

---

**Estado do store necessário:**
```ts
activeEndpointId: string | null;
expandedExternalEndpointIds: Set<string>;  // endpoints externos expandidos
highlightedNodeId: string | null;
infoPanelNode: FlowNode | null;
externalTopologies: Map<string, SystemTopology>;  // topologias carregadas sob demanda
```

---

## 6. Navegação

### 6.1 Hierarquia de telas

```
Home
└── EcosystemView
    └── ServiceView (serviço selecionado)
        └── EndpointView (endpoint selecionado)
```

### 6.2 Breadcrumb

Fixo no topo da aplicação, visível em todas as telas exceto Home.

```
Ecossistema  >  auth-service  >  POST /login
```

Cada item é clicável e navega para aquela tela.

Botão de Home separado no canto (volta para HomeView, sai do modo de navegação).

### 6.3 Nomes dos estados de navegação no store

```ts
type Screen = 'home' | 'ecosystem' | 'service' | 'endpoint';

navigation: {
  screen: Screen;
  serviceId: string | null;       // = repoName quando em ServiceView ou EndpointView
  endpointId: string | null;      // quando em EndpointView
};
```

---

## 7. O que existe hoje vs o que será

### 7.1 `packages/core/src/types/topology.ts`

| Hoje | Após |
|---|---|
| Sem `ExternalCallNode` | Adicionar `ExternalCallNode` e `externalCall` ao union `CodeNode` |
| Sem `ExternalDependency` em `ServiceNode` | Adicionar campo `externalDependencies: ExternalDependency[]` |
| Sem tipos de merge | Adicionar `PendingMergeEntry`, `PendingMergeCandidate`, `PendingMergesFile` |
| `EdgeKind` sem `resolves_to` e `depends_on` | Adicionar ambos |

### 7.2 `src/` (código legado)

| Hoje | Após |
|---|---|
| `src/analysis/llm-enrichment.ts` orphaned | Mover para `packages/core/src/analysis/llm-enrichment.ts` + ajustar imports |
| `src/analysis/service-merger.ts` orphaned | Mover para `packages/core/src/analysis/service-merger.ts` + ajustar imports |
| `src/extractors/` parcialmente duplicado | Auditar extrator a extrator: mover o que falta, descartar duplicatas |

### 7.3 `packages/core/src/index.ts`

| Hoje | Após |
|---|---|
| Não exporta nada de analysis/ | Exportar `enrichService`, `runCrossServiceMerge`, `applyPendingMerges` |

### 7.4 `apps/api/src/`

| Hoje | Após |
|---|---|
| Sem `ecosystem.json` | `EcosystemService` cria/lê/atualiza `ecosystem.json` |
| Sem `provisional.json` | `ProvisionalService` cria/lê/atualiza `provisional.json` |
| `GET /topologies/:id/services` existe | Remover |
| Sem `GET /ecosystem` | Adicionar |
| Sem `GET /ecosystem/provisional` | Adicionar |
| Extração é fire-and-forget | Extração ganha fluxo de merge interativo |
| `StoredTopology` usa nanoid como ID | ID passa a ser o nome do repositório |
| Sem verificação de duplicatas | Checar se `{repoName}.json` já existe antes de extrair |

### 7.5 `apps/web/src/`

| Hoje | Após |
|---|---|
| Store: `topology: SystemTopology \| null` | Manter para ServiceView/EndpointView. Adicionar `ecosystem: EcosystemIndex \| null` |
| `EcosystemView` usa `topology` | Usar `ecosystem` |
| Sem breadcrumb | Adicionar componente `Breadcrumb` |
| `navigation` usa `appScreen` + `viewLevel` | Unificar em `navigation.screen` conforme seção 6.3 |
| ExtractModal sem etapas de merge | Adicionar etapas 2, 3, 4 conforme seção 5.2 |
| Sem `loadEcosystem()` no store | Adicionar |
| Config e Dashboard desabilitados | Manter desabilitados |

---

## 8. Convenções de nomenclatura

### Arquivos

| Artefato | Nome |
|---|---|
| Índice do ecossistema | `ecosystem.json` |
| Nós provisórios | `provisional.json` |
| Topologia por repositório | `{repoName}.json` (ex: `auth-service.json`) |

### IDs

| Entidade | ID |
|---|---|
| Sistema/topologia | Nome do repositório (`repoName`) — lowercase, hífens |
| Serviço no ecossistema | Igual ao `repoName` |
| Banco no ecossistema | `{repoName}:{databaseName}` |
| Endpoint | nanoid (gerado na extração, estável) |
| ExternalCallNode | nanoid (gerado na extração) |
| ProvisionalEntry | nanoid (estável — não muda se a mesma call aparecer em novas extrações) |

### Estados de merge

| Estado | Descrição |
|---|---|
| `unresolved` | Recém extraído, ainda não processado |
| `pending_review` | LLM processou, aguarda decisão do usuário |
| `resolved` | Merge aprovado, `resolvedEndpointId` preenchido |
| `unresolvable` | Nenhum candidato encontrado ou usuário marcou como ignorar |

### Status de nó no ecossistema

| Status | Descrição |
|---|---|
| `active` | Extraído e confirmado |
| `provisional` | Inferido a partir de call externa, ainda não extraído |

---

## 9. Fora de escopo (próximas versões)

- Geração de documentação
- Config screen
- Dashboard screen
- Versionamento de topologias (histórico de extrações do mesmo repo)
- Neo4j adapter
- GitHub adapter
- Expansão de endpoint externo quando o serviço não foi extraído (nó provisório — só mostra painel de info, não expande)
