# Plano de Teste Prático: ShopSystem

Documento de planejamento para construção e validação de um ecossistema de teste
multi-linguagem que exercita todos os tipos de nós, todas as linguagens suportadas
e a capacidade de merge de topologias entre serviços interdependentes.

---

## Contexto

Os testes de extração existentes (`tests/unit/extractors/node-types.test.ts`) validam
que cada linguagem detecta seus tipos de nó de forma isolada. Falta um teste de
**cenário real**: serviços que se comunicam entre si via HTTP e Kafka, que compartilham
banco de dados, e que são analisados em conjunto para produzir uma topologia unificada.

Este plano define esse ecossistema, as etapas de extração e os critérios de aceite.

---

## 1. Arquitetura: ShopSystem

Um e-commerce simplificado com quatro serviços em linguagens diferentes, dependências
HTTP síncronas e Kafka assíncronas, e banco PostgreSQL compartilhado.

```
┌──────────────────────────────────────────────────────────┐
│                   api-gateway (TypeScript/NestJS)         │
│   • recebe requests externos                              │
│   • roteia para user-service e order-service via HTTP     │
│   • instrumentação OpenTelemetry (spans + metrics)        │
└─────────────────┬────────────────────┬────────────────────┘
                  │ HTTP               │ HTTP
                  ▼                    ▼
   ┌──────────────────────┐  ┌─────────────────────────────┐
   │  user-service        │  │  order-service              │
   │  (Go / Gin)          │  │  (Java / Spring Boot)       │
   │                      │  │                             │
   │  • CRUD de usuários  │  │  • cria e gerencia pedidos  │
   │  • GORM + Postgres   │  │  • chama user-service HTTP  │
   │  • publica user.*    │  │  • JPA + Postgres           │
   │    via Kafka         │  │  • consome user.* (Kafka)   │
   └──────────┬───────────┘  │  • publica order.* (Kafka)  │
              │               └──────────────┬──────────────┘
              │ Kafka                         │ Kafka
              │ user.created                  │ order.placed
              │ user.deleted                  │ order.shipped
              └──────────────┬────────────────┘
                             ▼
              ┌──────────────────────────────┐
              │  notification-service        │
              │  (Python / FastAPI)          │
              │                             │
              │  • consome eventos Kafka     │
              │  • envia e-mails (mock)      │
              │  • SQLAlchemy (audit log)    │
              └──────────────────────────────┘
```

### Infraestrutura compartilhada

| Recurso | Tipo | Usado por |
|---|---|---|
| PostgreSQL | banco relacional | user-service, order-service, notification-service |
| Kafka | broker de mensagens | user-service (producer), order-service (producer + consumer), notification-service (consumer) |

---

## 2. Serviços em Detalhe

### 2.1 user-service — Go / Gin

**Responsabilidade:** CRUD completo de usuários.

**Endpoints:**
- `GET    /users`          — lista todos os usuários
- `POST   /users`          — cria usuário, publica `user.created`
- `GET    /users/:id`      — busca por ID
- `PUT    /users/:id`      — atualiza usuário, publica `user.updated`
- `DELETE /users/:id`      — remove usuário, publica `user.deleted`

**Tipos de nó cobertos:**

| Nó | Como aparece |
|---|---|
| `endpoint` | `router.GET("/users", handler)` etc |
| `function` | métodos no struct `App` |
| `dbProcess` | `db.Find`, `db.Create`, `db.Updates`, `db.Delete` (GORM) |
| `event` | `writer.WriteMessages` (kafka-go) |
| `log` | `logrus.Info`, `logrus.Error`, `logrus.Warn` |
| `flowControl` | `if err != nil`, `for`, `switch` |
| `return` | `return` em handlers |
| `throw` | `panic("mensagem")` em casos críticos |
| `call` | chamadas entre funções/métodos |

**Dependências externas:** PostgreSQL (GORM), Kafka (kafka-go).

---

### 2.2 order-service — Java / Spring Boot

**Responsabilidade:** criação e gestão de pedidos. Consulta usuários via HTTP.

**Endpoints:**
- `GET    /orders`          — lista pedidos
- `POST   /orders`          — cria pedido, valida usuário, publica `order.placed`
- `GET    /orders/:id`      — busca pedido
- `PUT    /orders/:id`      — atualiza status, publica `order.shipped` se aplicável
- `DELETE /orders/:id`      — cancela pedido

**Eventos consumidos:** `user.created`, `user.deleted` (via `@KafkaListener`).

**Tipos de nó cobertos:**

