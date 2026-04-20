// gaiaNodes.ts — TypeScript port of graph-nodes.js (v2)
// Imperative SVG node/edge factories. Matches the visual design exactly.
// Requires graph-nodes.css.

const SVG_NS = 'http://www.w3.org/2000/svg'

export type Side = 'L' | 'R' | 'T' | 'B'

export interface Bounds { w: number; h: number; shape: 'circle' | 'rect' | 'diamond'; r?: number }

export interface GaiaNode extends SVGGElement {
  __type: string
  __x: number
  __y: number
  __edges: Set<GaiaEdge>
  __children: Set<GaiaNode>
  __parent: GaiaRegion | null
  __bounds: Bounds
  __anchor: (tx: number, ty: number) => { x: number; y: number }
  setPosition: (x: number, y: number) => void
}

export interface GaiaRegion extends SVGGElement {
  __kind: 'region'
  __x: number
  __y: number
  __edges: Set<GaiaEdge>
  __children: Set<GaiaNode>
  __collapsed: boolean
  __labelText: string
  __padding: number
  __labelH: number
  __bbox?: { x: number; y: number; w: number; h: number }
  __bounds: Bounds
  __anchor: (tx: number, ty: number) => { x: number; y: number }
  __rect: SVGRectElement
  __label: SVGTextElement
  __chev: SVGTextElement
  __collapsedAt?: { x: number; y: number }
  __hardBounds?: { minX: number; maxX: number; minY: number; maxY: number }
  adopt: (node: GaiaNode) => void
  reflow: () => void
  setHardBounds: (b: { minX: number; maxX: number; minY: number; maxY: number }) => void
  toggleCollapse: () => void
}

export interface GaiaEdge extends SVGGElement {
  __source: GaiaNode | GaiaRegion
  __target: GaiaNode | GaiaRegion
  __origSource?: GaiaNode | GaiaRegion
  __origTarget?: GaiaNode | GaiaRegion
  __type: string
  __label?: string
  __path: SVGPathElement
  __wave: SVGPathElement
  __labelBg?: SVGRectElement
  __labelText?: SVGTextElement
  update: () => void
  fire: () => void
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function el<T extends SVGElement>(tag: string, attrs: Record<string, string | number | null | undefined> = {}): T {
  const n = document.createElementNS(SVG_NS, tag) as T
  for (const k in attrs) {
    const v = attrs[k]
    if (v != null) n.setAttribute(k, String(v))
  }
  return n
}

// ─────────────────────────────────────────────────────────────
// TEXT MEASUREMENT (lazy singleton)
// ─────────────────────────────────────────────────────────────
let _measureSvg: SVGSVGElement | null = null

function getMeasureSvg(): SVGSVGElement {
  if (_measureSvg) return _measureSvg
  _measureSvg = el<SVGSVGElement>('svg', { width: 0, height: 0, style: 'position:absolute;left:-9999px;visibility:hidden' })
  document.body.appendChild(_measureSvg)
  return _measureSvg
}

export function measure(text: string, font = '13px "Space Grotesk", sans-serif', weight: number | string = 600): { w: number; h: number } {
  const svg = getMeasureSvg()
  const t = el<SVGTextElement>('text', { style: `font: ${weight} ${font}` })
  t.textContent = text
  svg.appendChild(t)
  const bb = t.getBBox()
  t.remove()
  return { w: bb.width, h: bb.height }
}

// ─────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────
export function setNodeState(node: GaiaNode, state: 'hover' | 'selected' | 'dimmed' | 'error' | 'default') {
  ;['hover', 'selected', 'dimmed', 'error'].forEach(s => node.classList.remove('gn-node--' + s))
  if (state && state !== 'default') node.classList.add('gn-node--' + state)
}

export function triggerTap(node: GaiaNode) {
  node.classList.remove('gn-node--tapping')
  node.getBBox?.()
  node.classList.add('gn-node--tapping')
  setTimeout(() => node.classList.remove('gn-node--tapping'), 500)
}

// ─────────────────────────────────────────────────────────────
// BASE NODE
// ─────────────────────────────────────────────────────────────
function wrapNode(type: string, extraClass = ''): GaiaNode {
  const g = el<SVGGElement>('g', { class: `gn-node gn-node--${type} ${extraClass}`.trim(), 'data-type': type }) as unknown as GaiaNode
  g.__type = type
  g.__x = 0; g.__y = 0
  g.__edges = new Set()
  g.__children = new Set()
  g.__parent = null
  g.setPosition = (x: number, y: number) => {
    g.__x = x; g.__y = y
    g.setAttribute('transform', `translate(${x},${y})`)
  }
  return g
}

// ─────────────────────────────────────────────────────────────
// CIRCLE NODE (service / database / broker)
// ─────────────────────────────────────────────────────────────
function circleNode(type: string, title: string, meta?: string): GaiaNode {
  const g = wrapNode(type)
  const mT = measure(title, '13px "Space Grotesk"', 600)
  const mM = meta ? measure(meta, '10px "JetBrains Mono"', 500) : { w: 0, h: 0 }
  const textW = Math.max(mT.w, mM.w)
  const r = Math.max(34, Math.ceil(textW / 2) + 14)
  const inner = el('g', { class: 'gn-node__inner' })
  inner.appendChild(el('circle', { class: 'gn-node__body', r }))
  inner.appendChild(el('circle', { class: 'gn-node__flash', r: r - 1 }))
  const tTitle = el<SVGTextElement>('text', { class: 'gn-node__title', y: meta ? -7 : 0 })
  tTitle.textContent = title
  inner.appendChild(tTitle)
  if (meta) {
    const tMeta = el<SVGTextElement>('text', { class: 'gn-node__meta', y: 9 })
    tMeta.textContent = meta
    inner.appendChild(tMeta)
  }
  g.appendChild(inner)
  g.__bounds = { w: r * 2, h: r * 2, shape: 'circle', r }
  g.__anchor = (tx, ty) => {
    const dx = tx - g.__x, dy = ty - g.__y
    const len = Math.hypot(dx, dy) || 1
    return { x: g.__x + (dx / len) * r, y: g.__y + (dy / len) * r }
  }
  return g
}

export function createServiceNode(id: string, label: string, endpointCount: number): GaiaNode {
  const g = circleNode('service', label, `${endpointCount} endpoints`)
  g.setAttribute('data-id', id)
  return g
}

export function createDatabaseNode(id: string, label: string, engine: string): GaiaNode {
  const g = circleNode('database', label, engine)
  g.setAttribute('data-id', id)
  return g
}

export function createBrokerNode(id: string, label: string, engine: string): GaiaNode {
  const g = circleNode('broker', label, engine)
  g.setAttribute('data-id', id)
  return g
}

// ─────────────────────────────────────────────────────────────
// RECT NODE (frontend)
// ─────────────────────────────────────────────────────────────
function rectAnchor(cx: number, cy: number, w: number, h: number, tx: number, ty: number) {
  const dx = tx - cx, dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const hw = w / 2, hh = h / 2
  const scale = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9))
  return { x: cx + dx * scale, y: cy + dy * scale }
}

