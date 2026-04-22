# Plano de Correção — Gaia Web vs Alignment

> Auditoria feita em 2026-04-21. Compara o código de `apps/web` com `ALIGNMENT.md`.
> Ver também: `docs/user-journey.md` (jornada esperada).

---

## Divergências críticas — corrigidas

### 1. ServiceView — single click navegava, deveria highlight

**Antes:** `gn-click` em endpoint → `navigateToEndpoint(serviceId, nodeId)` diretamente.

**Depois (correto per §5.4):**
- Single click → `setNodeState(gNode, 'selected')` + outgoing edges visíveis + edges internas (endpoint→endpoint) aparecem
- Double click → painel de info com botão "Ver fluxo"
- "Ver fluxo" → `navigateToEndpoint(serviceId, endpointId)`
- Click no fundo → reset de highlights, deselect

**Arquivo:** `apps/web/src/views/ServiceView.tsx`

**Mudanças:**
- Import de `setNodeState` adicionado
- `endpointIds` set construído para classificar edges como internas ou externas
- Edges internas criadas com `opacity: 0` (ocultas por padrão)
- `resetHighlights()` função local — restaura opacidade e estado dos nós
- Handler `gn-click` reescrito: seleciona nó, atualiza estados, revela edges internas do nó selecionado
- `bgRect.click` → `resetHighlights()`
- Zoom/pan callback → `resetHighlights()`

---

### 2. HomeView — Navigate usava `goApp()` deprecated

**Antes:** `const handleNavigate = () => goApp()`

**Depois:** `const handleNavigate = () => navigateToEcosystem()`

**Arquivo:** `apps/web/src/views/HomeView.tsx`

---

## Já estava correto — sem mudança

| Componente | Status |
|---|---|
| EcosystemView — tamanho de nó por in-degree | ✓ `nodeRadius(inDegree, maxInDegree)` implementado |
| EcosystemView — nós `provisional` tracejados | ✓ `stroke-dasharray: '4 3'`, `fill-opacity: 0.3` |
| EcosystemView — single click: highlight + edges saindo | ✓ |
| EcosystemView — double click: painel de info | ✓ |
| EcosystemView — "Explorar →" navega para ServiceView | ✓ |
| ExtractModal — fluxo de 4 etapas | ✓ |
| ExtractModal — botão muda label (Aprovar/Confirmar) | ✓ |
| Breadcrumb clicável no TopBar | ✓ |
| Hierarquia Home → Ecosystem → Service → Endpoint | ✓ |

---

## Extras mantidos (não conflitam com o alignment)

| Feature | Motivo para manter |
|---|---|
| Theme toggle na HomeView | Melhoria de UX, não conflita |
| Clone policy toggle no ExtractModal (git) | Operacional, não conflita |
| LeftRail com navegação | Conveniência, não conflita |
| Keyboard shortcuts H/G/F/+/- | Conveniência, não conflita |
| Search (⌘K) placeholder | Desabilitado, não conflita |
| Density selector no EndpointView | Não mencionado no alignment, não conflita |

---

### 3. EndpointView — densidade padrão era 'short', deve ser 'expanded'

**Antes:** `localStorage.getItem('gaia-density') || 'short'`

**Depois:** `localStorage.getItem('gaia-density') || 'expanded'`

**Arquivo:** `apps/web/src/views/EndpointView.tsx`

**Motivo:** Spec §5.5: "O fluxo já aparece completamente expandido."

---

### 4. EndpointView — click fora não deselecionava

**Antes:** sem handler no `bgRect` do EndpointView.

**Depois:** `bgRect.addEventListener('click', () => selectNode(null))`

**Arquivo:** `apps/web/src/views/EndpointView.tsx`

**Motivo:** Spec: "Click fora → Remove destaque ativo."

---

## Fora de escopo — próximas versões

Conforme §9 do ALIGNMENT.md, não implementado e não planejado:

- Endpoints provisórios no EndpointView (double click → iniciar extração)
- Endpoints com merge pendente no EndpointView (double click → painel de decisão)
- ServiceView: containers de serviços externos com endpoints visíveis
- `certain: true` no merge UI (campo não existe no tipo `PendingMergeEntry` atual)
