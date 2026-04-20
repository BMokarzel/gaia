import React, { useEffect, useRef, useState, useCallback } from 'react'
import { ZoomControls } from '@/shell/ZoomControls'
import { useCurrentEndpoint, useTopologyStore } from '@/store/topologyStore'
import { NodeDetailPanel, type NodeDetailInfo } from '@/detail/NodeDetailPanel'
import {
  createEndpointNode, createFunctionNode, createControlNode,
  createReturnNode, createFunctionRegion, createEdge, createGraphDefs,
  enableDrag, enableZoomPan, triggerTap,
  type GaiaNode, type GaiaRegion, type GaiaEdge, type ZoomPanHandle,
} from '@/graph/gaiaNodes'
import type { CodeNode, FlowControlNode, DbProcessNode, ReturnNode, ThrowNode, FunctionNode } from '@/types/topology'
import styles from './EndpointView.module.css'

export type Density = 'expanded' | 'short' | 'collapsed'

const DENSITY_OPTIONS: { k: Density; icon: string; label: string }[] = [
  { k: 'expanded',  icon: '▦', label: 'expanded' },
  { k: 'short',     icon: '▤', label: 'short' },
  { k: 'collapsed', icon: '▪', label: 'collapsed' },
]

// ── Layout constants ───────────────────────────────────────
const H_GAP = 220  // horizontal gap between columns
const V_GAP = 90   // vertical gap between rows
const START_X = 80 // left edge for endpoint node

// ─────────────────────────────────────────────────────────────
// OUTCOME HELPERS (for short mode)
// ─────────────────────────────────────────────────────────────
interface Outcome { type: 'return' | 'throw'; status: string }

function collectOutcomes(nodes: CodeNode[]): Outcome[] {
  const out: Outcome[] = []
  for (const n of nodes) {
    if (n.type === 'return') {
      const r = n as ReturnNode
      out.push({ type: 'return', status: String(r.metadata.httpStatus ?? 200) })
    } else if (n.type === 'throw') {
      const t = n as ThrowNode
      out.push({ type: 'throw', status: String(t.metadata.httpStatus ?? t.metadata.errorClass.slice(0, 8)) })
    } else if (n.type === 'flowControl') {
      const fc = n as FlowControlNode
      if (fc.metadata.branches) {
        for (const b of fc.metadata.branches) out.push(...collectOutcomes(b.children))
      }
      out.push(...collectOutcomes(n.children))
    } else {
      out.push(...collectOutcomes(n.children))
    }
  }
  return out
}