function rectNode(type: string, title: string, meta?: string): GaiaNode {
  const g = wrapNode(type)
  const mT = measure(title, '13px "Space Grotesk"', 600)
  const mM = meta ? measure(meta, '10px "JetBrains Mono"', 500) : { w: 0, h: 0 }
  const w = Math.max(96, Math.ceil(Math.max(mT.w, mM.w)) + 28)
  const h = meta ? 52 : 36
  const inner = el('g', { class: 'gn-node__inner' })
  inner.appendChild(el('rect', { class: 'gn-node__body', x: -w/2, y: -h/2, width: w, height: h, rx: 8 }))
  inner.appendChild(el('rect', { class: 'gn-node__flash', x: -w/2+1, y: -h/2+1, width: w-2, height: h-2, rx: 7 }))
  const tTitle = el<SVGTextElement>('text', { class: 'gn-node__title', y: meta ? -8 : 0 })
  tTitle.textContent = title
  inner.appendChild(tTitle)
  if (meta) {
    const tMeta = el<SVGTextElement>('text', { class: 'gn-node__meta', y: 10 })
    tMeta.textContent = meta
    inner.appendChild(tMeta)
  }
  g.appendChild(inner)
  g.__bounds = { w, h, shape: 'rect' }
  g.__anchor = (tx, ty) => rectAnchor(g.__x, g.__y, w, h, tx, ty)
  return g
}

export function createFrontendNode(id: string, label: string): GaiaNode {
  const g = rectNode('frontend', label, 'frontend')
  g.setAttribute('data-id', id)
  return g
}

