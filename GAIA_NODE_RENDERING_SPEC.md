# Gaia — Node Rendering Specification
**For AI implementation · Version 1.0 · April 2026**

This document describes exactly how every node type extracted from the system topology (schema v3) must be rendered in the Gaia endpoint flow view (Level 1 and Level 2). It covers visual anatomy, sizing, colors, layout rules, edge routing, interaction states, and expansion behavior.

---

## 1. Core Design Principles

1. **All block-type nodes share the same bounding box height (~48px)**. Condition diamonds, return pills, and containers are the only exceptions — and each has explicit proportional rules below.
2. **Color signals type, not decoration.** Every color has a semantic meaning from the palette; never reuse a color for a different type.
3. **Left accent bar is mandatory** on every rectangular block node. It is the primary visual cue for node type.
4. **Two-line layout inside blocks**: line 1 = primary label (name/path), line 2 = sublabel (metadata). Single-line nodes vertically center their label.
5. **Ghost / external nodes** are never part of the execution flow. They appear deemphasized (dashed border, 40–50% opacity) to the right of the call that references them.

---

## 2. Color & Token Reference

```
--green:   #39FF6E   → endpoint, success returns, active edges
--pink:    #FF3C8E   → error returns, throw nodes, false-branch edges
--orange:  #FF7A1A   → http calls, event/publish nodes, brokers
--blue:    #00BFFF   → db query nodes (dbProcess)
--purple:  #B47AFF   → process/transformation nodes, data assignments
--amber:   #FFD166   → flow control (condition diamonds, parallel containers)
--white:   #F2F2F0   → call/function nodes, internal labels
--muted:   #6B6B78   → sub-labels, secondary text
--border:  #2A2A35   → default stroke for neutral nodes
--surface: #111115   → node backgrounds (dark)
--surf2:   #18181E   → panel/drawer background
--black:   #0A0A0C   → canvas background
```

### Fill & Stroke derivation

For a node with accent color `C` (as hex):

```
background fill:  rgba(R,G,B, 0.05–0.10)  — lighter for neutral, stronger for colored
border stroke:    rgba(R,G,B, 0.25–0.40)  — for colored types; #2A2A35 for neutral (fn/call)
left accent bar:  C  at 100% opacity
hover fill:       rgba(R,G,B, 0.12–0.18)
selected fill:    rgba(R,G,B, 0.20)
```

---

## 3. Node Type Catalogue

### 3.1 `endpoint` — Entry Point

**Schema source:** `EndpointNode` (type: `"endpoint"`)  
**Visual role:** Top of the flow, identifies the HTTP route being visualized.

```
┌─────────────────────────────────────────────────────┐
│ [POST] /checkout                                    │
│ order-service · JWT · RateLimit · CORS              │
└─────────────────────────────────────────────────────┘
```

| Property       | Value                                            |
|----------------|--------------------------------------------------|
| Width          | 300px                                            |
| Height         | 48px                                             |
| Border-radius  | 10px                                             |
| Accent color   | `#39FF6E` (green)                                |
| Fill           | `rgba(57,255,110, 0.10)`                         |
| Stroke         | `#39FF6E`, 1.5px                                 |
| Glow filter    | yes — `drop-shadow` green                        |
| Left bar       | 3px wide, full height, `#39FF6E`                 |

**Content layout:**
- **Method badge** (POST/GET/PUT/PATCH/DELETE): small rect `40×16px`, `rx=4`, at `x+10, y+7`. Text: `font-size 9px, font-weight 700, JetBrains Mono, color = accent`.
- **Path text**: `x+56, y+20`, `font-size 13px, font-weight 600, Space Grotesk, #F2F2F0`.
- **Sublabel** (service name · middleware list): `x+10, y+36`, `font-size 10px, #6B6B78`.

**Schema fields used:**
- `metadata.method` → method badge text
- `metadata.path` → path text
- parent `ServiceNode.name` → sublabel prefix
- `metadata.middleware[]` → sublabel suffix (comma or · separated)

---

### 3.2 `function` / `call` — Function Call Block

**Schema source:** `CallNode` (type: `"call"`) or `FunctionNode` (type: `"function"`)  
**Visual role:** Represents a function call inside the endpoint's execution flow.

