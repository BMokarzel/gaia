# Plano de Testes — Extração Multi-linguagem

## Visão geral

Três camadas progressivas: **testes unitários** (fixtures sintéticos), **testes de integração** (projetos simples reais), **validação cruzada** (equivalência entre linguagens + frontend).

> **Nota sobre o estado atual do frontend:** `gaia-endpoint-v2.html` e `gaia-endpoint-demo.html` são **mockups 100% hardcoded** — os dados do `POST /checkout` estão baked-in no JavaScript (`PANEL_DATA`, `EXP`, `wl`). Não há nenhuma conexão com `topology.json`. A Camada 6 abaixo cobre primeiro o plano de integração e depois os testes dessa integração.

---

## Camada 1 — Fixtures Sintéticos (unit tests por extractor)

**Objetivo:** garantir que cada extractor produz exatamente os nós certos para o código mais simples possível.

### Infraestrutura a criar

- Adicionar `vitest` como devDependency (leve, sem config, roda `.ts` direto)
- Criar `tests/fixtures/<lang>/` com arquivos de código mínimos
- Criar `tests/unit/<lang>/<extractor>.test.ts` para cada extractor

### Fixtures por linguagem

| Linguagem | Fixtures |
|---|---|
| Go | `endpoint_gin.go` · `endpoint_chi.go` · `db_gorm.go` · `http_client.go` · `event_kafka.go` · `telemetry.go` |
| Java | `endpoint_spring.java` · `db_jpa.java` · `db_jdbc.java` · `event_kafka.java` · `telemetry.java` |
| Python | `endpoint_fastapi.py` · `endpoint_flask.py` · `db_sqlalchemy.py` · `event_celery.py` · `telemetry.py` |
| Kotlin | `endpoint_spring.kt` · `event_kafka.kt` · `telemetry.kt` |
| C# | `endpoint_aspnet.cs` · `db_ef.cs` · `telemetry.cs` |
| Rust | `endpoint_actix.rs` · `endpoint_axum.rs` · `function.rs` |
| TS/JS | coberto pela auto-análise do próprio repo |

### Padrão de teste

```typescript
// exemplo: tests/unit/go/gin-endpoint.test.ts
it('extrai endpoint GET /users do gin', () => {
  const root = parseGoCode(`r.GET("/users", listUsers)`)
  const endpoints = extractGinEndpoints(root, 'routes.go')
  expect(endpoints).toHaveLength(1)
  expect(endpoints[0].metadata.method).toBe('GET')
  expect(endpoints[0].metadata.path).toBe('/users')
  expect(endpoints[0].name).toBe('listUsers')
})
```

### Assertions padrão por tipo de nó

| Nó | Campos obrigatórios a validar |
|---|---|
| `EndpointNode` | `method`, `path`, `framework`, `request.params` |
| `FunctionNode` | `kind`, `async`, `visibility`, `params` |
| `DbProcessNode` | `operation`, `orm`, `tableId` |
| `CallNode` | `callee`, `awaited`, `chained` |
| `EventNode` | `kind` (publish/subscribe), `eventName`, `channel` |
| `TelemetryNode` | `kind`, `sdk`, `instrumentation`, `carriesContext` |
| `DataNode` | `kind` (class/interface/enum), `mutable`, `scope`, `fields` |
| `LogNode` | `level`, `message`, `hasStructuredData` |

---

## Camada 2 — Projetos Simples Reais (integração)

**Objetivo:** rodar `analyze` end-to-end em projetos pequenos e verificar que o `topology.json` resultante está bem formado e completo.

### Projetos a usar

| Linguagem | Projeto | Por quê |
|---|---|---|
| Go | `chi/examples/rest-api` | Pequeno, REST puro, sem deps extras |
| Go | `gin-gonic/examples/basic` | Framework diferente, mesma validação |
| Java | `spring-projects/spring-petclinic` | Clássico, Spring MVC + JPA |
| Python | `tiangolo/full-stack-fastapi-template` | FastAPI + SQLAlchemy |
| Python | `django/djangoproject.com` (backend) | Django ORM + views |
| Kotlin | Qualquer Spring Boot Kotlin sample oficial | Kotlin + Spring |
| C# | `dotnet/aspnet-samples` minimal API | ASP.NET mínimo |
| Rust | `tokio-rs/axum/examples/hello-world` | Mínimo possível |
| TS | Próprio repo GAIA | Auto-análise |