// ─────────────────────────────────────────────────────────────
// EVENT NODE (hexagon)
// ─────────────────────────────────────────────────────────────
export function createEventNode(id: string, label: string): GaiaNode {
  const g = wrapNode('event')
  g.setAttribute('data-id', id)
  const m = measure(label, '12px "Space Grotesk"', 600)
  const radius = Math.max(32, Math.ceil(m.w / 2) + 18)
  const pts = [0,1,2,3,4,5].map(i => {
    const a = (Math.PI / 3) * i - Math.PI / 2
    return `${Math.cos(a)*radius},${Math.sin(a)*radius}`
  }).join(' ')
  const inner = el('g', { class: 'gn-node__inner' })
  inner.appendChild(el('polygon', { class: 'gn-node__body', points: pts }))
  inner.appendChild(el('polygon', { class: 'gn-node__flash', points: pts }))
  const t = el<SVGTextElement>('text', { class: 'gn-node__title', y: 0, style: 'font-size:12px' })
  t.textContent = label
  inner.appendChild(t)
  g.appendChild(inner)
  g.__bounds = { w: radius*2, h: radius*2, shape: 'circle', r: radius * 0.92 }
  g.__anchor = (tx, ty) => {
    const dx = tx - g.__x, dy = ty - g.__y
    const len = Math.hypot(dx, dy) || 1
    return { x: g.__x + (dx/len) * radius * 0.92, y: g.__y + (dy/len) * radius * 0.92 }
  }
  return g
}

// ─────────────────────────────────────────────────────────────
// ENDPOINT NODE (pill with method + path)
// ─────────────────────────────────────────────────────────────
export function createEndpointNode(id: string, method: string, path: string, ms?: number): GaiaNode {
  const g = wrapNode('endpoint')
  g.setAttribute('data-id', id)
  const methodW = Math.max(40, measure(method, '10px "JetBrains Mono"', 700).w + 14)
  const pathW = measure(path, '12px "JetBrains Mono"', 500).w
  const w = methodW + pathW + 22
  const h = 28
  const inner = el('g', { class: 'gn-node__inner' })
  inner.appendChild(el('rect', { class: 'gn-node__body', x: -w/2, y: -h/2, width: w, height: h, rx: 6 }))
  inner.appendChild(el('rect', { class: 'gn-node__flash', x: -w/2+1, y: -h/2+1, width: w-2, height: h-2, rx: 5 }))
  inner.appendChild(el('rect', { class: `gn-endpoint__pill gn-endpoint__pill--${method}`, x: -w/2+4, y: -h/2+4, width: methodW, height: h-8, rx: 4 }))
  const tM = el<SVGTextElement>('text', { class: 'gn-node__method', x: -w/2+4+methodW/2, y: 0 })
  tM.textContent = method
  inner.appendChild(tM)
  const tP = el<SVGTextElement>('text', { class: 'gn-node__code', x: -w/2+methodW+12, y: 0, style: 'text-anchor:start;font-size:12px' })
  tP.textContent = path
  inner.appendChild(tP)
  if (ms != null) {
    const tMs = el<SVGTextElement>('text', { class: 'gn-node__meta', x: w/2-8, y: 0, style: 'text-anchor:end;font-size:10px' })
    tMs.textContent = `${ms}ms`
    inner.appendChild(tMs)
  }
  g.appendChild(inner)
  g.__bounds = { w, h, shape: 'rect' }
  g.__anchor = (tx, ty) => rectAnchor(g.__x, g.__y, w, h, tx, ty)
  return g
}

// ─────────────────────────────────────────────────────────────
// FUNCTION NODE (compact pill { } name)
// ─────────────────────────────────────────────────────────────
export function createFunctionNode(id: string, name: string): GaiaNode {
  const g = wrapNode('function')
  g.setAttribute('data-id', id)
  const textW = measure(name, '12px "JetBrains Mono"', 500).w
  const w = Math.max(90, textW + 44)
  const h = 28
  const inner = el('g', { class: 'gn-node__inner' })
  inner.appendChild(el('rect', { class: 'gn-node__body', x: -w/2, y: -h/2, width: w, height: h, rx: 6 }))
  inner.appendChild(el('rect', { class: 'gn-node__flash', x: -w/2+1, y: -h/2+1, width: w-2, height: h-2, rx: 5 }))
  const brace = el<SVGTextElement>('text', { x: -w/2+10, y: 0, style: 'font: 500 11px "JetBrains Mono"; fill: var(--text-muted); dominant-baseline:central' })
  brace.textContent = '{ }'
  inner.appendChild(brace)
  const t = el<SVGTextElement>('text', { x: -w/2+30, y: 0, style: 'font: 500 12px "JetBrains Mono"; fill: var(--text-primary); dominant-baseline:central' })
  t.textContent = name
  inner.appendChild(t)
  g.appendChild(inner)
  g.__bounds = { w, h, shape: 'rect' }
  g.__anchor = (tx, ty) => rectAnchor(g.__x, g.__y, w, h, tx, ty)
  return g
}