```
┌─────────────────────────────────────────────────────┐
│ call  validateCheckoutPayload(body)                 │
│       function · validators/checkout.ts             │  [+]
└─────────────────────────────────────────────────────┘
```

| Property       | Value                                            |
|----------------|--------------------------------------------------|
| Width          | 300px                                            |
| Height         | 48px                                             |
| Border-radius  | 10px                                             |
| Accent color   | `#F2F2F0` (white)                                |
| Fill           | `rgba(242,242,240, 0.04)`                        |
| Stroke         | `#2A2A35` (neutral border), 1.5px                |
| Left bar       | 3px wide, full height, `#F2F2F0`                 |

**Content layout:**
- **Tag** (`call` or `fn`): top-left inside block at `x+10, y+19`, `font-size 9px, JetBrains Mono, #F2F2F0 opacity 0.55`.
- **Label**: function name + params — `x+14, y+22`, `font-size 12.5px, font-weight 500, Space Grotesk, #F2F2F0`.
- **Sublabel**: file path or context — `x+14, y+37`, `font-size 10.5px, #6B6B78`.
- **Expand button** (if expandable): `+` / `−` icon in top-right corner, `20×20px rect rx=5`, faint border, white at 40% opacity (for `+`) or pink at 60% (for `−`).

**Schema fields used:**
- `CallNode.metadata.callee` or `FunctionNode.name` → label (with params)
- `CallNode.metadata.awaited` → adds `await` prefix or `· awaited` in sublabel
- `FunctionNode.location.file` → sublabel
- `FunctionNode.metadata.async` → sublabel note

**Expandable indicator:** Nodes whose `type === "function"` and that have resolvable children in the AST are expandable. Show `+` expand button. Clicking toggles expansion state (see §6).

---

### 3.3 `dbProcess` — Database Query Block

**Schema source:** `DbProcessNode` (type: `"dbProcess"`)  
**Visual role:** Represents a database operation inside the execution flow.

```
┌─────────────────────────────────────────────────────┐
│ db    users.findUnique({ where: { id: userId } })   │
│       users-db · SELECT · ~8ms                      │
└─────────────────────────────────────────────────────┘
```

| Property       | Value                                            |
|----------------|--------------------------------------------------|
| Width          | 300px (or lane width inside parallel)            |
| Height         | 48px                                             |
| Border-radius  | 10px                                             |
| Accent color   | `#00BFFF` (blue)                                 |
| Fill           | `rgba(0,191,255, 0.05)`                          |
| Stroke         | `rgba(0,191,255, 0.25)`, 1.5px                   |
| Glow filter    | yes — `drop-shadow` blue                         |
| Left bar       | 3px wide, `#00BFFF`                              |

**Content layout:**
- **Tag** (`db`): `x+10, y+19`, `font-size 9px, JetBrains Mono, #00BFFF opacity 0.55`.
- **Label**: `ORM.table.operation(args)` — `x+14, y+22`, `font-size 12.5px, font-weight 500, #F2F2F0`. Truncate to ~50 chars.
- **Sublabel**: `databaseId · operation · avg latency` — `x+14, y+37`, `font-size 10.5px, #6B6B78`.

**Schema fields used:**
- `metadata.databaseId` → sublabel prefix (connection alias)
- `metadata.tableId` → part of label
- `metadata.operation` → part of label + sublabel
- `metadata.orm` → optional in sublabel
- `metadata.conditions` → part of label arguments

---

### 3.4 `call` (HTTP external) — HTTP Call Block

**Schema source:** `CallNode` where `metadata.resolvedTo` points to an external service endpoint, or `metadata.callee` uses an HTTP client.  
**Visual role:** Represents an outbound HTTP call to an external service (Stripe, Auth0, etc.).

```
┌──────────────────────────────────────────────────────────┐
│ [POST] stripeClient.charges.create(chargeData)           │
│        call · external · stripe-node SDK · timeout 8s   │
└──────────────────────────────────────────────────────────┘
```