### Invariants de validação (criar `tests/integration/validate.ts`)

```typescript
function validateTopology(t: SystemTopology) {
  assert(t.services.length >= 1)

  // Todo endpoint tem fields obrigatórios
  for (const svc of t.services)
    for (const ep of svc.endpoints)
      assert(ep.metadata.method && ep.metadata.path && ep.metadata.framework)

  // Nenhum ID duplicado
  const ids = collectAllIds(t)
  assert(ids.size === countAllNodes(t))

  // Todo edge referencia IDs existentes
  for (const edge of t.edges)
    assert(ids.has(edge.sourceId) && ids.has(edge.targetId))

  // DatabaseNode tem tabelas se extraiu DbProcessNodes
  // BrokerNode tem topics se extraiu EventNodes
}
```

### Checklist por projeto analisado

- [ ] Parser não crashou (sem exceções não tratadas)
- [ ] `topology.json` é JSON válido
- [ ] `inspect` mostra contagens > 0 para endpoints e funções
- [ ] `--flat` gera `topology.flat.json` sem erros
- [ ] Nenhum diagnostic de nível `error`
- [ ] Tempo de análise < 30s

---

## Camada 3 — Equivalência Cross-Linguagem

**Objetivo:** a mesma API implementada em linguagens diferentes deve produzir topologias **semanticamente equivalentes**.

### API de referência a implementar (criar `tests/equivalence/userapi/`)

A mesma API simples em Go, Java, Python, Kotlin, C#, Rust:

```
GET    /users        → lista usuários
POST   /users        → cria usuário
GET    /users/:id    → busca por ID
DELETE /users/:id    → remove
```

Com:
- Model `User` (class/struct com campos id, name, email)
- Repository que executa SELECT/INSERT/DELETE
- Um cliente HTTP para chamar outro serviço downstream

### Métricas de equivalência

| Dimensão | Critério |
|---|---|
| Endpoints | Mesmas 4 rotas, mesmos métodos HTTP, mesmos path params |
| DataNode | `User` do tipo `class`/`struct` com mesmos campos |
| DbProcessNode | `findMany`, `findUnique`, `create`, `delete` extraídas |
| ExternalCallNode | Chamada para o serviço downstream presente |
| FunctionNode | 4 handlers extraídos |

### Script de comparação (`tests/equivalence/compare.ts`)

```typescript
const langs = ['go', 'java', 'python', 'kotlin', 'csharp', 'rust']
for (const lang of langs) {
  const t = loadTopology(`userapi-${lang}/topology.json`)
  const report = {
    endpoints: t.services[0].endpoints.length,               // esperado: 4
    methods: t.services[0].endpoints.map(e => e.metadata.method).sort(),
    dbOps: countDbProcessNodes(t),                            // esperado: >= 4
    httpClientCalls: countExternalCalls(t),                   // esperado: >= 1
    dataClasses: countDataNodesOfKind(t, 'class'),            // esperado: >= 1
  }
  printDiff(report, expectedReport)
}
```

---

## Camada 4 — Projetos Reais e Complexos

**Objetivo:** confirmar que o extractor aguenta volume e padrões do mundo real sem crashes ou topologias vazias.

### Projetos sugeridos

| Projeto | Linguagem | Por quê |
|---|---|---|
| `traefik/traefik` | Go | Codebase grande, routing complexo |
| `spring-projects/spring-boot` (samples) | Java | Multi-módulo, todos os patterns Spring |
| `encode/django-rest-framework` | Python | Django + DRF endpoints complexos |
| `tiangolo/fastapi` (source próprio) | Python | FastAPI com FastAPI |
| `dotnet/eShopOnContainers` | C# | Microserviços C# completo, múltiplos bounded contexts |

### Critério de sucesso

