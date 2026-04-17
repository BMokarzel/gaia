# Gaia — Visual Identity & UI/UX Design Guidelines
**Version 1.0 — April 2026**

---

## 1. Brand Identity

### 1.1 Name

**Recommended: Gaia**

Used alone or with a descriptor depending on context:
- Product name: **Gaia**
- Full brand phrase: "See your system as it truly is."
- Secondary tagline: "Living maps for living systems."

Subproducts/modules use the compound form:
| Module | Name |
|---|---|
| Core engine | Gaia Core |
| Graph visualization | Gaia Graph |
| Extractor CLI | Gaia Extract |
| Debugger | Gaia Debug |
| Docs sync | Gaia Docs |

Avoid "Nexus" — overused in dev tooling. "Gaia" alone is strong, memorable, and evokes life, interconnection, and living systems.

### 1.2 Logo Concept

**Symbol:** A circular node with three subtle orbital arcs — evoking both an atom and a network hub. The circle has a slight inner glow in fluorescent green. The arcs are thin, white at 30% opacity, not closed.

**Wordmark:** "GAIA" in Space Grotesk SemiBold, all caps, letter-spacing +0.08em. The "G" can optionally incorporate the orbital symbol.

**Logo variants:**
- Full: symbol + wordmark horizontal
- Compact: symbol only (icon/favicon contexts)
- Inverted: white on dark (primary use)
- Monochrome: single-color for embeds

---

## 2. Color System

### 2.1 Palette Philosophy

Three signal colors on a near-black ground. Each color has a semantic meaning — never use them decoratively against their semantic intent.

| Role | Name | Hex | Usage |
|---|---|---|---|
| Life / Active | **Gaia Green** | `#39FF6E` | Active nodes, live connections, healthy status, primary CTAs |
| Critical / Alert | **Gaia Pink** | `#FF3C8E` | Errors, important events, warnings, critical paths, selected state |
| Event / Pulse | **Gaia Orange** | `#FF7A1A` | Events, broker nodes, topic pulses, secondary alerts |
| Neutral | **Gaia White** | `#F2F2F0` | Text, labels, inactive edges |
| Deep Ground | **Gaia Black** | `#0A0A0C` | Canvas background (dark mode) |
| Surface | **Gaia Surface** | `#111115` | Card/panel background (dark mode) |
| Surface 2 | **Gaia Surface 2** | `#18181E` | Elevated surfaces, drawers |
| Border | **Gaia Border** | `#2A2A35` | Dividers, node outlines |

### 2.2 Semantic Signal Colors (Dark Mode)

```
--color-node-service:     #39FF6E   /* active service node */
--color-node-db:          #00BFFF   /* database node — clear blue */
--color-node-broker:      #FF7A1A   /* broker/queue node */
--color-node-screen:      #B47AFF   /* frontend screen node */
--color-node-endpoint:    #39FF6E   /* endpoint block */
--color-node-function:    #F2F2F0   /* function block */
--color-node-flowcontrol: #FFD166   /* flow control — amber */
--color-node-dberror:     #FF3C8E   /* db error / throw */
--color-node-event:       #FF7A1A   /* event emit/consume */
--color-edge-default:     #2A2A35   /* inactive edge */
--color-edge-active:      #39FF6E   /* active / hovered edge */
--color-edge-critical:    #FF3C8E   /* error propagation edge */
--color-edge-event:       #FF7A1A   /* broker edge */
```

### 2.3 Light Mode Palette

Light mode is not a simple inversion — it uses warm paper-white backgrounds with desaturated versions of signal colors at higher opacities.

```
--color-canvas-light:       #F5F5F0
--color-surface-light:      #FFFFFF
--color-surface-2-light:    #F0F0EB
--color-border-light:       #D8D8D0
--color-text-primary-light: #0A0A0C
--color-text-muted-light:   #6B6B78

/* Signal colors shift to filled shapes, not glow */
--color-node-service-light: #1A9E47
--color-node-db-light:      #0077B6
--color-node-broker-light:  #C25500
--color-node-screen-light:  #7A4ABF
--color-edge-active-light:  #1A9E47
```

### 2.4 Opacity & Glow Tokens

Glow effects are dark-mode only. They use `box-shadow` or SVG `filter: drop-shadow()`.