| Property       | Value                                                |
|----------------|------------------------------------------------------|
| Width          | 360px (wider to show URL context)                    |
| Height         | 48px                                                 |
| Border-radius  | 10px                                                 |
| Accent color   | `#FF7A1A` (orange)                                   |
| Fill           | `rgba(255,122,26, 0.06)`                             |
| Stroke         | `rgba(255,122,26, 0.40)`, 1.5px                      |
| Glow filter    | yes — orange glow                                    |
| Left bar       | 3px, `#FF7A1A`                                       |

**Content layout:**
- **Method badge** (HTTP method of the external call): same as endpoint badge, accent color orange.
- **Label**: callee expression — after badge, `font-size 12.5px, #F2F2F0`.
- **Sublabel**: `call · external · {sdk or "fetch"} · timeout {n}s · retry ×{n}` — `font-size 10px, #6B6B78`.

**Ghost endpoint reference:** Every HTTP call node must have a connected **ghost node** to its right (see §3.8). The ghost is not part of the flow graph — it is a visual annotation showing the external endpoint being called.

**Schema fields used:**
- `CallNode.metadata.callee` → label
- Inferred from callee or `resolvedTo`: method, url
- `CallNode.metadata.awaited` → in sublabel

---

### 3.5 `event` — Event Publish Block

**Schema source:** `EventNode` (type: `"event"`, `metadata.kind: "emit" | "publish"`)  
**Visual role:** Represents an asynchronous event being published to a broker.

```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│ evt  kafka.emit("order.created", order)                 │
│      event · async · fire-and-forget · kafka            │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

| Property        | Value                                               |
|-----------------|-----------------------------------------------------|
| Width           | 300px                                               |
| Height          | 48px                                                |
| Border-radius   | 10px                                                |
| Accent color    | `#FF7A1A` (orange)                                  |
| Fill            | `rgba(255,122,26, 0.05)`                            |
| Stroke          | `rgba(255,122,26, 0.30)`, 1.5px, **dashed** `7 4`  |
| Left bar        | 3px, `#FF7A1A`                                      |

The **dashed border** is the primary visual indicator of async nature. Do not use a solid border for event nodes.

**Schema fields used:**
- `EventNode.metadata.kind` → tag (`evt` for emit/publish)
- `EventNode.metadata.channel` → broker identifier in sublabel
- `EventNode.metadata.eventName` → event name in label
- `EventNode.metadata.payload` → payload type in sublabel

---

### 3.6 `process` — Process / Transformation Block

**Schema source:** `ProcessNode` (type: `"process"`)  
**Visual role:** Represents a data transformation, assignment, or computation. Appears **only inside expanded function containers**, never at the top level of the main flow.

```
┌────────────────────────────────────────────┐
│ proc  schema = CheckoutSchema.compile()    │
└────────────────────────────────────────────┘
```

| Property       | Value                                            |
|----------------|--------------------------------------------------|
| Height         | 36px (shorter — secondary node)                  |
| Border-radius  | 7px                                              |
| Accent color   | `#B47AFF` (purple)                               |
| Fill           | `rgba(180,122,255, 0.04)`                        |
| Stroke         | `rgba(180,122,255, 0.12)`, 1px                   |
| Left bar       | 2.5px, `#B47AFF`                                 |

**Schema fields used:**
- `ProcessNode.metadata.description` or `ProcessNode.name` → label
- `ProcessNode.metadata.kind` → tag hint (`proc`, `assign`, `map`)

---

### 3.7 `flowControl` — Condition Diamond

**Schema source:** `FlowControlNode` (type: `"flowControl"`, `metadata.kind: "if" | "else_if" | "ternary"`)  
**Visual role:** Branching decision point. Always a diamond (rhombus) shape.

```
        ╱‾‾‾‾‾‾‾‾‾‾‾‾‾╲
       ╱  payload valid? ╲
       ╲                  ╱
        ╲________________╱
```

| Property       | Value                                            |
|----------------|--------------------------------------------------|
| Shape          | SVG `<polygon>` with 4 points (rhombus)          |
| Half-height    | 32px → bounding box height = **64px**            |
| Half-width     | 95px → bounding box width = 190px                |
| Accent color   | `#FFD166` (amber)                                |
| Fill           | `rgba(255,209,102, 0.07)`                        |
| Stroke         | `#FFD166`, 1.5px                                 |
| Glow filter    | yes — amber glow                                 |