// ─────────────────────────────────────────────────────────────
// CONTROL NODE (diamond)
// ─────────────────────────────────────────────────────────────
export function createControlNode(id: string, label = 'if'): GaiaNode {
  const g = wrapNode('control')
  g.setAttribute('data-id', id)
  const m = measure(label, '12px "JetBrains Mono"', 500)
  const w = Math.max(70, m.w + 44)
  const h = Math.max(40, m.h + 28)
  const pts = `0,${-h/2} ${w/2},0 0,${h/2} ${-w/2},0`
  const inner = el('g', { class: 'gn-node__inner' })
  inner.appendChild(el('polygon', { class: 'gn-node__body', points: pts, fill: 'var(--accent-orange-dim)' }))
  inner.appendChild(el('polygon', { class: 'gn-node__flash', points: pts }))
  const t = el<SVGTextElement>('text', { class: 'gn-node__code', y: 0, style: 'font-size:11px' })
  t.textContent = label
  inner.appendChild(t)
  g.appendChild(inner)
  g.__bounds = { w, h, shape: 'diamond' }
  g.__anchor = (tx, ty) => {
    const dx = tx - g.__x, dy = ty - g.__y
    if (dx === 0 && dy === 0) return { x: g.__x, y: g.__y }
    const tt = 1 / (Math.abs(dx) / (w/2) + Math.abs(dy) / (h/2))
    return { x: g.__x + dx * tt, y: g.__y + dy * tt }
  }
  return g
}

// ─────────────────────────────────────────────────────────────
// RETURN NODE (status-coded pill)
// ─────────────────────────────────────────────────────────────
export function createReturnNode(id: string, status: 'ok' | 'err', code?: string): GaiaNode {
  const g = wrapNode('return', `gn-node--status-${status}`)
  g.setAttribute('data-id', id)
  const mainW = measure('return', '12px "JetBrains Mono"', 500).w
  const codeW = code ? measure(code, '10px "JetBrains Mono"', 500).w : 0
  const w = Math.max(70, Math.max(mainW, codeW) + 24)
  const h = code ? 38 : 28
  const inner = el('g', { class: 'gn-node__inner' })
  inner.appendChild(el('rect', { class: 'gn-node__body', x: -w/2, y: -h/2, width: w, height: h, rx: 5 }))
  inner.appendChild(el('rect', { class: 'gn-node__flash', x: -w/2+1, y: -h/2+1, width: w-2, height: h-2, rx: 4 }))
  const t = el<SVGTextElement>('text', { class: 'gn-node__code', y: code ? -7 : 0, style: 'fill: currentColor; font-size: 12px' })
  t.textContent = 'return'
  inner.appendChild(t)
  if (code) {
    const c = el<SVGTextElement>('text', { class: 'gn-node__meta', y: 9 })
    c.textContent = code
    inner.appendChild(c)
  }
  g.appendChild(inner)
  g.__bounds = { w, h, shape: 'rect' }
  g.__anchor = (tx, ty) => rectAnchor(g.__x, g.__y, w, h, tx, ty)
  return g
}

// ─────────────────────────────────────────────────────────────
// REGION (function container, auto-resizes, collapsible)
// ─────────────────────────────────────────────────────────────
export function createFunctionRegion(id: string, label: string, padding = 28): GaiaRegion {
  const g = document.createElementNS(SVG_NS, 'g') as unknown as GaiaRegion
  g.setAttribute('class', 'gn-region gn-region--function')
  g.setAttribute('data-id', id)
  g.__kind = 'region'
  g.__padding = padding
  g.__labelH = 24
  g.__children = new Set()
  g.__edges = new Set()
  g.__collapsed = false
  g.__labelText = label
  const rect = el<SVGRectElement>('rect', { class: 'gn-region__body', rx: 10, x: 0, y: 0, width: 10, height: 10 })
  const tLabel = el<SVGTextElement>('text', { class: 'gn-region__label', x: 14, y: 17 })
  tLabel.textContent = label
  const chev = el<SVGTextElement>('text', { class: 'gn-region__chev', x: 0, y: 17, style: 'cursor:pointer' })
  chev.textContent = '▾'
  g.appendChild(rect)
  g.appendChild(tLabel)
  g.appendChild(chev)
  g.__rect = rect
  g.__label = tLabel
  g.__chev = chev
  g.__bounds = { w: 10, h: 10, shape: 'rect' }
  g.__x = 0; g.__y = 0
  g.__anchor = (tx, ty) => rectAnchor(g.__x, g.__y, g.__bounds.w, g.__bounds.h, tx, ty)

  g.adopt = (node: GaiaNode) => { g.__children.add(node); node.__parent = g }
  g.reflow = () => reflowRegion(g)
  g.setHardBounds = (b) => { g.__hardBounds = b }
  g.toggleCollapse = () => toggleRegionCollapse(g)
  chev.addEventListener('click', (e) => { e.stopPropagation(); g.toggleCollapse() })
  tLabel.addEventListener('click', (e) => { e.stopPropagation(); g.toggleCollapse() })
  return g
}