```
--glow-green:  0 0 12px rgba(57,255,110,0.55), 0 0 32px rgba(57,255,110,0.20)
--glow-pink:   0 0 12px rgba(255,60,142,0.55), 0 0 32px rgba(255,60,142,0.20)
--glow-orange: 0 0 12px rgba(255,122,26,0.55), 0 0 32px rgba(255,122,26,0.20)
--glow-blue:   0 0 12px rgba(0,191,255,0.45), 0 0 24px rgba(0,191,255,0.15)
--glow-white:  0 0 8px rgba(242,242,240,0.30)
```

---

## 3. Typography

### 3.1 Typeface

**Primary: Space Grotesk** (Google Fonts — Variable)
Used for all UI text, labels, headings, and data values.

**Monospace: JetBrains Mono** (or system monospace fallback)
Used exclusively for code snippets, file paths, raw AST values, JSON previews.

### 3.2 Type Scale

| Token | Size | Weight | Line Height | Usage |
|---|---|---|---|---|
| `display-xl` | 48px | 700 | 1.1 | Marketing / landing |
| `display-lg` | 36px | 700 | 1.15 | Empty states, major headings |
| `heading-1` | 24px | 600 | 1.25 | Panel titles, screen labels |
| `heading-2` | 18px | 600 | 1.3 | Section headers |
| `heading-3` | 15px | 600 | 1.4 | Card titles, node names |
| `body` | 14px | 400 | 1.5 | General text, descriptions |
| `body-sm` | 13px | 400 | 1.5 | Secondary info, metadata |
| `label` | 12px | 500 | 1.4 | UI labels, badges, chip text |
| `label-xs` | 11px | 500 | 1.3 | Graph node labels (canvas) |
| `mono` | 13px | 400 | 1.6 | Code, paths, raw values |
| `mono-sm` | 12px | 400 | 1.6 | Inline code fragments |

### 3.3 Letter Spacing

- Headings ≥ heading-2: `-0.01em`
- Labels and badges: `+0.03em`
- Uppercase labels: `+0.08em`
- Graph canvas labels: `+0.02em` (improves readability at small sizes)

---

## 4. Spacing & Layout

### 4.1 Base Unit

`4px` base unit. All spacing values are multiples:

```
space-1:  4px
space-2:  8px
space-3:  12px
space-4:  16px
space-5:  20px
space-6:  24px
space-8:  32px
space-10: 40px
space-12: 48px
space-16: 64px
space-24: 96px
```