| Nó | Como aparece |
|---|---|
| `endpoint` | `@GetMapping`, `@PostMapping` etc |
| `function` | métodos em `@RestController` e `@Service` |
| `dbProcess` | `orderRepository.findAll()`, `orderRepository.save()` etc (JPA) |
| `event` | `kafkaTemplate.send()` + `@KafkaListener` |
| `log` | `log.info`, `log.error`, `log.warn` (SLF4J) |
| `flowControl` | `if`, `switch`, `for`, `try-catch` |
| `return` | `return ResponseEntity.ok(...)` etc |
| `throw` | `throw new RuntimeException(...)` |
| `call` | chamada HTTP para user-service, chamadas internas |

**Dependências externas:** PostgreSQL (JPA/Hibernate), Kafka, user-service (HTTP).

---

### 2.3 notification-service — Python / FastAPI

**Responsabilidade:** consome eventos e envia notificações. Registra auditoria em banco.

**Endpoints:**
- `GET  /health`          — healthcheck
- `GET  /notifications`   — lista notificações enviadas (audit)

**Eventos consumidos:** `user.created`, `user.deleted`, `order.placed`, `order.shipped`.

**Tipos de nó cobertos:**

| Nó | Como aparece |
|---|---|
| `endpoint` | `@app.get`, `@app.post` (FastAPI) |
| `function` | funções de handler e tasks Celery |
| `dbProcess` | `db.query(Notification).all()`, `db.add(n)` (SQLAlchemy) |
| `event` | `consumer = KafkaConsumer(...)`, iteração de mensagens |
| `log` | `logger.info`, `logger.error`, `logger.warning` |
| `flowControl` | `if`, `for`, `try-except` |
| `return` | `return` em endpoints |
| `throw` | `raise HTTPException(...)` |
| `call` | chamadas entre funções internas |

**Dependências externas:** PostgreSQL (SQLAlchemy), Kafka (kafka-python).

---

### 2.4 api-gateway — TypeScript / NestJS

**Responsabilidade:** ponto de entrada externo. Roteia e instrumenta requests.

**Endpoints:**
- `GET    /api/users`            → proxy para user-service
- `POST   /api/users`            → proxy para user-service
- `GET    /api/users/:id`        → proxy para user-service
- `GET    /api/orders`           → proxy para order-service
- `POST   /api/orders`           → proxy para order-service

**Tipos de nó cobertos (inclui nós exclusivos de TypeScript):**

| Nó | Como aparece |
|---|---|
| `endpoint` | `@Get()`, `@Post()` (NestJS) |
| `function` | métodos de `@Controller` e `@Injectable` |
| `dbProcess` | Prisma `findMany`, `create` (audit local) |
| `event` | `this.emitter.emit(...)` (EventEmitter2) |
| `log` | `logger.info`, `logger.error` (winston) |
| `flowControl` | `if`, `for`, `try-catch` |
| `return` | `return` em handlers |
| `throw` | `throw new HttpException(...)` |
| `call` | `fetch`/`axios` para user-service e order-service |
| `telemetry` | `tracer.startSpan(...)`, `meter.createCounter(...)` (OpenTelemetry) |
| `data` | `interface`, `type`, `enum` (tipos de contrato) |

**Dependências externas:** user-service (HTTP), order-service (HTTP), Prisma/PostgreSQL.

---

## 3. Dependências Cruzadas a Validar (Edges)

Após o merge da topologia completa, os seguintes edges devem estar presentes:

| # | Origem | Destino | Tópico / Rota | Tipo |
|---|---|---|---|---|
| 1 | api-gateway | user-service | `GET /users` | HTTP sync |
| 2 | api-gateway | user-service | `POST /users` | HTTP sync |
| 3 | api-gateway | user-service | `GET /users/:id` | HTTP sync |
| 4 | api-gateway | order-service | `GET /orders` | HTTP sync |
| 5 | api-gateway | order-service | `POST /orders` | HTTP sync |
| 6 | order-service | user-service | `GET /users/:id` | HTTP sync |
| 7 | user-service | notification-service | `user.created` | Kafka async |
| 8 | user-service | notification-service | `user.deleted` | Kafka async |
| 9 | order-service | notification-service | `order.placed` | Kafka async |
| 10 | order-service | notification-service | `order.shipped` | Kafka async |
| 11 | user-service | PostgreSQL | schema `users` | DB |
| 12 | order-service | PostgreSQL | schema `orders` | DB |
| 13 | notification-service | PostgreSQL | schema `notifications` | DB |
| 14 | api-gateway | PostgreSQL | Prisma audit | DB |

---

## 4. Casos Especiais a Cobrir

Além dos nós básicos, os fixtures devem incluir os seguintes padrões para testar
comportamentos mais sutis do pipeline de extração:

| Cenário | Onde | O que testa |
|---|---|---|
| Consumer Kafka que faz escrita no banco ao processar evento | order-service | Aninhamento: `event` → `dbProcess` como filho |
| Função com múltiplos `return` em branches de `if` | user-service | Return aninhado dentro de `flowControl` |
| `panic` dentro de `if err != nil` | user-service | `throw` aninhado dentro de `flowControl` |
| `throw` dentro de `try-catch` | order-service | `throw` aninhado dentro de `flowControl` do tipo try |
| Span OpenTelemetry wrapping uma chamada HTTP | api-gateway | `telemetry` como irmão de `call` no mesmo `function` |
| Mesmo tópico Kafka produzido por dois serviços | — | Broker merge correto (sem duplicação de tópico) |
| Endpoint que chama outro endpoint do mesmo serviço | qualquer | `call` intra-serviço |
| Método de repositório chamado por múltiplos endpoints | order-service | Múltiplos pais referenciando o mesmo `dbProcess` |
| Interface TypeScript exportada usada em controller | api-gateway | `data` node com scope `export` |
| Goroutine (`go func()`) disparando evento | user-service | `call` com `metadata.goroutine = true` |

---

## 5. Estrutura de Diretórios

```
tests/fixtures/shop-system/
│
├── user-service/               ← Go / Gin
│   ├── go.mod
│   ├── main.go                 ← router, endpoints, main()
│   ├── handlers.go             ← handlers separados do router
│   ├── models.go               ← structs GORM (User)
│   └── events.go               ← producer Kafka
│
├── order-service/              ← Java / Spring Boot
│   ├── pom.xml
│   └── src/main/java/
│       ├── OrderController.java
│       ├── OrderService.java   ← lógica, chama user-service HTTP
│       ├── Order.java          ← @Entity JPA
│       └── OrderEvents.java    ← @KafkaListener + KafkaTemplate
│
├── notification-service/       ← Python / FastAPI
│   ├── requirements.txt
│   ├── main.py                 ← FastAPI app, endpoints
│   ├── models.py               ← SQLAlchemy models
│   └── consumer.py             ← Kafka consumer loop
│
└── api-gateway/                ← TypeScript / NestJS
    ├── package.json
    └── src/
        ├── app.module.ts
        ├── gateway.controller.ts   ← endpoints proxy
        ├── gateway.service.ts      ← fetch para outros serviços
        └── types.ts                ← interfaces de contrato
```

---

## 6. Etapas de Extração e Validação

### Etapa 1 — Extração individual (smoke test por serviço)

Para cada serviço em isolamento, rodar `analyzeRepository` e verificar:

- `services.length === 1`
- `diagnostics.errors === 0` (nenhum arquivo falhou no parser)
- Pelo menos 1 nó de cada tipo esperado para a linguagem (tabela da seção 2)
- Database detectado onde esperado (`databases.length >= 1`)
- Broker detectado onde esperado (`brokers.length >= 1`)
- Nenhum nó do tipo `call`/`log`/`dbProcess`/`event` aparece solto em `service.globals`
  (todos devem estar aninhados dentro de uma `function` ou `endpoint`)

**Critério de aceite:** 4/4 serviços extraem sem erro com todos os tipos de nó presentes.

---

### Etapa 2 — Merge topology (monorepo completo)

Rodar `analyzeRepository` apontando para `tests/fixtures/shop-system/` (raiz do monorepo).
O detector de boundaries deve identificar 4 serviços pelos seus manifestos (`go.mod`,
`pom.xml`, `requirements.txt`, `package.json`).

Verificar na topology resultante:

- `services.length === 4`
- `brokers.length === 1` (um broker Kafka com 4 tópicos)
- `brokers[0].metadata.topics` contém: `user.created`, `user.deleted`, `order.placed`, `order.shipped`
- `databases.length >= 1` (PostgreSQL detectado)
- Cada tópico tem producers e consumers corretos (`topic.producers`, `topic.consumers`)
- Nenhum ID duplicado no array de services + databases + brokers

**Critério de aceite:** topology unificada com 4 serviços, 1 broker Kafka com 4 tópicos, sem IDs duplicados.

---

### Etapa 3 — Validação dos edges

Para cada um dos 14 edges da tabela da seção 3, verificar em `topology.edges`:

- `edge.source` pertence ao serviço de origem esperado
- `edge.target` pertence ao serviço/recurso de destino esperado
- `edge.kind` correto: `'http'` para HTTP, `'event'` para Kafka, `'database'` para DB
- `edge.metadata.method` correto para edges HTTP (GET, POST, etc.)
- `edge.metadata.topic` correto para edges Kafka

Verificar também o que **não** deve existir:
- Nenhum edge de notification-service → user-service ou order-service (tráfego só vai em um sentido)
- Nenhum edge HTTP de notification-service para outros serviços

