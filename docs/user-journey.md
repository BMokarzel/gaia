# Gaia — Jornada do Usuário

> Descreve como cada tela e botão deve responder. Derivado do ALIGNMENT.md.

---

## Ponto de partida: HomeView

O usuário abre o app e vê a tela inicial com 4 botões:

- **Extract** — sempre habilitado. Abre o ExtractModal.
- **Navigate** — **desabilitado** se o ecossistema ainda não tem nenhum serviço. Habilita após a primeira extração bem-sucedida. Navega para EcosystemView.
- **Config** e **Dashboard** — desabilitados (fora de escopo).

---

## Fluxo 1: Extraindo um repositório

### Etapa 1 — Formulário (ExtractModal)

O modal abre com dois campos:
- **Fonte:** radio `Local` (padrão) ou `Git`
- **Path:** campo de texto com o caminho do repositório

Botão **Iniciar extração** dispara `POST /topologies/analyze`.

---

### Etapa 2 — Progresso

O modal mostra uma barra de progresso e log de etapas em tempo real:

```
Extraindo auth-service...
████████████░░░░  67%
› Detectando stack tecnológica
› Extraindo endpoints (12/18)
› Analisando chamadas externas
```

---

### Etapa 3 — Decisões de merge (repete para cada pendente)

Se a extração detectou chamadas externas não resolvidas automaticamente, o modal exibe um painel por decisão:

```
Serviço chamador:  auth-service
Chamada:           POST /orders
Body:              { userId, items[], total }

Sugestão da IA:  order-service → POST /orders
Confiança: 91% — "Path e body fields coincidem"

Candidatos:
● order-service   POST /orders     91%
○ cart-service    POST /checkout   43%

[Aprovar sugestão]  [Escolher outro]  [Ignorar]
```

Comportamento dos botões:
- **Aprovar sugestão** → resolve com o candidato da LLM, avança para o próximo pendente
- **Escolher outro** → usuário seleciona manualmente um dos candidatos listados, então confirma
- **Ignorar** → marca a call como `unresolvable`, cria entrada em `provisional.json`, avança

> Se a LLM está certa (`certain: true`), a sugestão é destacada com mais ênfase. Se incerta, todos os candidatos aparecem com peso igual.

---

### Etapa 4 — Resumo final

Após todas as decisões:

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

- **Ver no ecossistema** → fecha modal, navega para EcosystemView
- **Ver este serviço** → fecha modal, navega para ServiceView do serviço recém-extraído

---

## Fluxo 2: Navegando pelo ecossistema

**Navigate** na HomeView → EcosystemView

A tela carrega `GET /ecosystem`. Todos os nós são **círculos**. Tamanho proporcional ao número de edges que chegam no nó. Nós `provisional` aparecem tracejados/opacos.

| Interação | O que acontece |
|---|---|
| **Single click** num nó | O nó clicado e os edges que **saem** dele ficam em destaque. O restante permanece sem dim. |
| **Click fora** de qualquer nó | Remove destaque, volta ao estado neutro. |
| **Double click** num nó | Abre painel de informações: nome, linguagem, framework, team, repoUrl, contagem de endpoints. |
| **Double click** num edge | Abre painel com informações da conexão. |
| **"Explorar serviço"** (no painel de info) | Navega para ServiceView do serviço. |

---

## Fluxo 3: Inspecionando um serviço

**ServiceView** — carrega `GET /topologies/{repoName}`

Layout: o serviço analisado fica num container central com seus endpoints como nós (círculos). Fora, à direita, ficam os recursos externos: bancos como nós soltos, outros serviços dentro dos seus próprios containers.

| Interação | O que acontece |
|---|---|
| **Single click** num endpoint | Destaca o endpoint e os edges que saem dele para recursos externos. Edges entre endpoints do mesmo serviço aparecem. |
| **Click fora** | Remove destaque. |
| **Double click** num endpoint | Painel: method, path, humanName, descrição LLM. |
| **Double click** num recurso externo | Painel de informações do recurso. |
| **"Ver fluxo"** (no painel do endpoint) | Navega para EndpointView. |

---

## Fluxo 4: Explorando o fluxo de um endpoint

**EndpointView** — sem novo request, usa a topologia já carregada. Topologias de serviços externos são carregadas sob demanda via `GET /topologies/{repoName}`.

O fluxo já aparece **completamente expandido** — funções internas como containers abertos, nós de controle de fluxo (`IF`, `switch`, `try/catch`) com seus ramos visíveis.

| Interação | O que acontece |
|---|---|
| **Single click** em qualquer nó/aresta | Destaca o elemento e seu caminho (ancestrais e descendentes diretos no fluxo). |
| **Double click** em qualquer nó/aresta | Painel de informações contextual ao tipo: endpoint (method, path, descrição), função (assinatura, params), db.find (operação, tabela, colunas), call externa (endpoint de destino). |
| **Click** num endpoint externo **colapsado** | Expande o endpoint externo dentro do container do serviço externo, revelando seu fluxo interno (containers de função, nós de db, calls externas). Expansão é infinitamente aninhável. |
| **Click** no mesmo nó **expandido** | Colapsa de volta. |
| **Click fora** | Remove destaque ativo. |

### Casos especiais no EndpointView

- **Endpoint provisório** (serviço ainda não extraído) → tracejado, não expansível. Double click abre painel com opção de iniciar extração.
- **Endpoint com merge pendente** → estilo de pendência. Double click abre o painel de decisão de merge.

---

## Navegação global — Breadcrumb

Visível em todas as telas exceto Home. Cada item é clicável:

```
Ecossistema  >  auth-service  >  POST /login
```

- **Ecossistema** → volta para EcosystemView
- **auth-service** → volta para ServiceView do serviço
- **POST /login** → tela atual (EndpointView)
- **Botão Home** (canto) → volta para HomeView, sai do modo de navegação