**Proportional rule:** `hh = 32`, `hw = 95` **uniformly** for all conditions. Never vary hw/hh per node — inconsistent sizes break visual rhythm. If a condition label is too long, truncate it (max ~20 chars) and show the full expression in the detail panel.

**Content layout:**
- **Label** centered at diamond center `(cx, cy)`, `text-anchor: middle`, `dominant-baseline: middle`, `font-size 11px, font-weight 500, Space Grotesk, #FFD166`.
- For the vertical text offset: use `y = cy + 5` (corrects for font descender).
- Max label length: 20 characters. Use shorthand: `"payment ok?"` not `"charge.status === 'succeeded'?"`.

**Branch edges:** Leaving edges get labeled `true` (green badge) and `false` (pink badge). See §5 for edge label placement rules.

**Polygon points calculation:**
```javascript
const pts = `${cx},${cy-hh} ${cx+hw},${cy} ${cx},${cy+hh} ${cx-hw},${cy}`;
```

**Schema fields used:**
- `FlowControlNode.metadata.condition` → label (truncated)
- `FlowControlNode.metadata.branches[].label` → edge labels (true/false)
- `FlowControlNode.metadata.kind` → determines diamond vs. other shapes (only `if`/`else_if`/`ternary` use diamond; `try`/`catch` use a rounded rect with `#FF3C8E` accent)

---

### 3.8 Ghost Endpoint Reference

**Not a schema node.** A visual annotation attached to `call` (HTTP external) nodes.  
**Visual role:** Shows the external endpoint being called — makes the URL/method visible without making it a live node in the flow.

```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│ ↗  POST api.stripe.com/v1/charges          │  ← 40-50% opacity
│    external endpoint reference             │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

| Property       | Value                                                  |
|----------------|--------------------------------------------------------|
| Width          | 220px                                                  |
| Height         | 36px (same as return pill)                             |
| Border-radius  | 8px                                                    |
| Fill           | `rgba(255,122,26, 0.04)`                               |
| Stroke         | `rgba(255,122,26, 0.25)`, 1px, **dashed** `5 3`        |
| Node opacity   | 0.70 — intentionally deemphasized                      |
| Position       | To the right of the HTTP call node, same vertical center |
| Connector      | Dashed line from HTTP call's right edge to ghost's left edge. Color: `rgba(255,122,26, 0.35)`. No arrowhead (or hollow arrowhead). |

**Ghost nodes are NOT interactive.** They have no click handler, no hover effect, no panel. They are visual annotations only.

**Content:**
- `↗` icon at left (external indicator)
- `{METHOD} {host}{path}` in JetBrains Mono, `font-size 10.5px`, `rgba(242,242,240, 0.45)`
- `"external endpoint reference"` sublabel, `font-size 9.5px`, `rgba(107,107,120, 0.70)`

---

### 3.9 `return` — Return / Success Response Pill

**Schema source:** `ReturnNode` (type: `"return"`, `metadata.kind: "response"`, `metadata.httpStatus >= 200`)

```
    ╭─────────────────────────────────────────────────╮
    │   201   { orderId, status: "pending" }          │
    ╰─────────────────────────────────────────────────╯
```

| Property       | Value                                            |
|----------------|--------------------------------------------------|
| Width          | 280px (success, centered) / 152px (error, right-branched) |
| Height         | **36px** — shorter than block nodes              |
| Border-radius  | `height/2 = 18px` → full pill shape              |
| Accent color   | `#39FF6E` for 2xx · `#FF3C8E` for 4xx/5xx       |
| Fill           | `rgba(R,G,B, 0.09)`                              |
| Stroke         | `rgba(R,G,B, 0.55)`, 1.5px                       |

**Content layout:**
- **HTTP code**: centered, `font-size 11px, font-weight 700, letter-spacing 0.04em`, accent color.
- **Label** (response shape or error message): centered below code, `font-size 9.5px, opacity 0.65`, accent color.
- Two-line layout: code at `cy - 2px`, label at `cy + 12px`.