- Não crasha (nenhum `error` em `context.diagnostics`)
- Extrai > 50 endpoints no total (projetos grandes)
- Tempo de análise < 60s por projeto
- `topology.flat.json` importável no Neo4j sem nós órfãos

---

## Camada 5 — Frontend / Viewer

**Objetivo:** garantir que o HTML viewer renderiza corretamente topologias geradas por todas as linguagens.

### Topologias de teste para o viewer

1. **Mínima:** 1 serviço, 2 endpoints, 1 DB — valida render sem crash
2. **Média:** projeto petclinic — valida paginação e filtros
3. **Cross-service:** 2 serviços com edges entre eles — valida visualização de chamadas HTTP

### Checklist de validação manual

- [ ] `gaia-endpoint-v2.html` abre sem erros no console do browser
- [ ] Todos os endpoints aparecem com método e path corretos
- [ ] Filtro por linguagem/framework funciona
- [ ] Edges de DB aparecem ligados ao DatabaseNode correto
- [ ] Edges de HTTP client aparecem entre serviços
- [ ] `topology.flat.json` importado no Neo4j mostra grafo sem nós órfãos
- [ ] Sem regressão ao adicionar topologias de linguagens novas (Go/Java/Python)

---

---

## Camada 6 — Integração Front-Back

### Diagnóstico atual

O viewer atual (`gaia-endpoint-v2.html`) renderiza um grafo SVG hardcoded para um único endpoint `POST /checkout` fictício. Os dados estão todos definidos inline no JavaScript:

```
PANEL_DATA   → metadados de cada nó (título, badges, código-fonte)
EXP          → expansão de funções (filhos inline)
wl / drawX() → posição e estilo SVG de cada nó
```

O `topology.json` produzido pelo backend tem a seguinte forma:

```
SystemTopology
├── services[]
│   ├── endpoints[]         → EndpointNode (method, path, framework, children[])
│   ├── functions[]         → FunctionNode (kind, async, params, children[])
│   └── globals[]           → DataNode, LogNode, ...
├── databases[]             → DatabaseNode (engine, tables[])
├── brokers[]               → BrokerNode (engine, topics[])
└── edges[]                 → { from, to, kind, metadata }
```

**Gap:** o viewer não lê esse JSON. É preciso construir uma camada de adaptação.

---

### Plano de Implementação da Integração

#### Etapa 1 — Carregamento do topology.json

Adicionar ao HTML um mecanismo de entrada de dados:

```html
<!-- opção A: file picker -->
<input type="file" id="topology-file" accept=".json">

<!-- opção B: URL param (?file=./topology.json) -->
<!-- lido via: new URLSearchParams(location.search).get('file') -->
```

Fluxo:
1. Usuário abre `gaia-endpoint-v2.html?file=./topology.json` (ou usa o file picker)
2. `fetch(url)` ou `FileReader` carrega o JSON
3. Passa para o adaptador

#### Etapa 2 — Adaptador topology → viewer model

Criar `gaia-adapter.js` (pode ser inline no HTML):

```javascript
// Converte SystemTopology para o modelo interno do viewer
function adaptTopology(topology) {
  return {
    services: topology.services.map(svc => ({
      id: svc.id,
      name: svc.name,
      endpoints: svc.endpoints.map(adaptEndpoint),
    })),
    databases: topology.databases,
    brokers: topology.brokers,
    edges: topology.edges,
  };
}

function adaptEndpoint(ep) {
  return {
    id: ep.id,
    label: `${ep.metadata.method} ${ep.metadata.path}`,
    method: ep.metadata.method,
    path: ep.metadata.path,
    framework: ep.metadata.framework,
    // Converte children[] para o modelo de nós do renderer
    flow: ep.children.map(adaptCodeNode),
  };
}

function adaptCodeNode(node) {
  switch (node.type) {
    case 'call':       return { type: 'call',    label: node.metadata.callee, sub: node.metadata.awaited ? 'async' : 'sync' };
    case 'dbProcess':  return { type: 'db',      label: node.name, sub: `${node.metadata.orm} · ${node.metadata.operation}` };
    case 'externalCall': return { type: 'http',  label: `${node.metadata.method} ${node.metadata.path}`, sub: node.metadata.httpClient };
    case 'event':      return { type: 'event',   label: node.name, sub: `${node.metadata.kind} · ${node.metadata.channel}` };
    case 'flowControl':return { type: 'diamond', label: node.name };
    case 'log':        return { type: 'proc',    label: node.name };
    case 'return':     return { type: 'ret',     label: node.metadata?.value ?? 'return' };
    case 'throw':      return { type: 'throw_node', label: node.metadata?.errorClass ?? 'throw' };
    default:           return { type: 'proc',    label: node.name };
  }
}
```