export function reflowRegion(region: GaiaRegion) {
  if (region.__collapsed) return
  if (!region.__children.size) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  region.__children.forEach(n => {
    const hw = n.__bounds.w / 2, hh = n.__bounds.h / 2
    if (n.__x - hw < minX) minX = n.__x - hw
    if (n.__y - hh < minY) minY = n.__y - hh
    if (n.__x + hw > maxX) maxX = n.__x + hw
    if (n.__y + hh > maxY) maxY = n.__y + hh
  })
  const p = region.__padding
  const x = minX - p
  const y = minY - p - region.__labelH
  const w = (maxX - minX) + p * 2
  const h = (maxY - minY) + p * 2 + region.__labelH
  region.__rect.setAttribute('x', String(x))
  region.__rect.setAttribute('y', String(y))
  region.__rect.setAttribute('width', String(w))
  region.__rect.setAttribute('height', String(h))
  region.__label.setAttribute('x', String(x + 30))
  region.__label.setAttribute('y', String(y + 17))
  region.__chev.setAttribute('x', String(x + 14))
  region.__chev.setAttribute('y', String(y + 17))
  region.__bbox = { x, y, w, h }
  region.__x = x + w/2; region.__y = y + h/2
  region.__bounds = { w, h, shape: 'rect' }
  region.__anchor = (tx, ty) => rectAnchor(region.__x, region.__y, w, h, tx, ty)
}

function toggleRegionCollapse(region: GaiaRegion) {
  region.__collapsed = !region.__collapsed
  region.classList.toggle('is-collapsed', region.__collapsed)
  region.__chev.textContent = region.__collapsed ? '▸' : '▾'
  region.__children.forEach(n => {
    ;(n as SVGElement).style.display = region.__collapsed ? 'none' : ''
    n.__edges.forEach(e => {
      const s = e.__source as GaiaNode, t = e.__target as GaiaNode
      const sIn = region.__children.has(s), tIn = region.__children.has(t)
      if (sIn && tIn) {
        ;(e as SVGElement).style.display = region.__collapsed ? 'none' : ''
      } else {
        if (region.__collapsed) {
          if (!e.__origSource) { e.__origSource = s; e.__origTarget = t }
          if (sIn) e.__source = region as unknown as GaiaNode
          if (tIn) e.__target = region as unknown as GaiaNode
        } else if (e.__origSource) {
          e.__source = e.__origSource
          e.__target = e.__origTarget!
          e.__origSource = e.__origTarget = undefined
        }
        e.update?.()
      }
    })
  })
  if (region.__collapsed) {
    const w = Math.max(140, region.__labelText.length * 8 + 48)
    const h = 34
    const rx = region.__collapsedAt?.x ?? region.__bbox?.x ?? 0
    const ry = region.__collapsedAt?.y ?? region.__bbox?.y ?? 0
    region.__rect.setAttribute('x', String(rx))
    region.__rect.setAttribute('y', String(ry))
    region.__rect.setAttribute('width', String(w))
    region.__rect.setAttribute('height', String(h))
    region.__label.setAttribute('x', String(rx + 30))
    region.__label.setAttribute('y', String(ry + 21))
    region.__chev.setAttribute('x', String(rx + 14))
    region.__chev.setAttribute('y', String(ry + 21))
    region.__bbox = { x: rx, y: ry, w, h }
    region.__x = rx + w/2; region.__y = ry + h/2
    region.__bounds = { w, h, shape: 'rect' }
    region.__anchor = (tx, ty) => rectAnchor(region.__x, region.__y, w, h, tx, ty)
  } else {
    region.reflow()
  }
}

function clampToRegion(node: GaiaNode, x: number, y: number): { x: number; y: number } {
  const parent = node.__parent
  if (!parent || !parent.__hardBounds) return { x, y }
  const hb = parent.__hardBounds
  const hw = node.__bounds.w / 2, hh = node.__bounds.h / 2
  return {
    x: Math.max(hb.minX + hw, Math.min(hb.maxX - hw, x)),
    y: Math.max(hb.minY + hh, Math.min(hb.maxY - hh, y)),
  }
}