**Positioning rules:**
- **Success returns** (end of main flow): centered on the main flow axis (`cx = 500`).
- **Error returns** (from condition false-branches): positioned to the **right** of the diamond, vertically centered on the diamond's `cy`. Left edge at `x=700`. Width 152px.
- **Throw nodes** within expanded containers: inline pill inside the container, right side of the inline condition row.

**Schema fields used:**
- `ReturnNode.metadata.httpStatus` → code and color selection
- `ReturnNode.metadata.value` or `metadata.valueType` → label
- `ThrowNode.metadata.httpStatus` + `metadata.errorClass` → for throw → same pill style with pink

---

## 4. Expanded Function Container

When a `function` / `call` node is clicked, it **expands** in-place, replacing the collapsed block with a container (aura box) that reveals its internal sub-flow.

### 4.1 Container Anatomy

```
┌ ─ ─ fn: validateCheckoutPayload(body) ─ [−] ─ ─ ─ ─ ─ ┐
│                                                          │
│  [proc] schema = CheckoutSchema.compile()               │
│  ────────────────────────────────────────────────────── │
│  [call] result = schema.validate(body)                  │
│  ────────────────────────────────────────────────────── │
│  ◇ if result.error → throw ValidationError(result.error)│
│  ────────────────────────────────────────────────────── │
│  [↩ return] { valid: true, data: result.value }         │
│                                                          │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

| Property          | Value                                              |
|-------------------|----------------------------------------------------|
| Width             | Same as the collapsed node (300px or lane width)   |
| Height            | Sum of children heights + padding (computed)       |
| Border-radius     | 12px                                               |
| Fill              | `rgba(255,255,255, 0.018)` — barely visible        |
| Stroke            | `rgba(242,242,240, 0.18)`, 1px, **dashed** `6 4`   |
| Header height     | 26px — contains function name label + `−` button  |
| Header fill       | `rgba(242,242,240, 0.05)`                          |
| Content padding   | Top: 26px (header) + 8px · Bottom: 10px · Sides: 12px |
| Child gap         | 6px between child nodes                            |

**Header:**
- `fn` tag in JetBrains Mono, `font-size 9px`, white at 40% opacity.
- Function name in Space Grotesk, `font-size 11px, font-weight 500`, `rgba(242,242,240, 0.70)`.
- `−` collapse button at top-right: `font-size 13px`, `rgba(255,60,142, 0.60)`.

### 4.2 Child Node Types Inside Containers

All child nodes use **reduced sizing** (36–44px height) and **reduced visual weight** (1px borders, lower opacity) relative to the main flow nodes. They do not have expand buttons or hover glows.

| Child type      | Height | Left bar color | Tag text | Notes                                |
|-----------------|--------|----------------|----------|--------------------------------------|
| `proc`          | 36px   | `#B47AFF`      | `proc`   | Data transformations, assignments    |
| `call` (inner)  | 40px   | `#F2F2F0`      | `call`   | Nested function calls                |
| `db`            | 44px   | `#00BFFF`      | `db`     | DB queries, same sublabel convention |
| `inline-cond`   | 32px   | `#FFD166`      | `◇`      | `if X → action` on a single line     |
| `return-inner`  | 32px   | accent color   | `↩`      | Return value inside function         |
| `throw-inner`   | 32px   | `#FF3C8E`      | `✕`      | Throw inside function                |

**Inline condition** (`inline-cond`) special layout:
- `◇` icon at left
- Condition text: `"if result.error"`
- Arrow `→` in the middle
- Right side: throw/return label in pink or green monospace
- No separate diamond is drawn; the whole row is a single rounded rect

**Return inner** (`return-inner`):
- Pill shape (`border-radius: height/2`)
- `↩` icon at left, return value in JetBrains Mono at right

### 4.3 Height Computation

```
containerHeight = HEADER_H + PADDING_TOP + sum(childH[i] + GAP * (n-1)) + PADDING_BOTTOM

Where:
  HEADER_H     = 26
  PADDING_TOP  = 8
  PADDING_BOTTOM = 10
  GAP          = 6
```

Pre-compute this at data-definition time so the layout engine can calculate downstream node positions before rendering.