#### Etapa 3 — Navegação entre endpoints

Substituir o grafo estático por uma lista navegável:

```
[ Sidebar de endpoints ]    [ Canvas SVG com o fluxo do endpoint selecionado ]

  POST /checkout  ←selecionado
  GET  /orders
  GET  /orders/:id
  DELETE /orders/:id
```

Ao clicar num endpoint, `render(endpoint.flow)` redesenha o canvas com os nós daquele endpoint.

Implementação mínima:
```javascript
function renderEndpointList(services) {
  const list = document.getElementById('endpoint-list');
  for (const svc of services) {
    for (const ep of svc.endpoints) {
      const item = document.createElement('div');
      item.textContent = ep.label;
      item.onclick = () => renderFlow(ep.flow);
      list.appendChild(item);
    }
  }
}
```

#### Etapa 4 — PANEL_DATA dinâmico

Substituir o `PANEL_DATA` hardcoded por uma função que extrai do nó original:

```javascript
function buildPanelData(node) {
  return {
    title: node.name,
    sub: `${node.type} · ${node.location?.file ?? ''}:${node.location?.line ?? ''}`,
    badges: buildBadges(node),
    rows: buildRows(node),
    src: node.raw ?? null,
  };
}

function buildBadges(node) {
  const badges = [];
  if (node.type === 'endpoint') badges.push(node.metadata.method, node.metadata.framework);
  if (node.type === 'function' && node.metadata.async) badges.push('async');
  if (node.type === 'dbProcess') badges.push(node.metadata.operation, node.metadata.orm);
  if (node.type === 'event') badges.push(node.metadata.kind, node.metadata.channel);
  return badges;
}
```

#### Etapa 5 — Cross-service edges

Exibir chamadas HTTP entre serviços como setas entre cards:

```javascript
// Para cada ExternalCallNode que tem resolvedEndpointId,
// desenhar uma aresta "saindo" do serviço atual para o endpoint resolvido
function drawCrossServiceEdges(edges, serviceId) {
  return edges.filter(e =>
    e.kind === 'calls' &&
    e.metadata?.sourceService === serviceId &&
    e.metadata?.targetService !== serviceId
  );
}
```

---

### Testes da Integração Front-Back

#### Nível 1 — Testes de unidade do adaptador (vitest)

```typescript
// tests/unit/adapter.test.ts
import { adaptEndpoint } from '../../viewer/gaia-adapter'

it('adapta EndpointNode para flow renderizável', () => {
  const ep = {
    id: 'ep:1', type: 'endpoint', name: 'listUsers',
    metadata: { method: 'GET', path: '/users', framework: 'gin' },
    children: [
      { type: 'dbProcess', name: 'users.findMany', metadata: { operation: 'findMany', orm: 'gorm' } },
      { type: 'return', name: 'return users', metadata: { value: '[]User' } },
    ]
  }
  const result = adaptEndpoint(ep)
  expect(result.method).toBe('GET')
  expect(result.flow).toHaveLength(2)
  expect(result.flow[0].type).toBe('db')
  expect(result.flow[1].type).toBe('ret')
})
```

Cobrir todos os tipos de nó: `call`, `dbProcess`, `externalCall`, `event`, `flowControl`, `log`, `return`, `throw`.

#### Nível 2 — Snapshot do DOM renderizado (vitest + happy-dom)