// ─────────────────────────────────────────────────────────────
// EDGES
// ─────────────────────────────────────────────────────────────
export function createEdge(
  source: GaiaNode | GaiaRegion,
  target: GaiaNode | GaiaRegion,
  type = 'sync',
  label?: string
): GaiaEdge {
  const g = el<SVGGElement>('g', { class: `gn-edge-group gn-edge-group--${type}` }) as unknown as GaiaEdge
  g.__source = source
  g.__target = target
  g.__type = type
  g.__label = label
  const path = el<SVGPathElement>('path', { class: `gn-edge gn-edge--${type}` })
  const wave = el<SVGPathElement>('path', { class: 'gn-edge-wave' })
  g.appendChild(path)
  g.appendChild(wave)
  g.__path = path
  g.__wave = wave
  if (label) {
    const labelBg = el<SVGRectElement>('rect', { class: 'gn-edge-label-bg', rx: 3 })
    const labelText = el<SVGTextElement>('text', { class: 'gn-edge-label' })
    labelText.textContent = label
    g.appendChild(labelBg)
    g.appendChild(labelText)
    g.__labelBg = labelBg
    g.__labelText = labelText
  }
  g.update = () => updateEdge(g)
  g.fire = () => fireEdge(g)
  if (source.__edges) source.__edges.add(g)
  if (target.__edges) target.__edges.add(g)
  g.update()
  return g
}

// Orthogonal router
function orthogonalPath(s: GaiaNode | GaiaRegion, t: GaiaNode | GaiaRegion) {
  const sx = s.__x, sy = s.__y, tx = t.__x, ty = t.__y
  if (!s.__bounds || !t.__bounds) return { d: '', points: [] }
  const sw = s.__bounds.w/2, sh = s.__bounds.h/2
  const tw = t.__bounds.w/2, th = t.__bounds.h/2
  const dx = tx - sx, dy = ty - sy
  const horiz = Math.abs(dx) >= Math.abs(dy)
  const sSide: Side = horiz ? (dx >= 0 ? 'R' : 'L') : (dy >= 0 ? 'B' : 'T')
  const tSide: Side = horiz ? (dx >= 0 ? 'L' : 'R') : (dy >= 0 ? 'T' : 'B')
  const sP = sidePoint(sx, sy, sw, sh, sSide)
  const tP = sidePoint(tx, ty, tw, th, tSide, 8)
  const points = routeOrtho(sP, sSide, tP, tSide)
  return { d: roundedPolyline(points, 8), points }
}

interface Pt { x: number; y: number; side?: Side }

function sidePoint(cx: number, cy: number, hw: number, hh: number, side: Side, off = 0): Pt {
  switch (side) {
    case 'L': return { x: cx - hw - off, y: cy, side }
    case 'R': return { x: cx + hw + off, y: cy, side }
    case 'T': return { x: cx, y: cy - hh - off, side }
    case 'B': return { x: cx, y: cy + hh + off, side }
  }
}

function routeOrtho(s: Pt, sSide: Side, t: Pt, tSide: Side): Pt[] {
  const stub = 14
  const s0 = extend(s, sSide, stub)
  const t0 = extend(t, tSide, stub)
  const points: Pt[] = [{ x: s.x, y: s.y }, s0]
  const horizFirst = sSide === 'L' || sSide === 'R'
  if (horizFirst) {
    points.push({ x: s0.x, y: t0.y })
    points.push({ x: t0.x, y: t0.y })
  } else {
    points.push({ x: t0.x, y: s0.y })
    points.push({ x: t0.x, y: t0.y })
  }
  points.push({ x: t.x, y: t.y })
  return dedupe(points)
}

function extend(p: Pt, side: Side, d: number): Pt {
  switch (side) {
    case 'L': return { x: p.x - d, y: p.y }
    case 'R': return { x: p.x + d, y: p.y }
    case 'T': return { x: p.x, y: p.y - d }
    case 'B': return { x: p.x, y: p.y + d }
  }
}

function dedupe(pts: Pt[]): Pt[] {
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i]
    if (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5) out.push(b)
  }
  return out
}