### 4.4 Expansion Behavior

1. User **single-clicks** a `function`/`call` block (or its `+` button).
2. `expansionState[nodeId]` toggles to `true`.
3. The entire diagram **fades out** (opacity → 0, 200ms).
4. Layout is **recomputed**: the expanded node's height increases by `(expandedH - collapsedH)`. All nodes **below** the expanded node shift down by the same delta.
5. Diagram **fades back in** (opacity → 1, 200ms) with the new layout rendered.
6. Clicking the `−` button reverses the process.

**Level controls:**
- **L1 (summary)**: `expansionState` for all expandable nodes = `false`. All functions show as collapsed blocks.
- **L2 (full map)**: `expansionState` for all expandable nodes = `true`. All functions show as expanded containers.

---

## 5. Edge Routing

### 5.1 Edge Types

| Edge type    | Style                              | Color (idle)    | Color (active)  | Marker     |
|--------------|------------------------------------|-----------------|-----------------|------------|
| `flow`       | Solid, 1.5px                       | `#2A2A35`       | `#39FF6E`       | Green arrow |
| `true`       | Solid, 1.5px                       | `#2A2A35`       | `#39FF6E`       | Green arrow |
| `false`      | Solid, 1.5px                       | `#2A2A35`       | `#FF3C8E`       | Pink arrow  |
| `async`      | Dashed `6 4`, 1.5px                | `rgba(30,21,0)` | `#FF7A1A`       | Orange arrow |
| `db`         | Solid, 1.5px                       | `#0E2E3A`       | `#00BFFF`       | Blue arrow  |
| `ghost-ref`  | Dashed `5 3`, 1px, no arrowhead    | `rgba(255,122,26,.35)` | — | none |

### 5.2 Main Flow Edges

The main flow is top-to-bottom. Use straight `L` paths (no curves) for direct vertical connections:

```
M {CX} {nodeBottom} L {CX} {nextNodeTop}
```

Where `CX = 500` (horizontal center of the main flow).

### 5.3 Branch Edges (Condition → Error Returns)

False branches exit from the **right point** of the diamond `(cx + hw, cy)` to the **left edge** of the error return pill `(BRANCH_X, returnCY)`. Use a straight line:

```
M {cx + hw} {cy}  L  {BRANCH_X} {returnCY}
```

Where `BRANCH_X = 700` and `returnCY = diamond.cy` (error returns are vertically centered on the diamond).

True branches exit from the **bottom point** of the diamond `(cx, cy + hh)` to the top of the next main-flow node. Use a straight line.

### 5.4 Parallel Fork / Join Edges

The parallel container has a **fork dot** at its top-center `(CX, containerTop)` and a **join dot** at its bottom-center `(CX, containerBottom)`.

- **Fork → left lane**: cubic bezier curving down and left:
  ```
  M {CX} {forkY}  C {CX} {forkY+14}  {laneCX} {forkY+14}  {laneCX} {laneTop}
  ```
- **Fork → right lane**: symmetric, curving down and right.
- **Lane bottom → join**: cubic bezier curving down and back to center:
  ```
  M {laneCX} {laneBottom}  C {laneCX} {joinY-10}  {CX} {joinY-10}  {CX} {joinY}
  ```

### 5.5 Edge Labels (true / false)

Place a small pill badge near the **origin** of each labeled edge:

| Property      | True badge                         | False badge                        |
|---------------|------------------------------------|------------------------------------|
| Background    | `rgba(57,255,110, 0.10)`           | `rgba(255,60,142, 0.10)`           |
| Text color    | `#39FF6E`                          | `#FF3C8E`                          |
| Font          | Space Grotesk, `9.5px, weight 500` | same                               |
| Size          | `~28×14px, rx=3`                   | `~32×14px, rx=3`                   |
| Position      | Just after the diamond exit point, offset `+5px` from the line |

---

## 6. Parallel Container

**Schema source:** `Promise.all` call or explicit parallel annotation in the flow.  
**Visual role:** Groups two or more simultaneous operations.