```typescript
// tests/unit/renderer-snapshot.test.ts
import { renderFlow } from '../../viewer/gaia-renderer'
import { loadTopology } from '../helpers'

it('renderiza flow do primeiro endpoint sem erros', () => {
  const topology = loadTopology('tests/fixtures/go/petclinic/topology.json')
  const ep = topology.services[0].endpoints[0]
  const svg = renderFlow(adaptEndpoint(ep))
  expect(svg.querySelectorAll('[data-nid]').length).toBeGreaterThan(0)
  expect(svg.querySelector('[data-nid="entry"]')).toBeTruthy()
})
```

#### Nível 3 — Testes E2E no browser (Playwright)

```typescript
// tests/e2e/viewer.spec.ts
import { test, expect } from '@playwright/test'

test('carrega topology.json e mostra endpoints', async ({ page }) => {
  await page.goto('file:///path/to/gaia-endpoint-v2.html?file=./topology.json')
  // Espera a lista de endpoints aparecer
  await expect(page.locator('[data-ep]')).toHaveCountGreaterThan(0)
})

test('clicar num endpoint renderiza o flow no canvas', async ({ page }) => {
  await page.goto('...')
  await page.locator('[data-ep]').first().click()
  await expect(page.locator('[data-nid="entry"]')).toBeVisible()
})

test('nó de DB mostra tooltip com operação e tabela', async ({ page }) => {
  // ...hover no nó db, verifica tooltip
  await page.locator('[data-nid]').filter({ hasText: 'findMany' }).hover()
  await expect(page.locator('.tip')).toBeVisible()
})

test('cross-service edge aparece para ExternalCallNode resolvido', async ({ page }) => {
  // carrega topologia com 2 serviços e edges entre eles
  // ...
})
```

#### Nível 4 — Checklist de regressão visual (manual)

Rodar para cada linguagem nova adicionada ao extractor:

| Checklist | Go | Java | Python | Kotlin | C# | Rust |
|---|---|---|---|---|---|---|
| Endpoints aparecem na sidebar | | | | | | |
| Fluxo do endpoint renderiza sem crash | | | | | | |
| DbProcessNode mostra orm e operação | | | | | | |
| ExternalCallNode aparece como bloco HTTP | | | | | | |
| EventNode aparece como bloco de evento | | | | | | |
| Panel lateral abre ao clicar (duplo clique) | | | | | | |
| Cross-service edge visível (se houver) | | | | | | |
| `topology.flat.json` importado no Neo4j sem nós órfãos | | | | | | |

---

### Ordem de execução atualizada

| Semana | Trabalho |
|---|---|
| 1 | Camada 1: infraestrutura vitest + fixtures + unit tests para Go e Java |
| 2 | Camada 1: Python, Kotlin, C#, Rust |
| 3 | Camada 2: projetos simples reais + validação do topology.json |
| 4 | **Camada 6 etapas 1–3:** carregamento do JSON + adaptador + navegação de endpoints |
| 5 | **Camada 6 etapas 4–5:** PANEL_DATA dinâmico + cross-service edges |
| 6 | Camada 3: equivalência cross-linguagem |
| 7 | Camadas 4 e 5: projetos complexos + testes E2E do viewer |



| Semana | Trabalho |
|---|---|
| 1 | Camada 1: infraestrutura vitest + fixtures + unit tests para Go e Java |
| 2 | Camada 1: Python, Kotlin, C#, Rust |
| 3 | Camada 2: projetos simples reais para todas as linguagens |
| 4 | Camada 3: criar UserAPI em 4+ linguagens + script de comparação |
| 5 | Camada 4: projetos complexos + Camada 5: frontend |

---

## Setup inicial (próximos passos concretos)

```bash
npm install -D vitest
# Adicionar "test": "vitest run" em package.json

mkdir -p tests/fixtures/go tests/fixtures/java tests/fixtures/python
mkdir -p tests/fixtures/kotlin tests/fixtures/csharp tests/fixtures/rust
mkdir -p tests/unit/go tests/unit/java tests/unit/python
mkdir -p tests/unit/kotlin tests/unit/csharp tests/unit/rust
mkdir -p tests/integration
mkdir -p tests/equivalence/userapi
```

Primeiro fixture a criar: `tests/fixtures/go/gin_endpoint.go`
Primeiro teste a criar: `tests/unit/go/gin-endpoint.test.ts`