function dedupeOutcomes(outcomes: Outcome[]): Outcome[] {
  const seen = new Set<string>()
  return outcomes.filter(o => {
    const key = `${o.type}:${o.status}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Height in V_GAP units (for tree centering) ───────────────
function nodeVH(node: CodeNode): number {
  if (node.type === 'flowControl') {
    const fc = node as FlowControlNode
    if (fc.metadata.branches && fc.metadata.branches.length > 0) {
      return Math.max(1, fc.metadata.branches.reduce(
        (sum, b) => sum + Math.max(1, seqVH(b.children)), 0
      ))
    }
  }
  return 1
}

function seqVH(nodes: CodeNode[]): number {
  if (nodes.length === 0) return 1
  return Math.max(1, ...nodes.map(nodeVH))
}

// ─────────────────────────────────────────────────────────────
// LAYOUT CONTEXT
// ─────────────────────────────────────────────────────────────
interface LayoutCtx {
  nodeLayer: SVGGElement
  edgeLayer: SVGGElement
  regionLayer: SVGGElement
  allNodes: GaiaNode[]
  allEdges: GaiaEdge[]
  allRegions: GaiaRegion[]
}

function addNode(ctx: LayoutCtx, gNode: GaiaNode, x: number, y: number, region?: GaiaRegion | null): GaiaNode {
  gNode.setPosition(x, y)
  ctx.nodeLayer.appendChild(gNode)
  ctx.allNodes.push(gNode)
  if (region) region.adopt(gNode)
  return gNode
}

function addEdge(ctx: LayoutCtx, src: GaiaNode | GaiaRegion, tgt: GaiaNode | GaiaRegion, label?: string): GaiaEdge {
  const e = createEdge(src, tgt, 'sync', label)
  ctx.edgeLayer.appendChild(e)
  ctx.allEdges.push(e as GaiaEdge)
  return e as GaiaEdge
}

// ─────────────────────────────────────────────────────────────
// EXPANDED MODE — horizontal tree layout
// ─────────────────────────────────────────────────────────────
interface BuildResult { lastNode: GaiaNode | null; endX: number }

/**
 * Lay out a sequence of nodes left-to-right, returning the last placed node and
 * the rightmost X used. `prev` is the node that the first item connects from.
 */
function buildSeq(
  nodes: CodeNode[],
  x: number,
  cy: number,
  prev: GaiaNode | null,
  region: GaiaRegion | null,
  ctx: LayoutCtx,
): BuildResult {
  let cx = x
  let p = prev
  for (const node of nodes) {
    const r = buildOne(node, cx, cy, p, region, ctx, undefined)
    p = r.lastNode
    cx = r.endX + H_GAP
  }
  return { lastNode: p, endX: cx - H_GAP }
}

/**
 * Lay out a single CodeNode. For flowControl, branches fan out vertically.
 * `edgeLabel` is applied on the edge from `prev` → this node (used for branch labels).
 */
function buildOne(
  node: CodeNode,
  x: number,
  cy: number,
  prev: GaiaNode | null,
  region: GaiaRegion | null,
  ctx: LayoutCtx,
  edgeLabel?: string,
): BuildResult {
  switch (node.type) {
    case 'function': {
      const fn = node as FunctionNode
      const gNode = createFunctionNode(node.id, fn.name.slice(0, 22))
      addNode(ctx, gNode, x, cy, region)
      if (prev) addEdge(ctx, prev, gNode, edgeLabel)
      const r = buildSeq(node.children, x + H_GAP, cy, gNode, region, ctx)
      return { lastNode: r.lastNode ?? gNode, endX: r.endX }
    }

    case 'flowControl': {
      const fc = node as FlowControlNode
      const label = (fc.metadata.condition ?? fc.metadata.kind ?? 'if').slice(0, 18)
      const ctrl = createControlNode(node.id, label)
      addNode(ctx, ctrl, x, cy, region)
      if (prev) addEdge(ctx, prev, ctrl, edgeLabel)

      if (fc.metadata.branches && fc.metadata.branches.length > 0) {
        const bHeights = fc.metadata.branches.map(b => Math.max(1, seqVH(b.children)))
        const totalH = bHeights.reduce((s, h) => s + h, 0)
        let startY = cy - (totalH / 2) * V_GAP
        let maxEndX = x

        for (let i = 0; i < fc.metadata.branches.length; i++) {
          const branch = fc.metadata.branches[i]
          const bh = bHeights[i]
          const bcy = startY + (bh / 2) * V_GAP

          if (branch.children.length === 0) {
            const stub = createReturnNode(`${node.id}-b${i}-stub`, 'ok')
            addNode(ctx, stub, x + H_GAP, bcy, region)
            addEdge(ctx, ctrl, stub, branch.label)
            maxEndX = Math.max(maxEndX, x + H_GAP)
          } else {
            // Place each branch child; first one gets labeled edge from ctrl
            let bx = x + H_GAP
            let bp: GaiaNode | null = null
            for (let j = 0; j < branch.children.length; j++) {
              const nodesBefore = ctx.allNodes.length
              const r = buildOne(branch.children[j], bx, bcy, bp, region, ctx, undefined)
              // First child of branch: manually add labeled edge from ctrl
              if (j === 0 && ctx.allNodes.length > nodesBefore) {
                addEdge(ctx, ctrl, ctx.allNodes[nodesBefore], branch.label)
              }
              bp = r.lastNode
              bx = r.endX + H_GAP
              maxEndX = Math.max(maxEndX, r.endX)
            }
          }

          startY += bh * V_GAP
        }

        // prev remains ctrl — next sequential item connects from ctrl
        return { lastNode: ctrl, endX: maxEndX }
      }

      // No branches: walk children inline
      const r = buildSeq(node.children, x + H_GAP, cy, ctrl, region, ctx)
      return { lastNode: r.lastNode ?? ctrl, endX: r.endX }
    }

    case 'dbProcess': {
      const db = node as DbProcessNode
      const lbl = (db.metadata.tableId || db.metadata.databaseId || 'db').slice(0, 18)
      const gNode = createFunctionNode(node.id, lbl)
      addNode(ctx, gNode, x, cy, region)
      if (prev) addEdge(ctx, prev, gNode, db.metadata.operation ?? edgeLabel)
      return { lastNode: gNode, endX: x }
    }

    case 'return': {
      const ret = node as ReturnNode
      const st = (ret.metadata.httpStatus ?? 200) >= 400 ? 'err' : 'ok'
      const code = ret.metadata.httpStatus ? String(ret.metadata.httpStatus) : undefined
      const gNode = createReturnNode(node.id, st, code)
      addNode(ctx, gNode, x, cy, region)
      if (prev) addEdge(ctx, prev, gNode, edgeLabel)
      return { lastNode: gNode, endX: x }
    }

    case 'throw': {
      const thr = node as ThrowNode
      const code = thr.metadata.httpStatus
        ? String(thr.metadata.httpStatus)
        : thr.metadata.errorClass.slice(0, 8)
      const gNode = createReturnNode(node.id, 'err', code)
      addNode(ctx, gNode, x, cy, region)
      if (prev) addEdge(ctx, prev, gNode, edgeLabel)
      return { lastNode: gNode, endX: x }
    }

    default:
      return { lastNode: prev, endX: x - H_GAP }
  }
}

function buildExpandedFlow(
  endpoint: NonNullable<ReturnType<typeof useCurrentEndpoint>>,
  ctx: LayoutCtx,
  W: number,
  H: number,
) {
  const cy = H / 2
  const epNode = createEndpointNode(endpoint.id, endpoint.metadata.method, endpoint.metadata.path)
  addNode(ctx, epNode, START_X, cy)

  let prev: GaiaNode = epNode
  let x = START_X + H_GAP

  for (const child of endpoint.children) {
    if (child.type === 'function') {
      const fn = child as FunctionNode
      const region = createFunctionRegion(child.id, fn.name)
      ctx.regionLayer.appendChild(region)
      ctx.allRegions.push(region)

      // Entry pill inside region
      const entry = createFunctionNode(child.id + '-entry', fn.name.slice(0, 22))
      addNode(ctx, entry, x, cy, region)
      addEdge(ctx, prev, entry)

      const r = buildSeq(fn.children, x + H_GAP, cy, entry, region, ctx)
      region.reflow()

      prev = r.lastNode ?? entry
      x = r.endX + H_GAP * 2
    }
  }

  // Ensure at least one return node exists
  const hasReturn = ctx.allNodes.some(n =>
    n.classList.contains('gn-node--status-ok') || n.classList.contains('gn-node--status-err')
  )
  if (!hasReturn) {
    const ret = createReturnNode('ret-syn', 'ok', '200')
    addNode(ctx, ret, x, cy)
    addEdge(ctx, prev, ret)
  }
}

// ─────────────────────────────────────────────────────────────
// SHORT MODE — function pill + control diamond + outcomes
// ─────────────────────────────────────────────────────────────
function buildShortFlow(
  endpoint: NonNullable<ReturnType<typeof useCurrentEndpoint>>,
  ctx: LayoutCtx,
  W: number,
  H: number,
) {
  const handlers = endpoint.children.filter(c => c.type === 'function') as FunctionNode[]

  const layouts = handlers.map(fn => {
    const outcomes = dedupeOutcomes(collectOutcomes(fn.children))
    return { fn, outcomes, rows: Math.max(1, outcomes.length) }
  })

  const totalRows = layouts.reduce((s, l) => s + l.rows, 0)
  const epY = H / 2

  const epNode = createEndpointNode(endpoint.id, endpoint.metadata.method, endpoint.metadata.path)
  addNode(ctx, epNode, START_X, epY)

  if (layouts.length === 0) {
    const ret = createReturnNode('ret-syn', 'ok', '200')
    addNode(ctx, ret, START_X + H_GAP, epY)
    addEdge(ctx, epNode, ret)
    return
  }

  let currentY = epY - (totalRows * V_GAP) / 2 + layouts[0].rows * V_GAP / 2
  let prev: GaiaNode = epNode

  for (const { fn, outcomes, rows } of layouts) {
    const fnY = currentY

    const fnNode = createFunctionNode(fn.id, fn.name.slice(0, 22))
    addNode(ctx, fnNode, START_X + H_GAP, fnY)
    addEdge(ctx, prev, fnNode)

    if (outcomes.length === 0) {
      prev = fnNode
    } else if (outcomes.length === 1) {
      const o = outcomes[0]
      const out = createReturnNode(`${fn.id}-out-0`, o.type === 'throw' ? 'err' : 'ok', o.status)
      addNode(ctx, out, START_X + H_GAP * 2, fnY)
      addEdge(ctx, fnNode, out)
      prev = fnNode
    } else {
      // Multiple outcomes → control diamond + fanned returns
      const ctrl = createControlNode(`${fn.id}-ctrl`, `${outcomes.length} paths`)
      addNode(ctx, ctrl, START_X + H_GAP * 2, fnY)
      addEdge(ctx, fnNode, ctrl)

      const outStartY = fnY - (outcomes.length - 1) / 2 * V_GAP
      for (let i = 0; i < outcomes.length; i++) {
        const o = outcomes[i]
        const out = createReturnNode(`${fn.id}-out-${i}`, o.type === 'throw' ? 'err' : 'ok', o.status)
        addNode(ctx, out, START_X + H_GAP * 3, outStartY + i * V_GAP)
        addEdge(ctx, ctrl, out, o.status)
      }
      prev = ctrl
    }

    currentY += rows * V_GAP
  }
}

// ─────────────────────────────────────────────────────────────
// REACT COMPONENT
// ─────────────────────────────────────────────────────────────
export function EndpointView() {
  const endpoint = useCurrentEndpoint()
  const { selectNode, selectedNodeId } = useTopologyStore()
  const svgRef = useRef<SVGSVGElement>(null)
  const zpRef = useRef<ZoomPanHandle | null>(null)
  const [zoom, setZoom] = useState(1)
  const [detailInfo, setDetailInfo] = useState<NodeDetailInfo | null>(null)
  const [density, setDensity] = useState<Density>(() => {
    try { return (localStorage.getItem('gaia-density') as Density) || 'short' } catch { return 'short' }
  })

  const handleDensity = useCallback((d: Density) => {
    setDensity(d)
    try { localStorage.setItem('gaia-density', d) } catch {}
  }, [])

  useEffect(() => {
    if (!endpoint || !svgRef.current) return
    const svg = svgRef.current

    while (svg.firstChild) svg.removeChild(svg.firstChild)
    svg.appendChild(createGraphDefs())

    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bgRect.setAttribute('class', 'gn-bg')
    bgRect.setAttribute('x', '-5000'); bgRect.setAttribute('y', '-5000')
    bgRect.setAttribute('width', '10000'); bgRect.setAttribute('height', '10000')
    bgRect.setAttribute('fill', 'transparent')
    svg.appendChild(bgRect)

    const regionLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const edgeLayer   = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const nodeLayer   = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    svg.appendChild(regionLayer)
    svg.appendChild(edgeLayer)
    svg.appendChild(nodeLayer)

    const ctx: LayoutCtx = { nodeLayer, edgeLayer, regionLayer, allNodes: [], allEdges: [], allRegions: [] }

    const svgRect = svg.getBoundingClientRect()
    const W = svgRect.width || 1200
    const H = svgRect.height || 800

    if (density === 'collapsed') {
      const ep = createEndpointNode(endpoint.id, endpoint.metadata.method, endpoint.metadata.path)
      addNode(ctx, ep, W / 2, H / 2)
    } else if (density === 'short') {
      buildShortFlow(endpoint, ctx, W, H)
    } else {
      buildExpandedFlow(endpoint, ctx, W, H)
    }

    // Drag
    ctx.allNodes.forEach(n => {
      enableDrag(n, svg, () => { ctx.allEdges.forEach(e => e.update()) })
    })

    // Re-measure edge path lengths after DOM layout for correct wave animation
    requestAnimationFrame(() => { ctx.allEdges.forEach(e => e.update()) })

    // Click
    svg.addEventListener('gn-click', (e: Event) => {
      const nodeEl = (e.target as Element)?.closest('[data-id]') as SVGGElement | null
      const nodeId = nodeEl?.getAttribute('data-id')
      if (!nodeId) return
      const gNode = ctx.allNodes.find(n => n.getAttribute('data-id') === nodeId)
      if (!gNode) return
      triggerTap(gNode)
      selectNode(selectedNodeId === nodeId ? null : nodeId)
      gNode.__edges.forEach(edge => { if (edge.__source === gNode) edge.fire() })
    })

    // Dblclick
    svg.addEventListener('gn-dblclick', (e: Event) => {
      const nodeEl = (e.target as Element)?.closest('[data-id]') as SVGGElement | null
      const nodeId = nodeEl?.getAttribute('data-id')
      if (!nodeId) return
      const kind = nodeEl?.getAttribute('data-type') ?? 'node'
      const labelEl = nodeEl?.querySelector('text.gn-node__title, text.gn-node__code')
      setDetailInfo({ id: nodeId, label: labelEl?.textContent ?? nodeId, kind })
    })

    // Zoom/pan
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    const zp = enableZoomPan(svg, nodeLayer, () => {
      selectNode(null)
      ctx.allEdges.forEach(e => { e.classList.remove('is-lit', 'is-firing') })
    })
    zpRef.current = zp
    setTimeout(() => { zp.fitContent(80); setZoom(zp.getScale()) }, 150)

    return () => { zp.destroy() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, density])

  // Selection sync
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    svg.querySelectorAll('.gn-node--selected').forEach(n => n.classList.remove('gn-node--selected'))
    svg.querySelectorAll('.is-lit, .is-firing').forEach(e => e.classList.remove('is-lit', 'is-firing'))
    if (selectedNodeId) {
      svg.querySelector(`[data-id="${selectedNodeId}"]`)?.classList.add('gn-node--selected')
    }
  }, [selectedNodeId])

  const handleFit    = useCallback(() => zpRef.current?.fitContent(80), [])
  const handleZoomIn  = useCallback(() => { zpRef.current?.zoomIn();  setZoom(zpRef.current?.getScale() ?? 1) }, [])
  const handleZoomOut = useCallback(() => { zpRef.current?.zoomOut(); setZoom(zpRef.current?.getScale() ?? 1) }, [])

  if (!endpoint) return null

  return (
    <div className={styles.container}>
      <svg ref={svgRef} className={styles.svg} viewBox="0 0 1200 800" />

      <div className={styles.densityBar}>
        <span className={styles.densityLabel}>density:</span>
        {DENSITY_OPTIONS.map(opt => (
          <button
            key={opt.k}
            className={`${styles.densityBtn} ${density === opt.k ? styles.densityBtnActive : ''}`}
            onClick={() => handleDensity(opt.k)}
          >
            <span>{opt.icon}</span>
            <span>{opt.label}</span>
          </button>
        ))}
      </div>

      <ZoomControls zoom={zoom} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onFit={handleFit} />
      {detailInfo && <NodeDetailPanel info={detailInfo} onClose={() => setDetailInfo(null)} />}
    </div>
  )
}