```
┌ ─ ─ ─ ─ ─ PARALLEL  Promise.all([...])  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│  ●  ←── fork dot                                                                          │
│  ─────────────────────────────────────│──────────────────────────────────────────────     │
│  [call] getUserById(userId)           │  [call] checkInventory(items)                     │
│  → db query · awaited                 │  → db query · awaited                             │
│  ─────────────────────────────────────│──────────────────────────────────────────────     │
│  ●  ←── join dot                                                                          │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

| Property       | Value                                                    |
|----------------|----------------------------------------------------------|
| Width          | 700px (spans from `x=150` to `x=850`)                    |
| Height         | Dynamic: `max(leftLaneH, rightLaneH) + 44` (22 fork + 22 join area) |
| Border-radius  | 14px                                                     |
| Fill           | `rgba(255,209,102, 0.022)`                               |
| Stroke         | `rgba(255,209,102, 0.22)`, 1px, dashed `8 4`             |

**Fork/Join dots:**
- `<circle>` at `(CX, containerTop)` and `(CX, containerBottom)`, `r=4`, fill `#FFD166`, opacity `0.80`.

**Lane divider:** Vertical line at `x=CX`, from `containerTop+30` to `containerBottom-22`. `stroke: rgba(255,255,255, 0.04)`.

**Header:** `PARALLEL` label at `x+14, y+16`, `font-size 9px, font-weight 600, letter-spacing 0.10em, #FFD166, opacity 0.50`. `Promise.all(...)` sublabel in JetBrains Mono, `font-size 9px, opacity 0.30`.

**Lane layout:** Each lane occupies half the container width minus margins. Lane nodes are vertically centered within the lane if they have different heights.

---

## 7. Layout System

### 7.1 Main Flow Axis

```
CX = 500px   ← horizontal center of all main-flow nodes
BX = 350px   ← left edge of standard 300px-wide blocks
```

### 7.2 Vertical Spacing

| Gap context                      | Value  |
|----------------------------------|--------|
| Between most sequential nodes   | 16px   |
| Before/after condition diamonds | 20px   |
| Before save/event after diamond | 20px   |
| Inside parallel lane top/bottom | 22px   |
| Between children inside containers | 6px |

### 7.3 X Positions for Special Nodes

| Node type                         | X position                                     |
|-----------------------------------|------------------------------------------------|
| Standard 300px blocks (main flow) | `x=350` (center at CX=500)                     |
| HTTP call (360px wide)            | `x=320` (center at CX=500)                     |
| Parallel container (700px)        | `x=150` (center at CX=500)                     |
| Error return pills (152px)        | `x=700` (right of diamond)                     |
| Success return pill (280px)       | `x=360` (center at CX=500)                     |
| Ghost endpoint (220px)            | `x=700` (right of HTTP call node)              |
| Left parallel lane                | `x = PARALLEL_X + 20`                          |
| Right parallel lane               | `x = CX + 10`                                  |

### 7.4 Dynamic Layout on Expansion

When a node with ID `nodeId` expands:
1. `delta = EXP[nodeId].expandedH - H.fn`  (positive = grows)
2. All nodes that appear **after** `nodeId` in the linear flow order get their `y` increased by `delta`.
3. All nodes **inside** the parallel container that expands: the container's own height grows; all nodes after the container shift by the container's height delta.
4. Edges are fully recomputed after layout change.

---

## 8. Node States

### 8.1 Default (Idle)

- Fill: type-specific base fill (see §3)
- Stroke: type-specific base stroke
- Opacity: 1.0

### 8.2 Hover

- Fill increases opacity by ~0.07 (e.g., 0.04 → 0.12)
- Stroke color brightens (approach 100% opacity for colored types)
- SVG glow filter applied (`feGaussianBlur` stdDeviation=4, merged with source)
- Cursor: `pointer`
- Show tooltip (§9)

### 8.3 Selected (clicked, not expanded)

- Fill: `rgba(R,G,B, 0.20)`
- Stroke: full accent color, 2px
- Glow filter: applied, stronger
- All **unconnected** nodes dim to `opacity: 0.12` (300ms transition)
- All **connected edges** activate (see §5.1 active colors)
- **Expand button** (if present) highlights

### 8.4 Expanded