### 4.2 Application Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  SIDEBAR (64px collapsed / 240px expanded)  │  MAIN CANVAS      │
│  ─────────────────────────────────────────  │  ─────────────    │
│  Logo (48px)                                │                   │
│  ─────────                                  │  Full-bleed       │
│  Nav icons (32px × 32px, 16px gap)          │  graph canvas     │
│  ─────────                                  │  OR               │
│  Bottom: settings, theme, profile           │  content views    │
└─────────────────────────────────────────────────────────────────┘
```

- Sidebar is always visible; collapses to icon-only on canvas views
- No top navbar — sidebar handles all navigation
- Right panel (detail drawer): 360px wide, slides in over canvas, never pushes layout

### 4.3 Grid (Content Views)

Non-canvas content (settings, dashboard, integrations) uses a 12-column grid:
- Max width: 1280px
- Column gutter: 24px
- Outer margin: 40px (desktop), 20px (tablet)

---

## 5. Component System

### 5.1 Buttons

Three variants, two sizes.

**Primary (filled green):**
```
background: #39FF6E
color: #0A0A0C
border-radius: 8px
padding: 10px 20px (default) / 7px 14px (sm)
font: label / 600
box-shadow: --glow-green (hover only)
```

**Secondary (ghost):**
```
background: transparent
border: 1px solid #2A2A35
color: #F2F2F0
border-radius: 8px
hover: border-color: #39FF6E, color: #39FF6E
```

**Danger:**
```
Same as secondary but hover uses --color-node-dberror (#FF3C8E)
```

### 5.2 Cards & Panels

```
background: #111115
border: 1px solid #2A2A35
border-radius: 12px
padding: 20px 24px
```

Elevated panel (drawer):
```
background: #18181E
border: 1px solid #2A2A35
border-radius: 16px 0 0 16px (right drawer)
```

### 5.3 Badges & Chips

```
border-radius: 999px (pill)
padding: 3px 10px
font: label-xs / 500
letter-spacing: +0.04em

/* Variants */
.badge-green  { background: rgba(57,255,110,0.12); color: #39FF6E; }
.badge-pink   { background: rgba(255,60,142,0.12); color: #FF3C8E; }
.badge-orange { background: rgba(255,122,26,0.12); color: #FF7A1A; }
.badge-blue   { background: rgba(0,191,255,0.12);  color: #00BFFF; }
.badge-purple { background: rgba(180,122,255,0.12);color: #B47AFF; }
.badge-gray   { background: rgba(242,242,240,0.08);color: #9999AA; }
```

### 5.4 Input Fields

```
background: #0A0A0C
border: 1px solid #2A2A35
border-radius: 8px
padding: 10px 14px
color: #F2F2F0
font: body
focus: border-color: #39FF6E, box-shadow: 0 0 0 3px rgba(57,255,110,0.15)
placeholder: #4A4A5A
```

### 5.5 Tooltips

```
background: #18181E
border: 1px solid #2A2A35
border-radius: 8px
padding: 8px 12px
font: body-sm
color: #F2F2F0
max-width: 280px
```

---

## 6. Graph Canvas System

The canvas is the heart of Gaia. All graph views share the same canvas engine with different layout modes and node vocabularies.

### 6.1 Canvas Foundation

- Background: `#0A0A0C`
- Background texture: ultra-subtle dot grid at 24px interval, `rgba(255,255,255,0.025)`
- Canvas supports: pan (drag), zoom (scroll/pinch), selection (click), box select (shift+drag)
- All graph interactions happen in-canvas — no page navigation for node exploration

### 6.2 Node Shape Language

| Context | Shape | Notes |
|---|---|---|
| Global Graph (service, db, broker) | **Circle** | Radius scales with complexity score |
| Global Graph (screen/frontend) | **Circle** (purple tint) | Same as service but colored |
| Service View (endpoint) | **Rounded rectangle** | Wider, shows method + path |
| Endpoint View Level 1 & 2 | **Rounded rectangle** | Diagram flow blocks |
| Flow Control (if/switch/try/catch) | **Diamond / rhombus** | Clearly distinct from function blocks |
| Event nodes | **Hexagon** | Broker-esque shape |
| Data/constant | **Small pill** | Attached to function blocks |

### 6.3 Node Anatomy — Circle Nodes (Global View)

```
   ┌──────────────────────┐
   │  ○  glow ring        │  ← 2px ring, signal color, 60% opacity
   │  ●  fill circle      │  ← solid, color by type
   │  ────────────────    │
   │  Service Name        │  ← heading-3 / 600 below the circle
   │  [badge: NodeJS]     │  ← optional tech badge below name
   └──────────────────────┘
```

- Minimum radius: 24px (small service, few endpoints)
- Maximum radius: 72px (large service with many endpoints/functions)
- Radius formula: `base(24) + sqrt(endpoints + functions) × 4` (capped at 72)
- On hover: glow ring intensifies, radius + 4px (spring animation, 200ms)
- On selected (single-click): glow ring at full, ring becomes 3px, all unrelated nodes dim to 20% opacity

### 6.4 Node Anatomy — Block Nodes (Endpoint/Service View)

```
  ┌─────────────────────────────────────────────┐
  │  [METHOD]  /path/to/endpoint                │  ← heading-3
  │  ─────────────────────────────────────────  │
  │  Brief description or first param name      │  ← body-sm / muted
  │  [guard badge] [auth badge]                 │  ← optional badges
  └─────────────────────────────────────────────┘
```

- Width: 260px (standard), 320px (endpoint with multiple params)
- Border-radius: 10px
- Left border accent: 3px solid, signal color by type
- Depth shadow: `0 2px 12px rgba(0,0,0,0.5)`

### 6.5 Flow Control Block — Diamond

```
      ╱‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾╲
     ╱   if condition   ╲
    ╱                    ╲
    ╲                    ╱
     ╲                  ╱
      ╲________________╱
```
- Color: `#FFD166` (amber) with `rgba(255,209,102,0.10)` fill
- true/false labels on edges leaving the diamond

---

## 7. Screen Specifications

### 7.1 Home Screen

**Layout:** Centered on canvas, no graph visible behind. Dark surface.

**Primary action:**
- Large centered button: "Navigate →"
  - Font: heading-1 / 700
  - Color: `#39FF6E` text, no background
  - On hover: glow animates in, arrow slides right 6px
  - Subtext below: "Explore your system topology" in body / muted

**Secondary navigation grid (below the main button):**
Six equal cards in a 3×2 grid, 240px × 120px each:

| Icon | Label | Description |
|---|---|---|
| ⬡ | Extract | Pull topology from a repository |
| ◉ | Debug | Trace execution paths |
| ⬜ | Whiteboard | Free-form diagrams |
| ⌖ | Search | Query the graph |
| ⚙ | Settings | Integrations & config |
| ▦ | Dashboard | System health overview |

Card style: Surface background, border, 12px radius, icon (24px) top-left, label below. Hover: border transitions to signal color, subtle glow.

### 7.2 Global Graph View

**Canvas behavior:**
- Force-directed layout using D3.js / Sigma.js
- Nodes repel each other, edges attract connected nodes
- Initial layout runs for 3s then freezes (user can re-run with button)
- Camera starts zoomed to fit all nodes with 80px padding

**Edge rendering:**
- Default edge: curved bezier, 1.5px, `#2A2A35`
- On node hover: edges connected to that node pulse to `#39FF6E`, 2px, animated
- Edge direction: arrowhead at target end, 6px, same color as edge

**Pulse wave animation (on node single-click):**
A "wave" travels from the selected node to connected nodes along each edge:
1. Animated dot (4px circle, signal color) travels from source to target
2. Duration: 800ms per edge, `ease-in-out` easing
3. On arrival: target node briefly intensifies glow (300ms spring)
4. All waves run simultaneously from selected node outward
5. Second ring of nodes (2 hops) pulse with 400ms delay after first ring

**Right panel (double-click on node):**
Slides in from right (360px wide, 300ms cubic-bezier ease):
```
┌──────────────────────────────────────────┐
│  ○ Service Name           [×] close      │
│  [NodeJS] [Express] [v18.2]              │
│  ─────────────────────────────────────── │
│  Endpoints:  14                          │
│  Functions:  67                          │
│  DB nodes:   8                           │
│  Brokers:    2                           │
│  ─────────────────────────────────────── │
│  Dependencies                            │
│  ○ user-db         sync  ────────────    │
│  ○ kafka           async ─ ─ ─ ─ ─ ─    │
│  ─────────────────────────────────────── │
│  [Edit]  [Individual View →]             │
│  [Delete]  ← confirmation required       │
└──────────────────────────────────────────┘
```

Delete confirmation: inline inline inline (not modal), turns button red, shows "Type service name to confirm" input.

### 7.3 Service View

**Canvas behavior:**
- Hierarchical layout (dagre / elk.js): endpoints on left column, services/DBs they connect to on right column
- The selected service's endpoints are listed vertically on left with their HTTP method badges
- Lines extend right to dependency nodes (other services, databases, brokers)
- Edges pulse when hovered, showing directionality

**Endpoint listing (left column):**
Each endpoint is a block node (Section 6.4):
- Method badge on left: `GET` green, `POST` blue, `PUT` orange, `DELETE` pink, `PATCH` yellow
- Full path text
- Latency p95 badge if data is available

**Grandeur aesthetic:**
- Service name displayed large at top-left of canvas: heading-1 / 700, slightly transparent (50% on the canvas background)
- Faint horizontal scan-line behind the service name (CSS linear-gradient at 8% opacity)
- Node spacing generous: 80px vertical gap between endpoint blocks

### 7.4 Endpoint View Level 1 (Main Flow)

**Canvas behavior:**
- Top-down flow layout
- Shows only the main execution path: endpoint entry → primary function calls → database ops / events → return
- Secondary paths (error branches, optional calls) are collapsed and shown as a dotted collapsed node: "3 more branches"

**Expansion interaction:**
When clicking a function node (the "living organism" expansion):
1. Node border starts pulsing (green glow, 400ms cycle)
2. Node height expands (spring animation, 500ms): reveals child nodes inside
3. Child nodes appear with a staggered fade-in (each 80ms apart)
4. Edges between children drawn with an animated path (SVG stroke-dashoffset animation, 400ms)
5. The expanded node now has a subtle aura/glow background: `rgba(57,255,110,0.04)` surrounding its bounding box with a 12px blur

This expansion is **infinite** — each child function can itself be expanded, which triggers the same animation recursively.

**Collapse:** Click the function node header again. Children fade out with staggered reverse animation (80ms apart), node springs back to collapsed height.

### 7.5 Endpoint View Level 2 (Full Expanded Map)

**Canvas behavior:**
- All functions already expanded to show children
- External service endpoint references appear as collapsed "ghost nodes": dashed border, 40% opacity, labeled with the service name + endpoint method/path
- Database node appears at bottom-right: full DB block with table listing
- Each function's scope is marked by an "aura container": a rounded rect with `rgba(255,255,255,0.025)` background and 1px dashed border at `rgba(255,255,255,0.08)`, 16px border-radius — a container that groups the function and its children

**Aura / scope container:**
```
╔════════════════════════════════════╗  ← dashed border, subtle
║  function: getUserById             ║  ← label top-left, muted
║                                    ║
║  [findOne query] [cache check]     ║  ← child nodes inside
║  [log: info]                       ║
╚════════════════════════════════════╝
```

- Container does NOT have solid fill — just a barely-visible boundary
- Container label is `label-xs` / muted (60% opacity), positioned at top-left inside the border
- No nesting limit, but auto-collapse at depth > 5 (shows "Deep call chain — click to expand")

---

## 8. Edge & Animation System

### 8.1 Edge Types

| Type | Style | Color | Animation |
|---|---|---|---|
| Sync call | Solid line, arrowhead | `#2A2A35` (default), `#39FF6E` (active) | Wave dot on hover |
| Async / event | Dashed line, arrowhead | `#FF7A1A` | Traveling dash animation |
| Error propagation | Solid, thicker (2.5px) | `#FF3C8E` | Pulse on error state |
| Data flow | Dotted | `#F2F2F0` 30% | Static |
| DB query | Solid | `#00BFFF` | Wave dot on hover |

### 8.2 Wave Dot Animation

The core animation of Gaia. A dot travels from source to target along the edge path.

```css
@keyframes waveDot {
  0%   { offset-distance: 0%;   opacity: 0; }
  5%   { opacity: 1; }
  95%  { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}

.wave-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--edge-color);
  box-shadow: var(--glow-green);
  animation: waveDot 800ms ease-in-out;
  offset-path: path('...');  /* the SVG bezier path */
}
```

Speed guidance:
- Standard call: 800ms
- Event (async): 1200ms (slower — emphasizes async nature)
- Error: 600ms (faster — urgency)
- Never loop continuously unless in "live monitoring" mode

### 8.3 Node Entry Animations

When nodes first appear (view transition or expansion):
1. Scale from `0.6` to `1.0` with spring: `cubic-bezier(0.34, 1.56, 0.64, 1)`, 400ms
2. Opacity from `0` to `1`, 200ms

When nodes appear as part of an expanded group (staggered):
- Each child delays by `index × 60ms`

### 8.4 View Transitions

Between major views (Home → Global Graph, Global Graph → Service View):
- Canvas fades out at 30% opacity
- New canvas layout calculates off-screen
- Fade in at full opacity
- Duration: 400ms fade-out + 400ms fade-in
- No sliding/flipping — the canvas is always the same element, only content changes

### 8.5 Selection State Machine

```
idle → hovered      : edge glow 200ms ease
idle → selected     : wave animation fires, unrelated nodes dim (300ms), panel slides in (300ms)
selected → idle     : panel slides out, dim lifts (300ms)
selected → selected : wave fires from new node, panel updates content (crossfade 200ms)
```

---

## 9. Interaction Patterns

### 9.1 Click Behaviors

| Target | Single click | Double click | Right click |
|---|---|---|---|
| Service node (global) | Select, fire wave animation | Open detail panel | Context menu |
| Endpoint block | Select, highlight path | Open endpoint view | Context menu |
| Function block | Expand/collapse children | — | Context menu |
| Edge | Highlight edge + endpoints | — | — |
| Canvas background | Deselect all | — | Canvas context menu |

### 9.2 Context Menu

Appears at cursor position, 160px wide, dark surface:
```
────────────────────────
  View individually
  ────────────────────
  Edit metadata
  Add annotation
  ────────────────────
  Copy ID
  ────────────────────
  Delete…
────────────────────────
```

Dismiss: click outside, Escape key, or open another context menu.

### 9.3 Search (Graph Query)

Triggered via `Cmd/Ctrl + K` from anywhere, or the Search card on Home.

Full-screen overlay (dark backdrop 80% opacity):
```
┌─────────────────────────────────────────────────────────────┐
│  ⌖  Search or query the graph...                           │
│  ─────────────────────────────────────────────────────────  │
│  Recent:                                                    │
│  · user-service → findById                                  │
│  · endpoints with no auth middleware                        │
│  ─────────────────────────────────────────────────────────  │
│  Suggestions:                                               │
│  · Services using Redis                                     │
│  · Functions that throw without catch                       │
└─────────────────────────────────────────────────────────────┘
```

Supports natural language ("show all services that write to the users table") and graph query syntax (`service.endpoints[method=POST]`).

Results highlight matching nodes in the graph canvas behind the overlay.

### 9.4 Keyboard Shortcuts

| Key | Action |
|---|---|
| `Cmd/Ctrl + K` | Open search |
| `Escape` | Close panel / deselect |
| `G` | Go to Global Graph |
| `H` | Go to Home |
| `F` | Fit canvas to view |
| `+` / `-` | Zoom in / out |
| `Space + drag` | Pan canvas |
| `Tab` | Cycle through selected node's connections |

---

## 10. Data Visualization Tokens

For dashboard charts and metric displays (observability coverage, endpoint counts):

```
chart-bar-default:  #39FF6E
chart-bar-2:        #00BFFF
chart-bar-3:        #FF7A1A
chart-bar-4:        #B47AFF
chart-bar-5:        #FF3C8E
chart-grid:         rgba(255,255,255,0.06)
chart-axis-text:    rgba(242,242,240,0.50)
chart-tooltip-bg:   #18181E
```

Circular progress indicators:
- Track: `rgba(255,255,255,0.08)`
- Fill: signal color matching metric (green for healthy, pink for error rate, orange for latency)
- Animation: counter-clockwise fill, 800ms ease-out on load

---

## 11. Iconography

Use **Phosphor Icons** (phosphoricons.com) — consistent weight, good coverage, works with Space Grotesk aesthetic.

Default weight: `regular` for UI, `bold` for emphasis/CTAs.

Key icons:
```
Graph views: graph, share-network, circle-dashed
Services:    cube, stack, package
Endpoints:   arrow-bend-right-up, code-block
Functions:   function, brackets-curly
Databases:   database, table, cylinder
Brokers:     broadcast, queue
Events:      lightning, wave-triangle
Auth:        lock-key, shield-check
Settings:    gear, sliders, plugs-connected
```

Icon sizes: 16px (inline), 20px (standard UI), 24px (nav), 32px (card), 48px (empty states).

---

## 12. Accessibility

- All interactive elements: minimum 44×44px touch target
- Color meaning never used alone — always paired with shape or label
- Focus ring: `outline: 2px solid #39FF6E; outline-offset: 3px`
- Reduced motion: when `prefers-reduced-motion: reduce`, all animations disabled except fade transitions (150ms max)
- Contrast: all text against backgrounds meets WCAG AA (4.5:1 for body, 3:1 for large text)
- Graph canvas: keyboard navigable; Tab cycles through nodes in render order

---

## 13. Dark / Light Mode

Switching via system preference or manual toggle (settings icon, bottom sidebar).

**Transition:** All color changes use `transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease, box-shadow 200ms ease` on root and components. The canvas background and node colors transition simultaneously.

**CSS approach:** Use CSS custom properties on `:root[data-theme="dark"]` and `:root[data-theme="light"]`. The canvas renderer reads these via `getComputedStyle` on mount and on theme change events.

---

## 14. Gaia Design Principles

1. **The graph is always the truth.** The code is the source of truth; the graph is its living visualization. Every UI decision serves the graph.

2. **Signal before noise.** When something needs attention (error, critical path, selected state), it shines. Everything else dims. Never let the entire canvas compete for attention.

3. **Fluid, not fast.** Animations are deliberate. The wave moves at a pace that lets the eye follow the data flow. Speed does not imply urgency unless it's an error.

4. **Depth through layers.** Information density is managed by depth: Global → Service → Endpoint L1 → Endpoint L2. Each level reveals more without cluttering the previous.

5. **Living systems look alive.** Nodes breathe (subtle glow pulse on active services in live mode). Edges flow. Expansion feels organic. The graph is not a static diagram — it's a window into a running system.

---

*Gaia Design Guidelines — maintained alongside the codebase. Update when component behavior changes.*