function roundedPolyline(pts: Pt[], r = 8): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i-1], cur = pts[i], next = pts[i+1]
    const v1x = cur.x - prev.x, v1y = cur.y - prev.y
    const v2x = next.x - cur.x, v2y = next.y - cur.y
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y)
    const rr = Math.min(r, l1/2, l2/2)
    const p1 = { x: cur.x - (v1x/l1)*rr, y: cur.y - (v1y/l1)*rr }
    const p2 = { x: cur.x + (v2x/l2)*rr, y: cur.y + (v2y/l2)*rr }
    d += ` L ${p1.x} ${p1.y} Q ${cur.x} ${cur.y} ${p2.x} ${p2.y}`
  }
  const last = pts[pts.length-1]
  d += ` L ${last.x} ${last.y}`
  return d
}

function updateEdge(g: GaiaEdge) {
  const s = g.__source, t = g.__target
  if (!s.__bounds || !t.__bounds) return
  const { d, points } = orthogonalPath(s, t)
  g.__path.setAttribute('d', d)
  g.__wave.setAttribute('d', d)
  const pathLen = g.__path.getTotalLength ? g.__path.getTotalLength() : 200
  g.__wave.style.strokeDasharray = `${pathLen}`
  g.__wave.style.strokeDashoffset = `${pathLen}`
  g.__wave.style.setProperty('--gn-len', String(pathLen))
  if (g.__labelText && points.length >= 2) {
    const mid = points[Math.floor(points.length / 2)]
    const prev = points[Math.floor(points.length / 2) - 1] || mid
    const midX = (prev.x + mid.x) / 2
    const midY = (prev.y + mid.y) / 2
    g.__labelText.setAttribute('x', String(midX))
    g.__labelText.setAttribute('y', String(midY))
    try {
      const bb = g.__labelText.getBBox()
      g.__labelBg!.setAttribute('x', String(bb.x - 5))
      g.__labelBg!.setAttribute('y', String(bb.y - 2))
      g.__labelBg!.setAttribute('width', String(bb.width + 10))
      g.__labelBg!.setAttribute('height', String(bb.height + 4))
    } catch {}
  }
}

function fireEdge(g: GaiaEdge) {
  g.classList.remove('is-firing', 'is-lit')
  void g.getBoundingClientRect()
  g.classList.add('is-firing')
  setTimeout(() => {
    g.classList.remove('is-firing')
    g.classList.add('is-lit')
  }, 650)
}

// ─────────────────────────────────────────────────────────────
// DEFS (shared arrow marker)
// ─────────────────────────────────────────────────────────────
export function createGraphDefs(): SVGDefsElement {
  const defs = el<SVGDefsElement>('defs')
  const mk = (id: string, color: string) => {
    const m = el('marker', { id, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' })
    m.appendChild(el('path', { d: 'M 0 0 L 8 4 L 0 8 L 2 4 z', fill: color, opacity: 0.7 }))
    return m
  }
  defs.appendChild(mk('gn-arrow', 'var(--text-muted)'))
  defs.appendChild(mk('gn-arrow-lit', 'var(--accent-green)'))
  return defs
}

// ─────────────────────────────────────────────────────────────
// DRAG (pointer-based, reflows edges + parent region live)
// ─────────────────────────────────────────────────────────────
export function enableDrag(
  node: GaiaNode,
  svg: SVGSVGElement,
  onMove?: (n: GaiaNode) => void
) {
  let down: { px: number; py: number; nx: number; ny: number; moved: boolean } | null = null
  let lastClickTime = 0

  const toSvg = (e: PointerEvent) => {
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    return ctm ? pt.matrixTransform(ctm.inverse()) : { x: e.clientX, y: e.clientY }
  }

  node.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const p = toSvg(e)
    down = { px: p.x, py: p.y, nx: node.__x, ny: node.__y, moved: false }
    node.classList.add('is-dragging')
    node.setPointerCapture(e.pointerId)
  })

  node.addEventListener('pointermove', (e: PointerEvent) => {
    if (!down) return
    const p = toSvg(e)
    const dx = p.x - down.px, dy = p.y - down.py
    if (Math.hypot(dx, dy) > 2) down.moved = true
    const nx = down.nx + dx, ny = down.ny + dy
    const clamped = clampToRegion(node, nx, ny)
    node.setPosition(clamped.x, clamped.y)
    node.__edges.forEach(eg => eg.update())
    if (node.__parent) {
      node.__parent.reflow()
      node.__parent.__edges?.forEach(eg => eg.update())
    }
    onMove?.(node)
  })

  const end = (e: PointerEvent) => {
    if (!down) return
    const wasMoved = down.moved
    down = null
    node.classList.remove('is-dragging')
    try { node.releasePointerCapture(e.pointerId) } catch {}
    if (!wasMoved) {
      const now = Date.now()
      const isDouble = now - lastClickTime < 300
      lastClickTime = now
      if (isDouble) {
        node.dispatchEvent(new CustomEvent('gn-dblclick', { bubbles: true }))
      } else {
        node.dispatchEvent(new CustomEvent('gn-click', { bubbles: true }))
      }
    }
  }

  node.addEventListener('pointerup', end)
  node.addEventListener('pointercancel', end)
}