- The collapsed block is replaced by the expanded container (§4)
- Expand button changes from `+` (white) to `−` (pink)
- The container itself is not hoverable/selectable as a unit (only its children are interactive in L2 mode)

---

## 9. Tooltip

**Trigger:** Mouse enters any interactive node.

```
┌───────────────────────────────────────────────┐
│  validateCheckoutPayload  ·  function · expandable │
└───────────────────────────────────────────────┘
```

| Property     | Value                                                     |
|--------------|-----------------------------------------------------------|
| Background   | `#18181E`                                                 |
| Border       | 1px solid `#2A2A35`                                       |
| Border-radius| 8px                                                       |
| Padding      | `7px 11px`                                                |
| Font         | Space Grotesk, 11.5px                                     |
| Position     | `cursor + (14, -34)` — above and to the right             |
| Content      | `{nodeName}  ·  {typeLabel}`                              |
| Delay        | Appears immediately; hides after 80ms debounce on leave   |

---

## 10. Detail Panel (double-click)

Slides in from the right (340px wide, 300ms ease). Shows:

1. **Header**: colored icon chip + node name + type sub-label + close button.
2. **Badges**: type tags (method, framework, async, etc.) as colored pills.
3. **Stats grid**: 2-column grid of numeric stats (latency, row count, etc.) in large font.
4. **Detail rows**: key → value table (path, operation, table, timeout, etc.).
5. **Source** (optional): code snippet in JetBrains Mono on dark background.
6. **Actions**: "Go to source →" primary button.

Badge color selection rules:
- HTTP methods (GET/POST/etc.): orange
- 2xx / success / created: green
- 4xx / error / throw / fail: pink
- db / SQL / transaction / Prisma: blue
- async / kafka / event / publish: orange
- JWT / auth / guard: amber
- expandable / call / await: purple
- everything else: gray

---

## 11. L1 vs L2 View Modes

| Feature                           | L1 Summary           | L2 Full Map                        |
|-----------------------------------|----------------------|------------------------------------|
| Function nodes                    | Collapsed blocks     | Expanded containers with children  |
| Parallel lane nodes               | Collapsed blocks     | Expanded containers with children  |
| Condition diamonds                | Shown               | Shown                              |
| Return/throw pills                | Shown               | Shown                              |
| Ghost endpoints                   | Shown               | Shown                              |
| Canvas height                     | ~700–900px           | ~1400–1800px (depends on functions)|
| Expand buttons visible            | Yes (`+`)            | Yes (`−`)                          |
| Individual expand                 | Click any fn         | Click any fn to collapse           |

**Toggle button** is in the top-right toolbar. Switching triggers a full re-render with a 200ms fade transition (opacity 0→render→1).

---

## 12. Implementation Checklist

- [ ] `computeLayout(expansionState)` returns `{ nodeId: { y, h } }` for all nodes
- [ ] Diamond uses `hh=32, hw=95` (uniform); bounding box = 64px tall
- [ ] All rectangular blocks = 48px tall (endpoint, fn, call, db, http, event)
- [ ] Return/throw pills = 36px tall, `border-radius = 18px`
- [ ] Expanded containers computed height = 26 + 8 + Σ(childH + 6*(n-1)) + 10
- [ ] Parallel container height = max(leftLaneH, rightLaneH) + 44
- [ ] Ghost node: `opacity=0.70`, dashed border, no interaction, to the right of HTTP call
- [ ] Error returns: `x=700`, vertically centered on diamond cy
- [ ] Edge labels (`true`/`false`): pill badges near diamond exit points
- [ ] `async` edges: dashed `6 4`, orange
- [ ] On expand/collapse: fade out → recompute layout → re-render → fade in (200ms each)
- [ ] L1 = all collapsed, L2 = all expanded
- [ ] Individual expand toggles only the clicked node
- [ ] Tooltip on hover, detail panel on double-click
- [ ] All SVG glow filters use `feGaussianBlur stdDeviation=4`
- [ ] Font: Space Grotesk (UI labels) + JetBrains Mono (code, tags, badges)

---

*Gaia Node Rendering Spec — maintained alongside `gaia-endpoint-v2.html`. This spec is the ground truth for all future implementations of the endpoint flow view.*