**Critério de aceite:** todos os 14 edges detectados, nenhum edge espúrio.

---

### Etapa 4 — Validação de profundidade (nesting)

Para cada serviço, percorrer recursivamente todos os `children` e verificar:

- Nós do tipo `dbProcess` aparecem apenas como filhos de `function` ou `endpoint`
- Nós do tipo `event` aparecem apenas como filhos de `function` ou `endpoint`
- Nós do tipo `log` aparecem apenas como filhos de `function` ou `endpoint`
- Nós do tipo `flowControl` podem ser filhos diretos de `function`/`endpoint` ou de outro `flowControl`
- Nós do tipo `throw` aparecem dentro de `flowControl` (não no topo de uma função)
- Nós do tipo `telemetry` (api-gateway) aparecem como filhos de `function`

Adicionalmente, para os casos especiais (seção 4):

- Em order-service: o `@KafkaListener` tem `dbProcess` como filho
- Em user-service: `if err != nil` tem `throw` como filho
- Em api-gateway: função com span tem `telemetry` + `call` como irmãos

**Critério de aceite:** 0 nós folha fora de container, hierarquia completa e correta.

---

### Etapa 5 — Cobertura de observabilidade

Verificar `topology.observability`:

- `logs` não vazio — contém entradas de pelos menos 3 dos 4 serviços
- `telemetry` não vazio — contém spans do api-gateway
- `coverage.endpointsTotal` ≥ 16 (soma dos endpoints de todos os serviços)
- `coverage.dbQueriesTotal` ≥ total de operações de DB declaradas nos fixtures
- `coverage.errorsTotal` ≥ total de panics/throws declarados nos fixtures
- `coverage.endpointsWithTracing` ≥ 1 (api-gateway tem spans)

**Critério de aceite:** coverage não-zero em todas as dimensões, telemetria do api-gateway detectada.

---

## 7. Ferramenta de Inspeção (debug)

Um script auxiliar `scripts/inspect-topology.ts` para uso manual durante o desenvolvimento
dos fixtures — não faz parte da suite de testes automatizados.

Imprime um resumo human-readable:

```
ShopSystem Topology
═══════════════════

Services (4)
  user-service      [go/gin]      endpoints:5  functions:8  dbProcess:9  events:5
  order-service     [java/spring] endpoints:5  functions:6  dbProcess:7  events:4
  notification-svc  [python/fast] endpoints:2  functions:5  dbProcess:4  events:4
  api-gateway       [ts/nest]     endpoints:5  functions:5  dbProcess:2  events:3

Databases (1)
  postgresql  [sql]  4 tables

Brokers (1)
  kafka  [stream]
    user.created   producers:[user-service]       consumers:[notification-svc, order-service]
    user.deleted   producers:[user-service]       consumers:[notification-svc]
    order.placed   producers:[order-service]      consumers:[notification-svc]
    order.shipped  producers:[order-service]      consumers:[notification-svc]

Edges (14)
  api-gateway → user-service      [http GET /users]
  api-gateway → user-service      [http POST /users]
  ...

Diagnostics: 0 errors, 0 warnings
```

---

## 8. Organização dos Testes

```
tests/
├── fixtures/
│   └── shop-system/         ← sistemas a construir (seção 5)
└── integration/
    └── shop-system/
        ├── user-service.test.ts        ← Etapa 1 (Go)
        ├── order-service.test.ts       ← Etapa 1 (Java)
        ├── notification-service.test.ts ← Etapa 1 (Python)
        ├── api-gateway.test.ts         ← Etapa 1 (TypeScript)
        └── topology.test.ts            ← Etapas 2, 3, 4 e 5 (monorepo completo)
```

Os testes de serviço individual (Etapa 1) são independentes entre si e podem rodar em
paralelo. O teste de topology (`topology.test.ts`) depende de todos os fixtures estarem
prontos e roda por último.

---

## 9. Ordem de Implementação Recomendada

```
1. Fixtures dos serviços
   a. user-service (Go)           — base mais simples, valida endpoints + GORM + Kafka
   b. notification-service (Py)   — consumer puro, valida recebimento de eventos
   c. order-service (Java)        — producer + consumer + HTTP call = mais complexo
   d. api-gateway (TS)            — todos os tipos TS-exclusivos (telemetry, data)

2. Testes individuais (Etapa 1)
   — um por serviço, junto com a fixture

3. Topology completa (Etapas 2–5)
   — após todos os 4 serviços e testes individuais verdes
```

A lógica de construir fixture + teste individual juntos permite detectar problemas
de extração antes de adicionar a complexidade do merge.
