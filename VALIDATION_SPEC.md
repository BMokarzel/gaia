# Especificação de Validação e Regras do Sistema

> Documento de referência para validação de nós, edges, fluxos e comportamento de telas.
> Nomes de campos e tipos seguem exatamente a interface `SystemTopology` (`packages/core/src/types/topology.ts`).

---

## Sumário

1. [Nós de Código (Code Nodes)](#1-nós-de-código)
2. [Nós de Recursos (Infrastructure Nodes)](#2-nós-de-recursos)
3. [Frontend Nodes](#3-frontend-nodes)
4. [Edges](#4-edges)
5. [Validação de Fluxo de Endpoint](#5-validação-de-fluxo-de-endpoint)
6. [Regras de Display (Tela Web)](#6-regras-de-display)
7. [Divergências com o Rascunho Original](#7-divergências)

---

## 1. Nós de Código

Todos os nós de código (`CodeNode`) compartilham a estrutura base:

```
id:       string   — identificador único estável (hash determinístico)
type:     string   — discriminador do tipo
name:     string   — nome legível
location: { file, line, column, endLine?, endColumn? }
children: CodeNode[]
metadata: { ... }  — campos específicos do tipo
raw?:     string   — trecho original do código (opcional, removido no output)
```

**Tipos válidos de `CodeNode`:**
`endpoint | function | call | event | dbProcess | process | flowControl | return | throw | data | log | telemetry | externalCall`

---

### 1.1 ServiceNode

Nó raiz de um serviço. Não é um `CodeNode` — é um nó de nível 2 da topologia.

**Campos obrigatórios:**

```
id:    string                 — serviceId derivado do repoPath
name:  string                 — nome do repositório (ex: "order-service")
code:  string                 — sigla em letras maiúsculas (ex: "OS", "XEA")
metadata.runtime              — "node" | "python" | "go" | "java" | ...
metadata.language             — linguagem principal
metadata.protocol             — "rest" | "graphql" | "grpc" | "event-driven" | ...
metadata.kind                 — "backend" | "bff" | "gateway" | "worker" | "cron"
                                | "frontend" | "microfrontend" | "mobile"
                                | "monolith" | "library" | "shared"
endpoints:  EndpointNode[]    — vazio para frontend/mobile
screens:    ScreenNode[]      — vazio para backend/worker (⚠️ campo a adicionar no código)
functions:  FunctionNode[]
globals:    DataNode[]
dependencies: Dependency[]
```

**Regras:**

- `name` deve corresponder ao nome do diretório/repositório.
- `code` é uma sigla em **letras maiúsculas**. Geração:
  - **Preferencial:** lida de `tree.config.json` na raiz do serviço (`{ "code": "XEA" }`).
  - **Fallback automático:** iniciais de cada palavra do `name` → "order-service" → `"OS"`, "user-auth-service" → `"UAS"`. Em caso de colisão, adicionar dígito incremental.
  - ⚠️ **Divergência atual:** o código gera `code = toKebabCase(name)` (ex: `"order-service"`). Precisa ser alterado para sigla.
- Serviços `kind: "backend"` devem ter ao menos um `EndpointNode`.
- Serviços `kind: "frontend"` | `"microfrontend"` | `"mobile"` têm `endpoints: []` (vazio) e `screens: ScreenNode[]` com suas telas. Edge `renders` é gerado automaticamente de `service.id` → cada `screen.id`.
- Serviços `kind: "worker"` podem ter zero endpoints; devem consumir de pelo menos um `BrokerTopic` (edge `consumes_from` apontando para o serviço).
- Serviços `kind: "monolith"` têm simultaneamente `endpoints[]` (parte backend) e `screens[]` (parte frontend). São um único `ServiceNode` — não há `ServiceNode` dentro de outro.
- Quando `dependencies` contém um item, deve existir um edge correspondente em `SystemTopology.edges`.
- Dependência `targetKind: "service"` → edge `depends_on` ou `resolves_to`.
- Dependência `targetKind: "database"` → edge `reads_from` e/ou `writes_to` (um edge por tipo de operação).
- Dependência `targetKind: "broker"` → edge `publishes_to` ou `consumes_from`.

**Cores de nó por `kind` (view de ecossistema):**

| `kind`                         | Cor           | Nota                                          |
|--------------------------------|---------------|-----------------------------------------------|
| `"backend"`                    | Azul          | Serviço REST/gRPC/GraphQL puro                |
| `"bff"`                        | Azul-esverdeado | Backend For Frontend                        |
| `"gateway"`                    | Amarelo escuro | API Gateway / proxy                          |
| `"worker"` / `"cron"`         | Cinza escuro  | Sem endpoints, orientado a eventos/jobs       |
| `"frontend"` / `"microfrontend"` | Laranja    | Serve apenas telas web                        |
| `"mobile"`                     | Vermelho      | App mobile (React Native, Flutter, etc.)      |
| `"monolith"`                   | Roxo          | Back + front no mesmo deploy                  |
| `"library"` / `"shared"`      | Cinza claro   | Sem endpoints, sem telas                      |

**Card/Info (display):**

- Destaque: `code` (sigla), `metadata.runtime`, `metadata.framework`.
- Informações: `name`, `code`, `metadata.repository.url`, `metadata.team`, `metadata.repository.branch`, `analyzedAt`.
  - Backend: lista de endpoints (`method + path`), botão → System View (endpoints).
  - Frontend/mobile: lista de screens (`name` + `route`), botão → System View (screens).
- Representação visual (ecossistema): **círculo** com `code` no centro, colorido pelo `kind`.

---

### 1.2 EndpointNode

```
type: "endpoint"
metadata:
  method:      "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD"
  path:        string               — ex: "/users/:id"
  framework?:  string
  middleware?: string[]
  controller?: string               — classe ou arquivo que define o handler
  handlerFnId?: string              — ID do FunctionNode que implementa o endpoint
  request:
    params?:   TypedField[]         — path params (ex: :id)
    query?:    TypedField[]         — query string params
    body?:     TypedField[]         — campos do body
    bodyType?: string               — DTO/tipo do body
    headers?:  TypedField[]
    contentType?: string
  responses:   EndpointResponse[]
    [{ httpStatus, description?, bodyType?, source: "return"|"throw", nodeId }]
```

**Regras:**

- `name` de um `EndpointNode` é `"ClassName.methodName"` (padrão extraído pelos parsers — Spring, NestJS, etc.). O **display** do endpoint usa `metadata.method + " " + metadata.path` como título legível.
- Endpoints não provisórios devem ter `children` não vazio (contém o fluxo do handler).
- `handlerFnId` deve apontar para um `FunctionNode.id` existente em `service.functions`.
- `responses` deve ter ao menos uma entrada.
- Cada `EndpointResponse.nodeId` deve referenciar um `ReturnNode` ou `ThrowNode` real em `children` (recursivamente).
- Os `request.params` devem corresponder (tipo compatível) com os params dos `ExternalCallNode` ou `CallNode` que apontam para este endpoint.
- O fluxo de `children` deve sempre terminar com um `ReturnNode` ou `ThrowNode` (ver §5).
- Um endpoint sem `children` mas com `handlerFnId` copia os `children` do handler (implementado em `linkEndpointHandlers`).

**Card/Info (display):**

- Destaque: badge com `metadata.method` (colorido por método) + `metadata.path`.
- Seção Request: params, query, body (com tipos), headers.
- Seção Responses: lista de `{ httpStatus, bodyType, condição }`.
- Descrição gerada por LLM (`metadata.llm.description`): deve responder — o que recebe, o que faz, o que chama, o que retorna e sob quais condições. Primeiro parágrafo = síntese; demais = detalhe.

---

### 1.3 FunctionNode

```
type: "function"
metadata:
  kind:        "declaration" | "expression" | "arrow" | "method" | "constructor" | "getter" | "setter"
  async:       boolean
  generator:   boolean
  params:      ParamInfo[]          — [{ name, type?, optional, defaultValue?, destructured, decorators? }]
  returnType?: string
  visibility?: "public" | "private" | "protected"
  decorators?: string[]             — ex: ["@Transactional", "@Override"]
  className?:  string               — nome da classe que contém o método (Java/TS/Go)
  errorMap:    ErrorDescriptor[]
  complexity?:
    cyclomatic:   number
    linesOfCode:  number
  sideEffects?:
    performsIO:       boolean
    throwsUnhandled:  boolean
```

**Regras:**

- `name` de método é `"ClassName.methodName"` (qualified). Funções standalone usam apenas o nome.
- Toda função gera um container visual que envolve seus `children`.
- `params` devem aparecer como `DataNode` (kind: `"parameter"`) em `children` se forem usados dentro da função.
- Se a função tem múltiplos caminhos de retorno → deve haver ao menos um `FlowControlNode` em `children`.
- Se `returnType` é `boolean` e existem múltiplos retornos → o `FlowControlNode` que os controla deve ter ao menos 2 branches.
- `errorMap` lista todos os erros que podem ser lançados. Cada entrada deve corresponder a um `ThrowNode` em `children`.
- Construtores (`kind: "constructor"`) podem ter edges `depends_on` para outros construtores baseados nos tipos dos `params`.
- Funções arrow (`kind: "arrow"`) são lambdas com corpo em bloco (≥ 2 statements).

**Card/Info (display):**

- `name`, `params` (com tipos), `returnType`, `visibility`, `decorators`.
- `complexity.cyclomatic` — destaque visual se > 10.

---

### 1.4 CallNode

Representa uma invocação de função dentro do código.

```
type: "call"
metadata:
  callee:     string      — ex: "this.userService.findById", "OrderService.validate", "ClassName::method"
  arguments:  string[]    — textos dos argumentos passados
  awaited:    boolean
  chained:    boolean     — parte de uma cadeia de chamadas (a.b().c())
  optional:   boolean     — a?.b()
  resolvedTo?: string     — FunctionNode.id se o callee foi resolvido
```

**Regras:**

- `callee` nunca vazio.
- Se `resolvedTo` está preenchido → deve ser um `FunctionNode.id` válido.
- Edge `calls` deve existir: `source=parentFunctionNode.id`, `target=resolvedTo`.
- Chamadas com `::` são referências de método (Java/Kotlin): `ClassName::method` → resolve para `FunctionNode` de nome `ClassName.method`.
- Não tem `children` (é um nó folha do fluxo).

---

### 1.5 ExternalCallNode

Representa uma chamada HTTP outbound para outro serviço (RestTemplate, axios, fetch, Feign, etc.).

```
type: "externalCall"
metadata:
  method:          "GET"|"POST"|"PUT"|"PATCH"|"DELETE"|...
  path:            string          — ex: "/users/:id"
  pathNormalized?: string          — ex: "/users/:param"
  baseUrl?:        string          — ex: "http://user-service:8081"
  httpClient?:     string          — "RestTemplate" | "axios" | "Feign" | "WebClient" | ...
  bodyFields?:     string[]
  awaited?:        boolean
  mergeStatus?:    "provisional" | "resolved" | "pending_review" | "unresolvable"
  mergeConfidence?: number         — 0–1
  mergeReason?:    string
  resolvedEndpointId?: string      — EndpointNode.id após cross-service merge
```

**Regras:**

- Todo `ExternalCallNode` começa com `mergeStatus: "provisional"`.
- Após o merge: `"resolved"` (encontrou endpoint com ≥ 0.95 confiança), `"pending_review"` (incerto), `"unresolvable"` (sem candidato).
- Quando `resolved`: edge `resolves_to` de `parentFunctionNode.id` → `resolvedEndpointId`.
- Não tem `children`.
- `path` e `pathNormalized` devem ser consistentes: `pathNormalized` substitui todos os segmentos variáveis por `:param`.

---

### 1.6 EventNode

Representa emissão ou consumo de eventos (Kafka, RabbitMQ, EventEmitter, etc.).

```
type: "event"
metadata:
  kind:       "emit" | "on" | "once" | "off" | "addEventListener" | "dispatch" | "subscribe" | "publish"
  eventName:  string     — nome do evento/tópico
  channel?:   string     — tópico ou fila (para brokers)
  payload?:   string     — tipo do payload
```

**Regras:**

- `eventName` nunca vazio.
- `kind` de produção (`"emit"`, `"publish"`, `"dispatch"`) → edge `publishes_to` de `service.id` → `broker.id`.
- `kind` de consumo (`"on"`, `"subscribe"`, `"consumes_from"`) → edge `consumes_from` de `broker.id` → `service.id`.
- Não tem `children` (nó folha). Um evento nunca termina um fluxo — deve sempre estar dentro de uma função que continua após ele.
- Todo `EventNode` deve estar dentro de um `FunctionNode` (não pode ser filho direto de um endpoint sem função intermediária).
- `channel` deve corresponder ao `BrokerTopic.name` de algum `BrokerNode` em `SystemTopology.brokers`.

---

### 1.7 DbProcessNode

Representa uma operação de banco de dados (ORM ou raw SQL).

```
type: "dbProcess"
metadata:
  operation:    "find" | "findMany" | "findFirst" | "findUnique"
                | "create" | "createMany" | "update" | "updateMany" | "upsert"
                | "delete" | "deleteMany" | "aggregate" | "groupBy" | "count"
                | "raw" | "transaction" | "migrate"
  databaseId:   string       — DatabaseNode.id
  tableId:      string       — TableNode.id
  orm?:         string       — "prisma" | "typeorm" | "jpa" | "sequelize" | "gorm" | ...
  conditions?:  string       — cláusula WHERE/filter
  fields?:      string[]     — campos selecionados/atualizados
  relations?:   string[]     — relações incluídas (include/join)
  orderBy?:     string
  pagination?:  { strategy: "offset"|"cursor", limitField?, offsetField? }
```

**Regras:**

- `databaseId` deve referenciar um `DatabaseNode.id` existente em `SystemTopology.databases`.
- `tableId` deve referenciar um `TableNode.id` dentro do `DatabaseNode` referenciado.
- Edge obrigatório: `reads_from` (operações find/count/aggregate) ou `writes_to` (create/update/upsert/delete/raw/migrate) de `dbProcess.id` → `database.id`.
- Operações de escrita: `create`, `createMany`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`, `raw`, `migrate`.
- Não tem `children`.

---

### 1.8 ProcessNode

Representa uma operação computacional pura (transformação, validação, mapeamento).

```
type: "process"
metadata:
  kind:         "transformation" | "computation" | "validation" | "assignment"
                | "comparison" | "serialization" | "deserialization" | "mapping"
  operator?:    string     — ex: "+", "===", "map"
  description?: string
```

**Regras:**

- Nó auxiliar para documentar lógica intermediária.
- Não tem `children`.
- Não gera edges estruturais — é informativo.

---

### 1.9 FlowControlNode

Representa estruturas de controle de fluxo (if/switch/for/try/etc.).

```
type: "flowControl"
metadata:
  kind:       "if" | "else" | "else_if" | "switch" | "case" | "default"
              | "for" | "for_of" | "for_in" | "while" | "do_while"
              | "try" | "catch" | "finally"
              | "ternary" | "nullish_coalescing" | "optional_chain" | "label"
  condition?: string      — expressão da condição (ex: "user.isAdmin", "status === 'active'")
  branches?:  { label: string; children: CodeNode[] }[]
```

**Regras:**

- `kind: "if"` deve ter ao menos 2 edges saindo (os caminhos verdadeiro e falso, ou verdadeiro + `else`/`else_if`).
- `condition` deve estar preenchido para: `if`, `else_if`, `while`, `do_while`, `for`, `for_of`, `for_in`, `switch`, `case`, `ternary`.
- `kind: "catch"` deve ter `condition` com o tipo da exceção capturada (ex: `"IllegalArgumentException"`).
- `kind: "try"` é sempre acompanhado por um `kind: "catch"` ou `kind: "finally"` nos filhos ou siblings.
- Loops (`for`, `while`, `do_while`) podem conter qualquer `CodeNode` em `children`.
- O container visual de um `flowControl` engloba todos os seus `children` por range de linhas.
- `kind: "label"` (Java labeled statement) contém outro `flowControl` (geralmente `for`) como filho.

**Edge de fluxo:**

- Todo edge que sai de um `FlowControlNode` deve carregar `metadata.condition` no edge com a condição que levou àquele caminho.

---

### 1.10 ReturnNode

Representa um ponto de retorno explícito ou implícito.

```
type: "return"
metadata:
  kind:         "explicit" | "implicit" | "response"
  value?:       string          — expressão retornada (ex: "user", "null", "ResponseEntity.ok(saved)")
  valueType?:   string          — tipo inferido do valor (ex: "User", "void", "boolean")
  httpStatus?:  number          — se for retorno HTTP (ex: 200, 201, 404)
  responseType?: "json"|"html"|"redirect"|"stream"|"text"|"file"
```

**Regras:**

- Não tem `children`. Edges NÃO partem de `ReturnNode`.
- `kind: "response"` indica retorno HTTP direto (controladores REST) — deve ter `httpStatus`.
- `kind: "implicit"` é inferido (sem `return` explícito, ex: void, last expression em Ruby/Kotlin).
- Retornos de resultado bem-sucedido → display em verde.
- Retornos que precedem ou são condicionados por erro podem ter estilo alternativo, mas o erro em si é representado por `ThrowNode` (ver §1.11).
- Quando um endpoint retorna outra função (ex: service method), o `ReturnNode` do endpoint tem `value` = chamada ao método, e o fluxo real está no `FunctionNode` chamado.
- Todo endpoint deve ter ao menos um `ReturnNode` em `children` (recursivamente).

**Card/Info:**

- `httpStatus` + `valueType` como destaque.
- `value` (expressão retornada).

---

### 1.11 ThrowNode

Representa lançamento de exceção ou erro.

```
type: "throw"
metadata:
  kind:         "throw" | "reject" | "next_error" | "panic"
  errorClass:   string          — ex: "IllegalArgumentException", "NotFoundException", "Error"
  message?:     string          — mensagem do erro
  httpStatus?:  number          — status HTTP mapeado (ex: 404, 400, 500)
  code?:        string          — código de erro de negócio
  caughtBy?:    string          — ID do FlowControlNode catch que captura
  propagates:   boolean         — true se o erro sobe para o chamador
  errorHandler?: string         — ID do handler global (middleware de erro)
```

**Regras:**

- Não tem `children`. Edges NÃO partem de `ThrowNode`.
- Display em vermelho/laranja (indica caminho de erro).
- `propagates: true` → o erro sobe para o chamador; deve haver um `FlowControlNode (kind: "catch")` no chamador ou um `errorHandler` global.
- `caughtBy` referencia o `FlowControlNode.id` do `catch` que captura este throw.
- `httpStatus` deve corresponder ao `EndpointResponse.httpStatus` quando mapeado.
- Todo `ThrowNode` com `propagates: true` deve aparecer em `FunctionNode.metadata.errorMap`.

---

### 1.12 DataNode

Representa declarações de dados: variáveis, constantes, tipos, interfaces, classes, enums, imports.

```
type: "data"
metadata:
  kind:         "variable" | "constant" | "parameter" | "interface" | "type"
                | "enum" | "class" | "object_literal" | "destructuring"
                | "import" | "export" | "generic"
  dataType?:    string          — tipo (ex: "string", "User", "List<Order>", "boolean")
  mutable:      boolean         — true para var/let; false para const/final/val
  scope:        "local" | "module" | "global" | "class" | "block"
  initialValue?: string         — valor inicial se literal
  exported?:    boolean
  fields?:      TypedField[]    — campos de interface/class/type
  superClass?:  string          — para classes: nome da classe pai (Java/TS)
  implements?:  string[]        — para classes: interfaces implementadas
  className?:   string          — para inner classes: nome da classe contenedora
```

**Regras:**

- `scope: "module"` ou `"global"` → vai para `service.globals` (não fica em `children` de função).
- `scope: "local"` ou `"block"` → fica em `children` da função/bloco que a declara.
- `scope: "class"` → inner class; referenciada por `className`.
- Variáveis que recebem funções como valor (`kind: "variable"`, `dataType` = nome de função) são tratadas como `DataNode`, não como `FunctionNode`.
- `kind: "import"` → edge `imports` de `service.id` → módulo importado.
- `kind: "class"` com `superClass` → edge `extends` de `dataNode.id` → target.
- `kind: "class"` ou `"interface"` com `implements` → edge `uses` de `dataNode.id` → interface.
- Enums: `fields` lista os valores do enum.
- Parâmetros (`kind: "parameter"`) devem corresponder 1:1 com `FunctionNode.metadata.params`.

---

### 1.13 LogNode

Representa chamadas de logging estruturado ou de console.

```
type: "log"
metadata:
  level:              "trace"|"debug"|"info"|"warn"|"error"|"fatal"|"log"
  library:            "console"|"winston"|"pino"|"bunyan"|"log4js"|"debug"|"custom"
  message?:           string
  hasStructuredData:  boolean
  context?:           string[]           — campos de contexto (ex: ["userId", "orderId"])
  includesTraceId:    boolean
  includesUserId:     boolean
  includesRequestId:  boolean
  category:           "request"|"response"|"error"|"business_logic"|"performance"|"security"|"lifecycle"|"general"
```

**Regras:**

- Não tem `children`.
- `level: "error"` ou `"fatal"` → deve estar próximo de um `ThrowNode` ou dentro de um `FlowControlNode (kind: "catch")`.
- Edge `logs` de `parentFunction.id` → `logNode.id` (registrado em `SystemTopology.observability.logs`).

---

### 1.14 TelemetryNode

Representa instrumentação de observabilidade (OpenTelemetry, Datadog, etc.).

```
type: "telemetry"
metadata:
  kind:         "span" | "metric" | "trace" | "event" | "baggage" | "context"
  span?:        { name, kind: "internal"|"server"|"client"|"producer"|"consumer", attributes, statusOnError? }
  metric?:      { name, type: "counter"|"histogram"|"gauge"|"updown_counter", unit?, labels }
  sdk:          "otel" | "datadog" | "newrelic" | "honeycomb" | "custom"
  instrumentation: "manual" | "auto" | "decorator"
  parentSpanRef?: string
  carriesContext: boolean
```

**Regras:**

- Não tem `children`.
- Edge `traces` de `parentFunction.id` → `telemetryNode.id`.
- `carriesContext: true` → este nó propaga o trace context para chamadas subsequentes.

---

## 2. Nós de Recursos

### 2.1 DatabaseNode + TableNode

```
DatabaseNode:
  id:   resourceId("database", connectionAlias)
  metadata:
    engine:          "postgresql"|"mysql"|"mongodb"|"redis"|"elasticsearch"|...
    category:        "sql"|"nosql"|"graph"|"kv"|"search"|"analytics"|"timeseries"
    connectionAlias: string    — chave de correspondência com DbProcessNode.databaseId

TableNode:
  id:   tableId(databaseId, tableName)
  metadata:
    kind:       "table"|"collection"|"node_label"|"index"|"keyspace"|"stream"|"bucket"
    databaseId: string
    columns?:   ColumnDef[]
    primaryKey?: string[]
    hasTimestamps: boolean
    hasSoftDelete: boolean
    entityName?:  string       — nome da entidade ORM (ex: "Order")
```

**Regras:**

- `connectionAlias` deve ser único por `DatabaseNode` dentro da topologia.
- Edges `reads_from` e `writes_to` têm `metadata.table` = `TableNode.id`.
- `category` derivado de `engine`:
  - `"sql"` → postgresql, mysql, sqlite, mariadb
  - `"nosql"` → mongodb, dynamodb, firestore, couchdb
  - `"kv"` → redis, memcached, valkey
  - `"graph"` → neo4j, neptune, arangodb
  - `"search"` → elasticsearch, opensearch, meilisearch
  - `"timeseries"` → timescaledb, influxdb

---

### 2.2 BrokerNode + BrokerTopic

```
BrokerNode:
  metadata:
    engine:          "kafka"|"rabbitmq"|"sqs"|"sns"|"pubsub"|"nats"|...
    category:        "queue"|"pubsub"|"stream"|"event-bus"
    connectionAlias: string
    topics:          BrokerTopic[]
      [{ name, kind: "topic"|"queue"|..., producers: string[], consumers: string[] }]
```

**Regras:**

- `BrokerTopic.producers` e `BrokerTopic.consumers` contêm `ServiceNode.id`.
- Para cada `producerId` → edge `publishes_to` de `producerId` → `broker.id` com `metadata.topic`.
- Para cada `consumerId` → edge `consumes_from` de `broker.id` → `consumerId` com `metadata.topic`.
- `connectionAlias` deve ser único por `BrokerNode`.

---

### 2.3 StorageNode

```
StorageNode:
  metadata:
    kind:           "object"|"file"|"block"|"archive"
    provider:       "s3"|"gcs"|"azure-blob"|"minio"|"r2"|"local"|"nfs"
    bucket?:        string
    accessPattern:  "public"|"private"|"signed-url"|"cdn"
    encryption:     boolean
    versioning:     boolean
```

**Regras:**

- Serviços que usam storage devem ter `dependency.targetKind: "storage"`.

---

## 3. Frontend Nodes

> **Nomenclatura importante:** `ScreenNode` é um **nó de dados da topologia** — representa uma tela do aplicativo analisado (React, Flutter, etc.). Não confundir com as "telas/views do Gaia" (o próprio app de visualização). São coisas completamente distintas. As regras desta seção descrevem o nó de dados; as regras de display do Gaia ficam no §6.

### Hierarquia de dados

```
ServiceNode (kind: "frontend" | "mobile" | "microfrontend" | "monolith")
  └── screens: ScreenNode[]

ScreenNode
  ├── navigatesTo: ScreenNode.id[]      ← quais telas esta leva
  └── components: ComponentNode[]       ← áreas da tela com interação

ComponentNode
  ├── children: ComponentNode[]         ← sub-componentes
  └── events: FrontendEventNode[]

FrontendEventNode
  └── actions[]
        ├── api_call  → EndpointNode.id
        ├── navigate  → ScreenNode.id
        └── ...
```

**Divergência com o código atual — mudanças necessárias no `topology.ts`:**
1. Adicionar `screens?: ScreenNode[]` a `ServiceNode`.
2. Manter `SystemTopology.screens` como **índice flat** derivado automaticamente pelo orchestrator (sem precisar percorrer a árvore).
3. Edge `renders` (service → screen) gerado automaticamente de `service.screens[]` — não precisa ser explícito no JSON.

---

### 3.1 ScreenNode

Nó de dados que representa uma tela do app analisado (page, modal, drawer, sheet, etc.).

```
ScreenNode:
  id:       string
  type:     "screen"
  name:     string
  metadata:
    kind:         "page"|"modal"|"drawer"|"sheet"|"dialog"|"tab"|"overlay"
    route?:       string          — rota (ex: "/products/:id")
    routeParams?: TypedField[]
    queryParams?: TypedField[]
    framework?:   "react"|"vue"|"angular"|"svelte"|"solid"
                  |"react-native"|"flutter"|"swift-ui"|"jetpack-compose"
    filePath:     string
    authRequired: boolean
    roles?:       string[]
    guards?:      string[]
    layout?:      string
    title?:       string
  components:   ComponentNode[]   ← áreas da tela com interação
  navigatesTo:  string[]          ← ScreenNode.id[] para onde esta tela leva
```

**Regras:**

- Toda `ScreenNode` deve ter ao menos um `ComponentNode` em `components`.
- `navigatesTo` deve listar ao menos um destino — exceto telas de saída (logout, deep link externo).
- Telas web: `framework` ∈ `{react, vue, angular, svelte, solid}`.
- Telas mobile: `framework` ∈ `{react-native, flutter, swift-ui, jetpack-compose}`.
- `authRequired: true` → deve ter `roles` ou `guards` preenchidos.
- Edge `navigates_to` de `screen.id` → `targetScreen.id` para cada entrada em `navigatesTo`.
- Edge `renders` de `service.id` → `screen.id` gerado automaticamente.

**Fluxo de dados (não de display):**

```
ScreenNode
  └── components[]: ComponentNode
        └── events[]: FrontendEventNode
              └── actions[]:
                    api_call  → EndpointNode.id   — chamada ao backend
                    navigate  → ScreenNode.id     — navegação para outra tela
```

---

### 3.2 ComponentNode (Content)

Representa uma área de conteúdo interativo dentro de uma tela. O campo `content` de `ScreenNode` contém componentes de nível de tela (formulários, listas, modais). Sub-componentes (botões, inputs) ficam em `children`.

```
ComponentNode:
  id:   string
  type: "component"
  name: string
  metadata:
    kind:       "page_component"|"layout"|"widget"|"form"|"list"|"table"
                |"chart"|"navigation"|"input"|"button"|"modal"|"shared"|"primitive"
    filePath:   string
    exported:   boolean
    props:      TypedField[]
    state:
      local:        TypedField[]
      store?:       string
      storeFields?: string[]
    hooks?:     string[]
    lifecycle?: string[]
    queries?:   ComponentQuery[]
      [{ hookOrMethod, key?, endpointId?, method, path }]
    conditionalRender?: { condition, showsComponents: string[] }[]
  children: ComponentNode[]       ← sub-componentes (botão dentro de form, etc.)
  events:   FrontendEventNode[]
```

**Regras:**

- `queries[].endpointId` → edge `fetches_from` de `component.id` → `endpoint.id`.
- `kind: "button"` ou `kind: "form"` devem ter ao menos um `FrontendEventNode` com `trigger: "click"` ou `trigger: "submit"`.
- Componentes `children` são sub-elementos visuais contidos dentro do componente pai.
- Um componente sem `events` e sem `children.events` é estático (só display) — válido mas deve ser apontado como aviso se for `kind: "form"` ou `kind: "button"`.

---

### 3.3 FrontendEventNode

Representa uma interação do usuário que dispara ações.

```
FrontendEventNode:
  id:       string
  type:     "frontend_event"
  name:     string
  location: SourceLocation
  metadata:
    trigger:  "click"|"submit"|"change"|"hover"|"focus"|"blur"
              |"scroll"|"keypress"|"drag"|"swipe"|"longpress"
              |"mount"|"unmount"|"intersection"|"timer"|"custom"
    element?: string
    actions:  FrontendAction[]
```

**FrontendAction — tipos:**

| `kind`         | Campos obrigatórios                               | Edge gerado          |
|----------------|---------------------------------------------------|----------------------|
| `api_call`     | `endpointId`, `method`, `path`                    | `fetches_from`       |
| `navigate`     | `targetScreenId`                                  | `navigates_to`       |
| `state_update` | `field`                                           | —                    |
| `emit_event`   | `eventName`                                       | `triggers`           |
| `analytics`    | `provider`, `eventName`                           | —                    |
| `validation`   | `fields?`                                         | —                    |
| `side_effect`  | `description`                                     | —                    |

**Regras:**

- `api_call.endpointId` deve referenciar um `EndpointNode.id` existente em algum serviço backend da topologia.
- `navigate.targetScreenId` deve referenciar um `ScreenNode.id` existente no serviço ou na topologia.
- Toda action `api_call` deve ter edge `fetches_from` correspondente.
- Toda action `navigate` deve resultar em `targetScreenId` estar em `screen.navigatesTo`.
- Um `FrontendEventNode` deve ter ao menos uma `action`. Um evento sem ação é inválido.

---

## 4. Edges

### Estrutura

```
Edge:
  source:    string    — ID do nó origem (nunca vazio)
  target:    string    — ID do nó destino (nunca vazio, source ≠ target)
  kind:      EdgeKind
  metadata?: Record<string, unknown>
```

### Tipos de Edge e Regras

| `kind`          | `source` tipo                | `target` tipo                 | Quando                                    |
| --------------- | ---------------------------- | ----------------------------- | ----------------------------------------- |
| `calls`         | EndpointNode / FunctionNode  | FunctionNode                  | Chamada de função/método                  |
| `uses`          | DataNode (class)             | DataNode (interface)          | Classe implementa interface               |
| `extends`       | DataNode (class/interface)   | DataNode (class/interface)    | Herança                                   |
| `imports`       | ServiceNode                  | ServiceNode / string (módulo) | Import de módulo                          |
| `depends_on`    | ServiceNode / FunctionNode   | ServiceNode / DatabaseNode    | Dependência estrutural (DI, config)       |
| `reads_from`    | DbProcessNode / FunctionNode | DatabaseNode                  | Leitura de DB                             |
| `writes_to`     | DbProcessNode / FunctionNode | DatabaseNode                  | Escrita em DB                             |
| `publishes_to`  | ServiceNode                  | BrokerNode                    | Serviço publica em tópico                 |
| `consumes_from` | BrokerNode                   | ServiceNode                   | Serviço consome tópico                    |
| `returns`       | FunctionNode                 | ReturnNode                    | Caminho de retorno                        |
| `throws`        | FunctionNode                 | ThrowNode                     | Caminho de erro                           |
| `catches`       | FlowControlNode (catch)      | ThrowNode                     | Captura de exceção                        |
| `logs`          | FunctionNode                 | LogNode                       | Chamada de log                            |
| `traces`        | FunctionNode                 | TelemetryNode                 | Instrumentação de trace                   |
| `emits`         | FunctionNode / ServiceNode   | EventNode                     | Emissão de evento interno                 |
| `listens`       | FunctionNode                 | EventNode                     | Consumo de evento interno                 |
| `resolves_to`   | FunctionNode / EndpointNode  | EndpointNode                  | ExternalCall resolvida para endpoint real |
| `renders`       | ServiceNode                  | ScreenNode                    | Serviço renderiza/serve a tela            |
| `navigates_to`  | ScreenNode                   | ScreenNode                    | Navegação entre telas                     |
| `fetches_from`  | ComponentNode                | EndpointNode                  | Componente chama endpoint                 |
| `triggers`      | FrontendEventNode            | FrontendEventNode / EventNode | Evento dispara outro                      |

**Regras gerais de edges:**

- `source` e `target` devem ser IDs de nós existentes na topologia.
- `source ≠ target` (sem self-loops).
- Edges duplicados (mesmo `source + target + kind`) são eliminados na deduplicação.
- Todo edge que sai de um `FlowControlNode` deve carregar `metadata.condition` com a condição que originou aquele caminho.
- Edges `publishes_to` e `consumes_from` devem carregar `metadata.topic` com o nome do tópico.
- Edges `reads_from` / `writes_to` devem carregar `metadata.operation` e `metadata.table`.
- Edges `resolves_to` devem carregar `metadata.confidence` e `metadata.reason`.
- Edges `depends_on` de serviço→serviço devem ter `metadata.kind` (`"sync"|"async"|...`) e `metadata.protocol`.

---

## 5. Validação de Fluxo de Endpoint

O fluxo de um endpoint é o conjunto ordenado de `children` (recursivamente) do `EndpointNode`.

### 5.1 Regra de Término

> Todo endpoint deve terminar seu fluxo com um `ReturnNode` ou `ThrowNode`.

- Percorrer `children` recursivamente (respeitando `FlowControlNode.branches`).
- Cada "folha" do grafo de fluxo (nó sem children relevantes) deve ser `ReturnNode` ou `ThrowNode`.
- `FlowControlNode (kind: "if")` com dois branches: cada branch deve terminar em `return` ou `throw`.
- `FlowControlNode (kind: "try")`: o bloco `try` pode não terminar em return se o `catch` terminar; ao menos um dos dois deve terminar.

### 5.2 Cobertura de Branches

- `if` sem `else` → pode ter caminho de "fall-through" que continua para o próximo nó (não é erro, mas gera aviso se não houver retorno no caminho principal).
- `switch` sem `default` → aviso se a função retorna algo: pode haver caminho não coberto.

### 5.3 Consistência de Parâmetros

- `EndpointNode.metadata.request.params` → devem existir `DataNode (kind: "parameter")` com esses nomes em `children` ou nos `params` do `FunctionNode` handler.
- Se um `ExternalCallNode` aponta para este endpoint, os `bodyFields` do caller devem ser compatíveis com `request.body` do endpoint.

### 5.4 Consistência de Respostas

- `EndpointNode.metadata.responses` deve ser derivado dos `ReturnNode` e `ThrowNode` em `children`:
  - `ReturnNode` com `httpStatus` → `EndpointResponse { httpStatus, source: "return", nodeId }`
  - `ThrowNode` com `httpStatus` → `EndpointResponse { httpStatus, source: "throw", nodeId }`
- Respostas sem `httpStatus` no nó → inferir pelo tipo de resposta (200 para GET bem-sucedido, 201 para POST, etc.).

### 5.5 Validação de Coerência (Score LLM)

A LLM de refinamento recebe o fluxo serializado dos `children` de um endpoint e produz:

```json
{
  "understandabilityScore": 0.0–1.0,
  "endpointName": "string",
  "endpointDescription": "string (4 parágrafos)",
  "functionDescriptions": { "fnId": "nome + descrição", ... }
}
```

- Se `understandabilityScore < 0.85` → usar estratégia de prompt alternativa (mais contexto, menos compressão).
- `endpointDescription` segue a estrutura: **parágrafo 1** = síntese; **parágrafo 2** = o que recebe; **parágrafo 3** = o que faz e chama; **parágrafo 4** = o que devolve e sob quais condições.

---

## 6. Regras de Display

### 6.1 Containers

- Cada `FunctionNode` e `EndpointNode` gera um **container** visual que engloba seus `children`.
- O container se expande automaticamente quando um filho é movido para próximo da borda.
- Um nó contido não pode ser arrastado para fora do container sem que o container também se expanda.
- Containers podem ser aninhados (função dentro de endpoint, função dentro de função).
- O border do container deve ser visualmente distinto do card do nó pai.

### 6.2 Nós

**Posicionamento:**

- Distância mínima entre nós: garantida por força de repulsão (layout de força dirigida).
- Nós filhos devem estar sempre dentro do container de seu pai.
- Nós não podem se sobrepor (ocupar a mesma posição).

**Card:**

- Tamanho do card deve acomodar o conteúdo sem overflow — se o conteúdo exceder, usar truncamento + tooltip/expand.
- Nós com `children` → exibem contador de filhos quando collapsed.

**Tipos e cores de card sugeridas (nós de código — Endpoint Flow View):**

| Tipo            | Cor base         | Destaque                                                                   |
|-----------------|------------------|----------------------------------------------------------------------------|
| `endpoint`      | Azul             | Badge de método: GET=verde, POST=amarelo, DELETE=vermelho, PUT=laranja, PATCH=roxo |
| `function`      | Cinza escuro     | `name`, `params`, `returnType`                                             |
| `flowControl`   | Azul acinzentado | Label do `kind` (if/switch/for/try/…) + `condition`                        |
| `return`        | Verde            | `httpStatus` (se response), `valueType`                                    |
| `throw`         | Vermelho         | `errorClass`, `httpStatus` se mapeado                                      |
| `dbProcess`     | Azul marinho     | `operation` + nome da tabela                                               |
| `externalCall`  | Roxo             | `method + path`, badge de `mergeStatus`                                    |
| `event`         | Amarelo          | `kind` (emit/subscribe/…) + `eventName`                                    |
| `call`          | Cinza claro      | `callee` (truncado)                                                        |
| `data`          | Neutro/bege      | `kind` + `dataType`                                                        |
| `log`           | Cinza esverdeado | `level` colorido (debug=cinza, info=azul, warn=amarelo, error=vermelho)    |
| `telemetry`     | Teal             | `kind` (span/metric/trace)                                                 |
| `process`       | Cinza médio      | `kind` (transformation/validation/…)                                       |

### 6.3 Edges

**Roteamento:**

- Edges **não podem cruzar nós** (roteamento ortogonal ou curvilíneo evitando overlaps).
- Edges com **mesmo nó de origem** podem seguir o mesmo caminho até o ponto de bifurcação.
- Edges de origens diferentes **nunca** seguem o mesmo caminho visual — são traçados separadamente mesmo que apontem para o mesmo destino.
- Arestas de `FlowControlNode` devem exibir `metadata.condition` como label flutuante.

**Estilos sugeridos:**

| `kind`           | Estilo                     | Curvatura                    |
|------------------|----------------------------|------------------------------|
| `calls`          | Sólido, seta               | Reta (fluxo direto)          |
| `reads_from`     | Tracejado azul             | Curva ( ← ) — arco à esquerda |
| `writes_to`      | Sólido azul                | Curva ( → ) — arco à direita  |
| `returns`        | Verde, seta                | Reta                         |
| `throws`         | Vermelho, seta             | Reta                         |
| `publishes_to`   | Amarelo, seta              | Reta                         |
| `consumes_from`  | Amarelo, tracejado         | Reta                         |
| `depends_on`     | Cinza, tracejado           | Reta                         |
| `resolves_to`    | Roxo, seta                 | Reta                         |
| `navigates_to`   | Azul claro                 | Reta                         |
| `fetches_from`   | Roxo tracejado             | Reta                         |

**Curvatura de edges DB (reads_from / writes_to):**
Quando um mesmo serviço tem **ambos** `reads_from` e `writes_to` para o mesmo banco, os dois edges são desenhados como arcos curvos opostos — um abrindo para a esquerda `( ←` e outro para a direita `→ )` — evitando sobreposição e deixando visualmente clara a bidirecionalidade. O label de cada arco exibe as operações agrupadas (ex: `findMany, findUnique` no arco de leitura; `save, delete` no arco de escrita).

### 6.4 View de Ecossistema (Ecosystem View)

Escopo: todos os `ServiceNode`, `DatabaseNode`, `BrokerNode` e edges entre eles.

**O que aparece:**
- Todo `ServiceNode` → círculo com `code` no centro, cor por `kind`.
- `DatabaseNode` e `BrokerNode` → nós com forma distinta (ex: cilindro para DB, hexágono para broker).
- Serviço frontend (`kind: "frontend" | "mobile"`) aparece **apenas como círculo** — as `ScreenNode[]` internas **não aparecem aqui**.
- Edges visíveis: `depends_on`, `reads_from`, `writes_to`, `publishes_to`, `consumes_from`, `resolves_to`.

**Layout:**
- Hierarquia: serviços que dependem de outro ficam mais externos que o dependido.
- **Polo esquerdo:** serviços com clientes web (`"frontend"`, `"bff"`).
- **Polo direito:** serviços com clientes mobile (`"mobile"`).
- **Zona central de transição:** serviços com ambos os tipos de cliente.
- **Databases** mais ao centro; workers/crons nas bordas.
- Posição **determinística** — mesmo grafo → mesma posição inicial.

**Interação:**
- Click em `ServiceNode` → painel lateral com `code`, `name`, `repository.url`, `team`, `repository.branch`, data de extração, e botão que abre a view de Sistema daquele serviço.
- Click em `DatabaseNode` → tabelas e conexões.
- Click em edge → `kind` + `metadata` (operações, tópico, confiança, etc.).

---

### 6.5 View de Sistema (System View)

Escopo: um único `ServiceNode` aberto. O conteúdo varia pelo `kind`:

**Se backend (`"backend"` | `"bff"` | `"gateway"` | `"worker"` | `"cron"`):**
- Mostra `endpoints[]` como nós, com informações resumidas (method + path).
- Mostra `dependencies[]` do serviço (databases, brokers, outros serviços) como nós periféricos.
- Edges: `calls`, `reads_from`, `writes_to`, `publishes_to`, `consumes_from`, `depends_on`.
- Click em endpoint → abre a View de Detalhe (Endpoint Flow View).

**Se frontend (`"frontend"` | `"mobile"` | `"microfrontend"`):**
- Mostra apenas as `ScreenNode[]` do serviço como nós.
- Edges `navigates_to` entre as telas (curvos quando bidirecional).
- Edges `fetches_from` de telas para `EndpointNode[]` de outros serviços (dependências externas).
- Telas de entrada (sem telas apontando para elas) à esquerda; telas de saída à direita.
- Click em `ScreenNode` → abre a View de Detalhe (Screen Detail View).

**Se monolith (`"monolith"`):**
- Mostra endpoints **e** screens lado a lado, com separação visual.
- Edges `calls` entre endpoints e screens quando houver (SSR, navegação server-side).

---

### 6.6 View de Detalhe — Endpoint (Endpoint Flow View)

Escopo: um único `EndpointNode` e seus `children` (fluxo de código).

**Layout:** hierárquico top→bottom, respeitando a ordem de linhas do código-fonte.

**Elementos:**
- `FunctionNode` e `FlowControlNode` geram containers visuais aninhados com bordas distintas.
- Nós folha (`CallNode`, `DbProcessNode`, `ReturnNode`, `ThrowNode`, `LogNode`, etc.) são cards dentro dos containers.
- Nós não podem se sobrepor; distância mínima entre eles.

**Interação:**
- Hover em `ReturnNode` ou `ThrowNode` → ilumina o caminho completo de edges que levou até ele.
- Painel lateral: descrição LLM, request (params, body, headers), responses (status + body + condição).

---

### 6.7 View de Detalhe — Screen (Screen Detail View)

Escopo: uma única `ScreenNode` e seus `components[]`.

**Layout:** representa a estrutura visual da tela de forma esquemática (não um wireframe real).

```
[ ScreenNode: "ProductDetail" ]
  ┌─────────────────────────────────────────┐
  │  ComponentNode (kind: "page_component") │
  │    ├── ComponentNode (kind: "button")   │
  │    │     └── FrontendEventNode: click   │
  │    │           ├── api_call ────────────┼──→ [ EndpointNode: POST /cart ]
  │    │           └── navigate ────────────┼──→ [ ScreenNode: "Cart" ]
  │    └── ComponentNode (kind: "form")     │
  │          └── FrontendEventNode: submit  │
  │                └── api_call ────────────┼──→ [ EndpointNode: POST /checkout ]
  └─────────────────────────────────────────┘
```

**Elementos:**
- `ComponentNode` de nível de tela → container visual.
- `ComponentNode` filho (button, input) → card dentro do container pai.
- `FrontendEventNode` → card dentro do componente que o origina.
- Edges `api_call` → setas que saem da view e apontam para o `EndpointNode` destino (pode ser em outro serviço).
- Edges `navigate` → setas que apontam para outra `ScreenNode` (pode estar na mesma view de sistema).

**Interação:**
- Hover em `FrontendEventNode` → destaca os edges de suas actions.
- Click em endpoint destino → navega para a View de Detalhe do endpoint correspondente.
- Click em screen destino → navega para a Screen Detail View da tela destino.

---

## 7. Divergências

As seguintes divergências foram identificadas entre o rascunho original e o código. **Você deve decidir o que está correto.**

---

### 7.0 ServiceNode.code — Sigla vs Kebab-case

**Rascunho/spec atual:** `code` é sigla em maiúsculas (ex: `"XEA"`, `"OS"`).

**Código atual:** `service.builder.ts` gera `code = toKebabCase(name)` → `"order-service"`.

**Decisão necessária:** Alterar o builder para gerar sigla automática (iniciais das palavras) com fallback de configuração manual via `tree.config.json`. Até isso ser implementado, `code` continua sendo kebab-case.

---

### 7.1 Nome do Endpoint

**Rascunho:** "Todo endpoint deve ter um nome que seja a junção de seu método + path"

**Código:** `EndpointNode.name` é `"ClassName.methodName"` (extraído do parser). O método HTTP e o path ficam em `metadata.method` e `metadata.path`.

**Impacto:** O display já usa `method + path` como título; o campo `name` é um identificador interno. Se quiser que `name` seja `"GET /users/:id"`, seria necessário alterar todos os extractors de endpoint.

**Decisão tomada:** Manter `name = "ClassName.method"` como identificador interno e usar `method + " " + path` apenas no display.

---

### 7.2 ReturnNode — Distinção de Erro

**Rascunho:** "Devem possuir um kind que diferencie erro de return de um resultado"

**Código:** O erro é representado por `ThrowNode` (tipo separado), não por um `kind` dentro de `ReturnNode`. `ReturnNode.kind` é `"explicit" | "implicit" | "response"` — nenhum representa erro.

**Impacto:** A distinção já existe, mas via tipos diferentes (`return` vs `throw`), não via `kind` dentro do mesmo tipo.

**Sugestão:** Manter a separação `ReturnNode` / `ThrowNode`. No display, `ThrowNode` = vermelho, `ReturnNode` = verde. Não adicionar `kind: "error"` ao `ReturnNode`.

---

### 7.3 EventNode — Sem Children

**Rascunho:** "Um event não tem chield"

**Código:** `EventNode` extends `BaseCodeNode` que tem `children: CodeNode[]`. O campo existe, mas na prática os extractors não populam `children` de `EventNode`.

**Impacto:** A regra está correta como intenção, mas não é enforced pelo tipo. Um validador pode checar `eventNode.children.length === 0`.

---

### 7.4 Worker Services e Monolito

**Rascunho:** "Todo serviço deve possuir um endpoint (backend), screen (front)" — não cobre workers nem monolitos.

**Código:** `ServiceNode.metadata.kind` tem `"worker"` e `"cron"` explicitamente. `"monolith"` não existe ainda no union type — precisa ser adicionado.

**Decisão tomada:**
- Workers (`kind: "worker"`) → isentos de endpoint; devem ter edge `consumes_from`.
- Monolito (`kind: "monolith"`) → único `ServiceNode`; pode ter `endpoints[]` + `ScreenNode[]` associados via `renders`. Lógica interna (services, repositories) são apenas `FunctionNode[]` e `DataNode[]` — não há `ServiceNode` dentro de `ServiceNode`.
- Adicionar `"monolith"` ao union type de `ServiceNode.metadata.kind` no `topology.ts`.

---

### 7.5 Nós Ausentes no Rascunho

Os seguintes tipos de nó existem no código mas não foram mencionados no rascunho:

| Tipo           | Descrição                                      |
| -------------- | ---------------------------------------------- |
| `externalCall` | Chamadas HTTP outbound para outros serviços    |
| `dbProcess`    | Operações de banco de dados                    |
| `log`          | Chamadas de logging estruturado                |
| `telemetry`    | Instrumentação de trace/metric (OpenTelemetry) |
| `process`      | Transformações/computações intermediárias      |
| `throw`        | Lançamento de exceção (distinto de `return`)   |

---

### 7.6 Edge — Condição no Display

**Rascunho:** "Tem sempre no display a condição que levou ao fluxo caso saia de controle de fluxo"

**Código:** `Edge.metadata` é `Record<string, unknown>` — `condition` não é um campo tipado. Os edges de `FlowControlNode` podem ter `metadata.condition`, mas isso não é enforced.

**Sugestão:** Adicionar à especificação de validação: edges com `source` sendo `FlowControlNode` devem ter `metadata.condition` preenchido. Implementar check no validador.

---

### 7.7 Posição Inicial dos Nós

**Rascunho:** "Não importa quantas vezes seja renderizado, a posição inicial dos nós sempre será a mesma"

**Código:** Não há código de layout no `packages/core`. Isso é responsabilidade do app web (Gaia). O `tree-cli` apenas gera a topologia JSON.

**Sugestão:** Documentar como regra do Gaia, não do `tree-cli`. O JSON não armazena posições — o layout é computado deterministicamente no frontend baseado na estrutura da topologia (mesmo grafo → mesmo seed → mesma posição).

---

### 7.8 Screen — Mobile vs Web

**Rascunho:** "Screen (mobile)" tratado separadamente de telas web.

**Código:** `ScreenNode` é o mesmo tipo para web e mobile. A distinção é feita por `metadata.framework` (`"react-native"`, `"flutter"` = mobile; `"react"`, `"vue"` = web).

**Sugestão:** Manter tipo único `ScreenNode`. No display/validação, diferenciar por `framework`. Regras exclusivas de mobile (ex: "leva para fora do app") devem verificar `framework ∈ {react-native, flutter, swift-ui, jetpack-compose}`.

---

_Última atualização: 2026-04-22_