// ─────────────────────────────────────────────────────────────
// ZOOM / PAN (viewBox-based)
// ─────────────────────────────────────────────────────────────
export interface ZoomPanHandle {
  reset: () => void
  zoomIn: () => void
  zoomOut: () => void
  fitContent: (padding?: number) => void
  getScale: () => number
  destroy: () => void
}

export function enableZoomPan(svg: SVGSVGElement, contentGroup?: SVGGElement, onBgClick?: () => void): ZoomPanHandle {
  const vb = svg.viewBox.baseVal
  const orig = { x: vb.x, y: vb.y, w: vb.width, h: vb.height }
  let state = { x: orig.x, y: orig.y, w: orig.w, h: orig.h }
  let panDown: { px: number; py: number; vx: number; vy: number; moved: boolean } | null = null

  const apply = () => svg.setAttribute('viewBox', `${state.x} ${state.y} ${state.w} ${state.h}`)

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1.1 : 0.9
    const rect = svg.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * state.w + state.x
    const my = ((e.clientY - rect.top) / rect.height) * state.h + state.y
    const nw = Math.max(200, Math.min(orig.w * 5, state.w * factor))
    const nh = Math.max(100, Math.min(orig.h * 5, state.h * factor))
    state.x = mx - (mx - state.x) * (nw / state.w)
    state.y = my - (my - state.y) * (nh / state.h)
    state.w = nw; state.h = nh
    apply()
  }

  const onPanDown = (e: PointerEvent) => {
    const t = e.target as Element
    if (!t.classList.contains('gn-bg') && t !== svg) return
    panDown = { px: e.clientX, py: e.clientY, vx: state.x, vy: state.y, moved: false }
    svg.setPointerCapture(e.pointerId)
    svg.style.cursor = 'grabbing'
  }

  const onPanMove = (e: PointerEvent) => {
    if (!panDown) return
    const dx = e.clientX - panDown.px, dy = e.clientY - panDown.py
    if (Math.hypot(dx, dy) > 3) panDown.moved = true
    const rect = svg.getBoundingClientRect()
    const scale = state.w / rect.width
    state.x = panDown.vx - dx * scale
    state.y = panDown.vy - dy * scale
    apply()
  }

  const onPanEnd = (e: PointerEvent) => {
    if (!panDown) return
    const wasMoved = panDown.moved
    panDown = null
    svg.style.cursor = 'grab'
    try { svg.releasePointerCapture(e.pointerId) } catch {}
    if (!wasMoved && onBgClick) onBgClick()
  }

  svg.addEventListener('wheel', onWheel, { passive: false })
  svg.addEventListener('pointerdown', onPanDown)
  svg.addEventListener('pointermove', onPanMove)
  svg.addEventListener('pointerup', onPanEnd)
  svg.addEventListener('pointercancel', onPanEnd)
  svg.style.cursor = 'grab'

  return {
    reset: () => { state = { ...orig }; apply() },
    zoomIn: () => { state.w *= 0.8; state.h *= 0.8; apply() },
    zoomOut: () => { state.w *= 1.25; state.h *= 1.25; apply() },
    fitContent: (padding = 60) => {
      const target = contentGroup ?? svg
      try {
        const bb = target.getBBox()
        if (bb.width === 0 || bb.height === 0) return
        const rect = svg.getBoundingClientRect()
        const svgAspect = rect.width / rect.height
        const bbAspect = bb.width / bb.height
        let w: number, h: number
        if (bbAspect > svgAspect) {
          w = bb.width + padding * 2
          h = w / svgAspect
        } else {
          h = bb.height + padding * 2
          w = h * svgAspect
        }
        state.x = bb.x - (w - bb.width) / 2
        state.y = bb.y - (h - bb.height) / 2
        state.w = w; state.h = h
        apply()
      } catch {}
    },
    getScale: () => {
      const rect = svg.getBoundingClientRect()
      return rect.width / state.w
    },
    destroy: () => {
      svg.removeEventListener('wheel', onWheel)
      svg.removeEventListener('pointerdown', onPanDown)
      svg.removeEventListener('pointermove', onPanMove)
      svg.removeEventListener('pointerup', onPanEnd)
      svg.removeEventListener('pointercancel', onPanEnd)
    },
  }
}
