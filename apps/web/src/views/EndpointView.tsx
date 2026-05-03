import React, { useEffect, useRef, useState, useCallback } from 'react'
import { ZoomControls } from '@/shell/ZoomControls'
import { useCurrentEndpoint, useTopologyStore, type ExportGraph, type ExportNode, type ExportEdge } from '@/store/topologyStore'
import { NodeDetailPanel, type NodeDetailInfo } from '@/detail/NodeDetailPanel'
import { DocModal, type DocTarget } from '@/detail/DocModal'
import { SnapshotsModal } from '@/detail/SnapshotsModal'
import { SimulatorPanel } from './SimulatorPanel'
import { WalkPathPanel } from './WalkPathPanel'
import type { WalkResult } from '@/sim/compute-walk-order'
import type { SimulationResult } from '@/api/types'
import {
  createEndpointNode, createFunctionNode, createControlNode,
  createReturnNode, createThrowNode, createFunctionRegion, createDatabaseNode,
  createDataNode, createProcessNode,
  createEdge, createGraphDefs,
  enableDrag, enableZoomPan, triggerTap, setNodeSubtitle,
  type GaiaNode, type GaiaRegion, type GaiaEdge, type ZoomPanHandle,
} from '@/graph/gaiaNodes'
import type {
  CodeNode, EndpointNode as EndpointCodeNode,
  FlowControlNode, DbProcessNode, ReturnNode, ThrowNode, FunctionNode, CallNode,
  DataNode, ProcessNode,
} from '@/types/topology'
import styles from './EndpointView.module.css'

export type Density = 'expanded' | 'short' | 'collapsed'

const DENSITY_OPTIONS: { k: Density; icon: string; label: string }[] = [
  { k: 'expanded',  icon: '▦', label: 'expanded' },
  { k: 'short',     icon: '▤', label: 'short' },
  { k: 'collapsed', icon: '▪', label: 'collapsed' },
]

// ── Layout constants ───────────────────────────────────────
const H_GAP = 240  // horizontal gap between columns
const V_GAP = 90   // vertical gap between rows (horizontal mode)
const V_STEP = 120 // vertical step between rows (vertical mode)
const START_X = 80 // left edge for endpoint node
const MAX_DEPTH = 12 // max levels of inline function expansion (cycles guarded by code-graph projection)

// ─────────────────────────────────────────────────────────────
// OUTCOME HELPERS (for short mode)
// ─────────────────────────────────────────────────────────────
interface Outcome {
  type: 'return' | 'throw'
  status: string
  errorClass?: string  // populated for throws so the chip can render as `createThrowNode`
  httpStatus?: number  // populated for throws when inferable
}

function collectOutcomes(nodes: CodeNode[]): Outcome[] {
  const out: Outcome[] = []
  for (const n of nodes) {
    if (n.type === 'return') {
      const r = n as ReturnNode
      out.push({ type: 'return', status: String(r.metadata.httpStatus ?? 200) })
    } else if (n.type === 'throw') {
      const t = n as ThrowNode
      const status = String(t.metadata.httpStatus ?? t.metadata.errorClass.slice(0, 12))
      out.push({
        type: 'throw',
        status,
        errorClass: t.metadata.errorClass,
        httpStatus: t.metadata.httpStatus,
      })
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
    // Dedupe key includes errorClass so two distinct throw classes with the
    // same httpStatus are still shown as separate chips.
    const key = `${o.type}:${o.status}:${o.errorClass ?? ''}`
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
  /** Service functions available for inline resolution of `call` nodes */
  functions: FunctionNode[]
  /** Maps gaia node data-id → CodeNode for the detail panel */
  codeNodeMap: Map<string, CodeNode>
  /** Current nesting depth for inline resolution (stops at 1) */
  resolveDepth: number
}

function addNode(
  ctx: LayoutCtx, gNode: GaiaNode, x: number, y: number,
  region?: GaiaRegion | null, codeNode?: CodeNode,
): GaiaNode {
  gNode.setPosition(x, y)
  ctx.nodeLayer.appendChild(gNode)
  ctx.allNodes.push(gNode)
  if (region) region.adopt(gNode)
  if (codeNode) ctx.codeNodeMap.set(gNode.getAttribute('data-id') ?? '', codeNode)
  return gNode
}

function addEdge(ctx: LayoutCtx, src: GaiaNode | GaiaRegion, tgt: GaiaNode | GaiaRegion, label?: string): GaiaEdge {
  const e = createEdge(src, tgt, 'sync', label)
  ctx.edgeLayer.appendChild(e)
  ctx.allEdges.push(e as GaiaEdge)
  return e as GaiaEdge
}

// ─────────────────────────────────────────────────────────────
// HANDLER RESOLUTION
// Endpoint children in Go-extracted topologies are `call` nodes
// (e.g. r.Get("/path", c.person.GetPersonByTaxId)). Resolve them
// to the actual FunctionNode in svc.functions by name suffix match.
// ─────────────────────────────────────────────────────────────
function resolveHandlerFn(call: CallNode, functions: FunctionNode[]): FunctionNode | null {
  // Prefer the inline `function` child injected by the deep flow projection
  // (code-graph). It carries the fully expanded body, while `svc.functions`
  // may still hold the shallow extractor version.
  const inline = call.children.find(c => c.type === 'function') as FunctionNode | undefined
  if (inline) return inline

  if (call.metadata.resolvedTo) {
    const found = functions.find(f => f.id === call.metadata.resolvedTo)
    if (found) return found
  }
  // Find last argument that looks like a dotted function reference (no spaces, no quotes)
  const args = call.metadata.arguments ?? []
  for (let i = args.length - 1; i >= 0; i--) {
    const arg = args[i]
    if (arg && !arg.includes(' ') && arg[0] !== '"' && arg[0] !== "'" && arg.includes('.')) {
      const leaf = arg.split('.').pop()!
      const found = functions.find(f => {
        const fLeaf = f.name.split('.').pop()!
        return fLeaf === leaf || f.name.endsWith(leaf)
      })
      if (found) return found
    }
  }
  return null
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
    if (node.type === 'return' || node.type === 'throw') break
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
      setNodeSubtitle(gNode, fn.metadata?.llm?.humanName)
      addNode(ctx, gNode, x, cy, region, fn)
      if (prev) addEdge(ctx, prev, gNode, edgeLabel)
      const r = buildSeq(node.children, x + H_GAP, cy, gNode, region, ctx)
      return { lastNode: r.lastNode ?? gNode, endX: r.endX }
    }

    case 'flowControl': {
      const fc = node as FlowControlNode
      const label = (fc.metadata.condition ?? fc.metadata.kind ?? 'if').slice(0, 18)
      const ctrl = createControlNode(node.id, label)
      addNode(ctx, ctrl, x, cy, region, fc)
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
            let bx = x + H_GAP
            let bp: GaiaNode | null = null
            for (let j = 0; j < branch.children.length; j++) {
              const nodesBefore = ctx.allNodes.length
              const r = buildOne(branch.children[j], bx, bcy, bp, region, ctx, undefined)
              if (j === 0 && ctx.allNodes.length > nodesBefore) {
                addEdge(ctx, ctrl, ctx.allNodes[nodesBefore], branch.label)
              }
              bp = r.lastNode
              bx = r.endX + H_GAP
              maxEndX = Math.max(maxEndX, r.endX)
              const bt = branch.children[j].type
              if (bt === 'return' || bt === 'throw') break
            }
          }

          startY += bh * V_GAP
        }

        return { lastNode: ctrl, endX: maxEndX }
      }

      const r = buildSeq(node.children, x + H_GAP, cy, ctrl, region, ctx)
      return { lastNode: r.lastNode ?? ctrl, endX: r.endX }
    }

    case 'call': {
      const c = node as CallNode
      // Inline-expand resolved calls as sub-regions
      if (c.metadata.resolvedTo && ctx.resolveDepth < MAX_DEPTH) {
        const inlineFn = c.children.find(ch => ch.type === 'function') as FunctionNode | undefined
        const fn = inlineFn ?? ctx.functions.find(f => f.id === c.metadata.resolvedTo)
        if (fn) {
          const subCtx: LayoutCtx = { ...ctx, resolveDepth: ctx.resolveDepth + 1 }
          const subRegion = createFunctionRegion(fn.id + '-sub-' + c.id, fn.name)
          ctx.regionLayer.appendChild(subRegion)
          ctx.allRegions.push(subRegion)
          const entry = createFunctionNode(fn.id + '-e-' + c.id, fn.name.slice(0, 22))
          setNodeSubtitle(entry, fn.metadata?.llm?.humanName)
          addNode(subCtx, entry, x, cy, subRegion, c)
          if (prev) addEdge(ctx, prev, entry, edgeLabel)
          const r = buildSeq(fn.children, x + H_GAP, cy, entry, subRegion, subCtx)
          subRegion.reflow()
          return { lastNode: r.lastNode ?? entry, endX: r.endX }
        }
      }
      const label = (c.metadata.callee ?? c.name ?? 'call').slice(0, 22)
      const gNode = createFunctionNode(node.id, label)
      addNode(ctx, gNode, x, cy, region, c)
      if (prev) addEdge(ctx, prev, gNode, edgeLabel)
      return { lastNode: gNode, endX: x }
    }

    case 'dbProcess': {
      const db = node as DbProcessNode
      const lbl = (db.metadata.tableId || db.metadata.databaseId || 'db').slice(0, 18)
      const gNode = createDatabaseNode(node.id, lbl, db.metadata.operation)
      addNode(ctx, gNode, x, cy, region, db)
      if (prev) addEdge(ctx, prev, gNode, db.metadata.operation ?? edgeLabel)
      return { lastNode: gNode, endX: x }
    }

    case 'return': {
      const ret = node as ReturnNode
      const status = ret.metadata.httpStatus
      const st = status !== undefined ? (status >= 400 ? 'err' : 'ok') : 'ok'
      // Show httpStatus if available, otherwise first 12 chars of return value
      const code = status !== undefined
        ? String(status)
        : ret.metadata.value?.replace(/\s+/g, ' ').slice(0, 12) ?? undefined
      const gNode = createReturnNode(node.id, st, code)
      addNode(ctx, gNode, x, cy, region, ret)
      if (prev) addEdge(ctx, prev, gNode, edgeLabel)
      return { lastNode: gNode, endX: x }
    }

    case 'throw': {
      const thr = node as ThrowNode
      const gNode = createThrowNode(node.id, thr.metadata.errorClass, thr.metadata.httpStatus)
      addNode(ctx, gNode, x, cy, region, thr)
      if (prev) addEdge(ctx, prev, gNode, edgeLabel)
      return { lastNode: gNode, endX: x }
    }

    case 'data': {
      const dn = node as DataNode
      // Only show local variable/constant declarations; skip type-level and param nodes
      if (DATA_SKIP_KINDS.has(dn.metadata.kind as string))
        return { lastNode: prev, endX: x - H_GAP }
      if (dn.metadata.scope !== 'local' && dn.metadata.scope !== 'block')
        return { lastNode: prev, endX: x - H_GAP }
      const label = dn.name.slice(0, 24)
      const gNode = createDataNode(node.id, label)
      addNode(ctx, gNode, x, cy, region, dn)
      if (prev) addEdge(ctx, prev, gNode, edgeLabel)
      return { lastNode: gNode, endX: x }
    }

    case 'process': {
      const pn = node as ProcessNode
      const label = (pn.metadata.description ?? pn.name ?? 'process').slice(0, 30)
      const gNode = createProcessNode(node.id, label)
      addNode(ctx, gNode, x, cy, region, pn)
      if (prev) addEdge(ctx, prev, gNode, edgeLabel)
      return { lastNode: gNode, endX: x }
    }

    // Pure noise — skip but don't break the chain
    case 'log':
    case 'telemetry':
    case 'event':
      return { lastNode: prev, endX: x - H_GAP }

    default:
      return { lastNode: prev, endX: x - H_GAP }
  }
}

// ─────────────────────────────────────────────────────────────
// LOOP HOISTING
// The extractor emits DFS post-order: loop body nodes appear
// BEFORE the loop header in the linearized children array.
// groupLoops() scans forward for loop flowControls and pulls
// the preceding (non-boundary) nodes back into a LoopGroup so
// that the header renders first, with body below.
// ─────────────────────────────────────────────────────────────
const LOOP_KINDS = new Set(['for', 'for_in', 'for_of', 'while', 'do_while'])
// DataNode and ProcessNode are rendered; log/telemetry/event remain filtered
const DATA_SKIP_KINDS = new Set(['interface', 'type', 'enum', 'class', 'import', 'export', 'generic', 'parameter'])
const SKIP_TYPES = new Set(['log', 'telemetry', 'event'])

interface LoopGroup { __loop: true; header: FlowControlNode; body: CodeNode[] }
type NodeItem = CodeNode | LoopGroup

function groupLoops(nodes: CodeNode[]): NodeItem[] {
  const filtered = nodes.filter(n => !SKIP_TYPES.has(n.type))
  const result: NodeItem[] = []
  for (const n of filtered) {
    if (n.type !== 'flowControl' || !LOOP_KINDS.has((n as FlowControlNode).metadata.kind)) {
      result.push(n)
      continue
    }
    const fc = n as FlowControlNode
    // Prefer children populated by the extractor (proper nesting)
    if (fc.children.length > 0) {
      result.push({ __loop: true, header: fc, body: fc.children })
      continue
    }
    // Fallback: extract body from preceding siblings (DFS post-order heuristic)
    let bodyStart = result.length
    while (bodyStart > 0) {
      const prev = result[bodyStart - 1]
      if ('__loop' in prev) break
      const pn = prev as CodeNode
      if (pn.type === 'return' || pn.type === 'throw') break
      if (pn.type === 'call' && (pn as CallNode).metadata.resolvedTo) break
      bodyStart--
    }
    const body = result.splice(bodyStart) as CodeNode[]
    result.push({ __loop: true, header: fc, body })
  }
  return result
}

// ─────────────────────────────────────────────────────────────
// THROW ANALYSIS — checks if a function (or any it calls) can throw
// ─────────────────────────────────────────────────────────────
function fnCanThrow(fn: FunctionNode, functions: FunctionNode[], visited = new Set<string>()): boolean {
  if (visited.has(fn.id)) return false
  visited.add(fn.id)
  const check = (nodes: CodeNode[]): boolean => {
    for (const n of nodes) {
      if (n.type === 'throw') return true
      if (n.type === 'call') {
        const c = n as CallNode
        if (c.metadata.resolvedTo) {
          const callee = functions.find(f => f.id === c.metadata.resolvedTo)
          if (callee && fnCanThrow(callee, functions, visited)) return true
        }
      }
      const fc = n as FlowControlNode
      if (fc.metadata?.branches?.some(b => check(b.children))) return true
      if (n.children?.length && check(n.children)) return true
    }
    return false
  }
  return check(fn.children)
}

function fnThrowStatuses(fn: FunctionNode, functions: FunctionNode[], visited = new Set<string>()): number[] {
  if (visited.has(fn.id)) return []
  visited.add(fn.id)
  const statuses: number[] = []
  const collect = (nodes: CodeNode[]) => {
    for (const n of nodes) {
      if (n.type === 'throw' && (n as ThrowNode).metadata.httpStatus)
        statuses.push((n as ThrowNode).metadata.httpStatus!)
      if (n.type === 'call') {
        const c = n as CallNode
        if (c.metadata.resolvedTo) {
          const callee = functions.find(f => f.id === c.metadata.resolvedTo)
          if (callee) statuses.push(...fnThrowStatuses(callee, functions, visited))
        }
      }
      const fc = n as FlowControlNode
      if (fc.metadata?.branches) fc.metadata.branches.forEach(b => collect(b.children))
      if (n.children?.length) collect(n.children)
    }
  }
  collect(fn.children)
  return [...new Set(statuses)]
}

// ─────────────────────────────────────────────────────────────
// VERTICAL LAYOUT — used inside function regions
// Nodes stack top-to-bottom at fixed X; resolved calls expand
// their body to the right via a horizontal sub-region.
// ─────────────────────────────────────────────────────────────
interface VResult { lastNode: GaiaNode | null; endX: number; endY: number }

function buildSeqV(
  nodes: CodeNode[],
  x: number,
  startY: number,
  prev: GaiaNode | null,
  region: GaiaRegion | null,
  ctx: LayoutCtx,
): VResult {
  let curY = startY
  let p = prev
  let maxEndX = x

  const items = groupLoops(nodes)
  // Edge label to apply on the NEXT item's incoming edge (used after if look-ahead)
  let nextEdgeLabel: string | undefined = undefined

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const eLabel = nextEdgeLabel
    nextEdgeLabel = undefined

    // ── LoopGroup: header first → body below → back-edge ──────
    if ('__loop' in item) {
      const lg = item
      const label = (lg.header.metadata.condition ?? lg.header.metadata.kind ?? 'loop').slice(0, 18)
      const ctrl = createControlNode(lg.header.id, label)
      addNode(ctx, ctrl, x, curY, region, lg.header)
      if (p) addEdge(ctx, p, ctrl, eLabel)
      curY += V_STEP

      const br = buildSeqV(lg.body, x + 40, curY, ctrl, region, ctx)
      maxEndX = Math.max(maxEndX, br.endX)

      if (br.lastNode && br.lastNode !== ctrl) {
        const backEdge = addEdge(ctx, br.lastNode, ctrl, '↺')
        backEdge.classList.add('is-loop-back')
      }

      p = ctrl
      curY = br.endY + V_STEP
      continue
    }

    const node = item as CodeNode

    // ── Resolved call: create sub-region to the right ─────────
    if (node.type === 'call') {
      const c = node as CallNode
      const label = (c.metadata.callee ?? c.name ?? 'call').slice(0, 22)
      const callNode = createFunctionNode(node.id, label)
      if (c.metadata.resolvedTo) {
        const rf = ctx.functions.find(f => f.id === c.metadata.resolvedTo)
        setNodeSubtitle(callNode, rf?.metadata?.llm?.humanName)
      }
      addNode(ctx, callNode, x, curY, region, c)
      if (p) addEdge(ctx, p, callNode, eLabel)
      p = callNode
      maxEndX = Math.max(maxEndX, x)

      if (c.metadata.resolvedTo && ctx.resolveDepth < MAX_DEPTH) {
        // Prefer the inline `function` child (deep projection); fall back to
        // svc.functions lookup for legacy/shallow topologies.
        const inlineFn = c.children.find(ch => ch.type === 'function') as FunctionNode | undefined
        const fn = inlineFn ?? ctx.functions.find(f => f.id === c.metadata.resolvedTo)
        if (fn) {
          const subCtx: LayoutCtx = { ...ctx, resolveDepth: ctx.resolveDepth + 1 }
          const hash = fn.id.split(':')[1] ?? fn.id
          const subRegion = createFunctionRegion(`sr-${hash}-${node.id.split(':')[1]}`, fn.name)
          ctx.regionLayer.appendChild(subRegion)
          ctx.allRegions.push(subRegion)
          const entry = createFunctionNode(`e-${hash}-${node.id.split(':')[1]}`, fn.name.slice(0, 22))
          setNodeSubtitle(entry, fn.metadata?.llm?.humanName)
          addNode(subCtx, entry, x + H_GAP, curY, subRegion, fn)
          addEdge(ctx, callNode, entry)
          // Always lay out sub-functions vertically so deep nodes stay on-screen
          const { endX: fnEndX, endY: fnEndY } = buildSeqV(
            fn.children, x + H_GAP, curY + V_STEP, entry, subRegion, subCtx,
          )
          subRegion.reflow()
          // Adopt sub-region into parent region so parent expands to contain it
          if (region) region.adopt(subRegion as unknown as GaiaNode)
          maxEndX = Math.max(maxEndX, fnEndX)
          const subBottom = subRegion.__y + subRegion.__bounds.h / 2
          curY = Math.max(fnEndY, subBottom) + V_STEP

          // If the called function can throw, add an error-check control node
          if (fnCanThrow(fn, ctx.functions)) {
            const errId = `ec-${node.id.split(':')[1]}-${fn.id.split(':')[1]}`
            const errCtrl = createControlNode(errId, 'error?')
            addNode(ctx, errCtrl, x, curY, region)
            addEdge(ctx, callNode, errCtrl)

            const statuses = fnThrowStatuses(fn, ctx.functions)
            const errCode = statuses.length > 0 ? String(statuses[0]) : 'err'
            const errExit = createReturnNode(`ex-${errId}`, 'err', errCode)
            addNode(ctx, errExit, x + H_GAP, curY, region)
            addEdge(ctx, errCtrl, errExit, 'error')
            maxEndX = Math.max(maxEndX, x + H_GAP)

            p = errCtrl
            curY += V_STEP
          }
          continue
        }
      }

      curY += V_STEP
      continue
    }

    // ── Non-loop flowControl: diamond + branches ──────────────
    if (node.type === 'flowControl') {
      const fc = node as FlowControlNode
      const label = (fc.metadata.condition ?? fc.metadata.kind ?? 'if').slice(0, 18)
      const ctrl = createControlNode(node.id, label)
      addNode(ctx, ctrl, x, curY, region, fc)
      if (p) addEdge(ctx, p, ctrl, eLabel)

      const branchesWithContent = fc.metadata.branches?.filter(b => b.children.length > 0) ?? []

      if (branchesWithContent.length > 0) {
        // Standard: fan branches with content to the right
        let afterY = curY + V_GAP
        const bHeights = branchesWithContent.map(b => Math.max(1, seqVH(b.children)))
        const totalH = bHeights.reduce((s, h) => s + h, 0)
        let branchY = curY - (totalH / 2) * V_GAP

        for (let bi = 0; bi < branchesWithContent.length; bi++) {
          const branch = branchesWithContent[bi]
          const bh = bHeights[bi]
          const bcy = branchY + (bh / 2) * V_GAP

          let bx = x + H_GAP
          let bp: GaiaNode | null = null
          for (let j = 0; j < branch.children.length; j++) {
            const nbefore = ctx.allNodes.length
            const r = buildOne(branch.children[j], bx, bcy, bp, region, ctx, undefined)
            if (j === 0 && ctx.allNodes.length > nbefore) {
              addEdge(ctx, ctrl, ctx.allNodes[nbefore], branch.label)
            }
            bp = r.lastNode
            bx = r.endX + H_GAP
            maxEndX = Math.max(maxEndX, r.endX)
            const bt = branch.children[j].type
            if (bt === 'return' || bt === 'throw') break
          }
          afterY = Math.max(afterY, branchY + bh * V_GAP)
          branchY += bh * V_GAP
        }
        p = ctrl
        curY = afterY + V_STEP
      } else if (node.children.length > 0) {
        // Children properly nested by extractor — render them to the right
        const r = buildSeq(node.children, x + H_GAP, curY, ctrl, region, ctx)
        maxEndX = Math.max(maxEndX, r.endX)
        p = ctrl
        curY += V_STEP
      } else if ((fc.metadata.branches?.length ?? 0) > 0) {
        // Branches labeled but empty, no children: extractor placed branch body as siblings.
        // Look ahead: if next sibling is terminal (return/throw) treat it as 'then' arm.
        const peekItem = i + 1 < items.length ? items[i + 1] : null
        const peek = (peekItem && !('__loop' in peekItem)) ? peekItem as CodeNode : null
        const thenLabel = fc.metadata.branches![0]?.label ?? 'then'

        if (peek && (peek.type === 'return' || peek.type === 'throw')) {
          i++ // consume the peek node as the 'then' arm
          const thenR = buildOne(peek, x + H_GAP, curY, null, region, ctx, undefined)
          if (thenR.lastNode) addEdge(ctx, ctrl, thenR.lastNode, thenLabel)
          maxEndX = Math.max(maxEndX, thenR.endX)
          nextEdgeLabel = 'else'
        }
        p = ctrl
        curY += V_STEP
      } else {
        p = ctrl
        curY += V_STEP
      }
      continue
    }

    // ── All other nodes (return, throw, dbProcess, function) ──
    const r = buildOne(node, x, curY, p, region, ctx, eLabel)
    if (r.lastNode !== p) {
      p = r.lastNode
      maxEndX = Math.max(maxEndX, r.endX)
      curY += V_STEP
      // return/throw terminate this branch — subsequent siblings are unreachable
      if (node.type === 'return' || node.type === 'throw') break
    }
  }

  return { lastNode: p, endX: maxEndX, endY: curY }
}

function buildExpandedFlow(
  endpoint: NonNullable<ReturnType<typeof useCurrentEndpoint>>,
  ctx: LayoutCtx,
  W: number,
  H: number,
  functions: FunctionNode[],
) {
  // Ensure functions and depth are set on ctx for this flow
  ctx.functions = functions
  ctx.resolveDepth = 0

  const cy = H / 2
  const epNode = createEndpointNode(endpoint.id, endpoint.metadata.method, endpoint.metadata.path)
  setNodeSubtitle(epNode, endpoint.metadata.llm?.humanName)
  addNode(ctx, epNode, START_X, cy, null, endpoint as unknown as EndpointCodeNode)

  let prev: GaiaNode = epNode
  let x = START_X + H_GAP

  // Helper: build a handler region using vertical internal layout
  const renderHandler = (fn: FunctionNode) => {
    const region = createFunctionRegion(fn.id, fn.name)
    ctx.regionLayer.appendChild(region)
    ctx.allRegions.push(region)
    const entry = createFunctionNode(fn.id + '-entry', fn.name.slice(0, 22))
    setNodeSubtitle(entry, fn.metadata?.llm?.humanName)
    addNode(ctx, entry, x, cy, region, fn)
    addEdge(ctx, prev, entry)
    const r = buildSeqV(fn.children, x, cy + V_STEP, entry, region, ctx)
    region.reflow()
    prev = r.lastNode ?? entry
    x = Math.max(r.endX, x) + H_GAP * 2
  }

  // When the extractor didn't populate endpoint.children (e.g. NestJS topology),
  // fall back to matching the handler function by shared ID hash.
  if (endpoint.children.length === 0) {
    const epHash = endpoint.id.split(':')[1]
    const matched = functions.find(f => f.id.split(':')[1] === epHash)
    if (matched) renderHandler(matched)
  }

  for (const child of endpoint.children) {
    if (child.type === 'function') {
      renderHandler(child as FunctionNode)
    } else if (child.type === 'call') {
      const c = child as CallNode
      const fn = resolveHandlerFn(c, functions)
      if (fn) {
        renderHandler(fn)
      } else {
        // Only show unresolved calls that look like real service methods (dotted notation).
        // Single-word calls (Number, Query, etc.) are noise — skip them.
        const callee = c.metadata.callee ?? c.name ?? ''
        if (callee.includes('.')) {
          const label = callee.slice(0, 22)
          const gNode = createFunctionNode(child.id, label)
          addNode(ctx, gNode, x, cy, null, c)
          addEdge(ctx, prev, gNode)
          prev = gNode
          x += H_GAP
        }
      }
    } else {
      // Top-level return/throw/flowControl/data emitted by the deep flow
      // projection — render inline so the controller's own outcome is visible.
      const r = buildOne(child, x, cy, prev, null, ctx)
      if (r.lastNode && r.lastNode !== prev) {
        prev = r.lastNode
        x = r.endX + H_GAP
      }
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
  functions: FunctionNode[],
) {
  const handlers: FunctionNode[] = []
  for (const c of endpoint.children) {
    if (c.type === 'function') {
      handlers.push(c as FunctionNode)
    } else if (c.type === 'call') {
      const resolved = resolveHandlerFn(c as CallNode, functions)
      if (resolved) handlers.push(resolved)
    }
  }
  // Fallback for extractors that don't populate endpoint.children (e.g. NestJS):
  // match handler by shared ID hash.
  if (handlers.length === 0 && endpoint.children.length === 0) {
    const epHash = endpoint.id.split(':')[1]
    const matched = functions.find(f => f.id.split(':')[1] === epHash)
    if (matched) handlers.push(matched)
  }

  const layouts = handlers.map(fn => {
    const outcomes = dedupeOutcomes(collectOutcomes(fn.children))
    return { fn, outcomes, rows: Math.max(1, outcomes.length) }
  })

  const totalRows = layouts.reduce((s, l) => s + l.rows, 0)
  const epY = H / 2

  const epNode = createEndpointNode(endpoint.id, endpoint.metadata.method, endpoint.metadata.path)
  setNodeSubtitle(epNode, endpoint.metadata.llm?.humanName)
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
    setNodeSubtitle(fnNode, fn.metadata?.llm?.humanName)
    addNode(ctx, fnNode, START_X + H_GAP, fnY)
    addEdge(ctx, prev, fnNode)

    const outcomeNode = (o: Outcome, id: string): GaiaNode =>
      o.type === 'throw'
        ? createThrowNode(id, o.errorClass ?? 'Error', o.httpStatus)
        : createReturnNode(id, 'ok', o.status)

    if (outcomes.length === 0) {
      prev = fnNode
    } else if (outcomes.length === 1) {
      const out = outcomeNode(outcomes[0], `${fn.id}-out-0`)
      addNode(ctx, out, START_X + H_GAP * 2, fnY)
      addEdge(ctx, fnNode, out)
      prev = fnNode
    } else {
      // Multiple outcomes → control diamond + fanned returns/throws
      const ctrl = createControlNode(`${fn.id}-ctrl`, `${outcomes.length} paths`)
      addNode(ctx, ctrl, START_X + H_GAP * 2, fnY)
      addEdge(ctx, fnNode, ctrl)

      const outStartY = fnY - (outcomes.length - 1) / 2 * V_GAP
      for (let i = 0; i < outcomes.length; i++) {
        const o = outcomes[i]
        const out = outcomeNode(o, `${fn.id}-out-${i}`)
        addNode(ctx, out, START_X + H_GAP * 3, outStartY + i * V_GAP)
        addEdge(ctx, ctrl, out, o.status)
      }
      prev = ctrl
    }

    currentY += rows * V_GAP
  }
}

// ─────────────────────────────────────────────────────────────
// DETAIL PANEL — extract human-readable fields from a CodeNode
// ─────────────────────────────────────────────────────────────
function extractFields(node: CodeNode): { key: string; value: string }[] {
  const f = (k: string, v: string | number | boolean | undefined | null) =>
    v !== undefined && v !== null && v !== '' ? [{ key: k, value: String(v) }] : []
  switch (node.type) {
    case 'endpoint': {
      const ep = node as EndpointCodeNode
      const req = ep.metadata.request
      return [
        ...f('method', ep.metadata.method),
        ...f('path', ep.metadata.path),
        ...f('controller', ep.metadata.controller),
        ...(req.params?.length  ? [{ key: 'params',   value: req.params.map(p => `${p.name}: ${p.type}`).join(', ') }] : []),
        ...(req.query?.length   ? [{ key: 'query',    value: req.query.map(p => `${p.required ? '' : '?'}${p.name}: ${p.type}`).join(', ') }] : []),
        ...(req.body?.length    ? [{ key: 'body',     value: req.body.map(p => `${p.name}: ${p.type}`).join(', ') }] : []),
        ...(req.bodyType        ? [{ key: 'bodyType', value: req.bodyType }] : []),
        ...(req.headers?.length ? [{ key: 'headers',  value: req.headers.map(p => p.name).join(', ') }] : []),
        ...(ep.metadata.responses?.length ? [{ key: 'responses', value: ep.metadata.responses.map(r => r.httpStatus).join(', ') }] : []),
      ]
    }
    case 'function': {
      const fn = node as FunctionNode
      return [
        ...f('name', fn.name),
        ...(fn.metadata.params?.length ? [{ key: 'params', value: fn.metadata.params.map(p => `${p.name}: ${p.type ?? '?'}`).join(', ') }] : []),
        ...f('returns', fn.metadata.returnType),
        ...f('async', fn.metadata.async ? 'true' : null),
        ...(fn.metadata.complexity ? [{ key: 'complexity', value: `cc=${fn.metadata.complexity.cyclomatic} loc=${fn.metadata.complexity.linesOfCode}` }] : []),
      ]
    }
    case 'call': {
      const c = node as CallNode
      return [
        ...f('callee', c.metadata.callee),
        ...(c.metadata.arguments?.length ? [{ key: 'args', value: c.metadata.arguments.join(', ') }] : []),
        ...f('awaited', c.metadata.awaited ? 'true' : null),
        ...f('resolvedTo', c.metadata.resolvedTo),
      ]
    }
    case 'flowControl': {
      const fc = node as FlowControlNode
      return [
        ...f('kind', fc.metadata.kind),
        ...f('condition', fc.metadata.condition),
        ...(fc.metadata.branches?.length ? [{ key: 'branches', value: fc.metadata.branches.map(b => b.label).join(', ') }] : []),
      ]
    }
    case 'return': {
      const ret = node as ReturnNode
      return [
        ...f('kind', ret.metadata.kind),
        ...f('status', ret.metadata.httpStatus),
        ...f('responseType', ret.metadata.responseType),
        ...(ret.metadata.value ? [{ key: 'value', value: ret.metadata.value.slice(0, 120) }] : []),
      ]
    }
    case 'throw': {
      const thr = node as ThrowNode
      return [
        ...f('errorClass', thr.metadata.errorClass),
        ...f('status', thr.metadata.httpStatus),
        ...f('message', thr.metadata.message),
        ...f('propagates', thr.metadata.propagates),
        ...f('kind', thr.metadata.kind),
      ]
    }
    case 'dbProcess': {
      const db = node as DbProcessNode
      return [
        ...f('operation', db.metadata.operation),
        ...f('table', db.metadata.tableId),
        ...f('database', db.metadata.databaseId),
        ...f('orm', db.metadata.orm),
        ...f('conditions', db.metadata.conditions),
        ...(db.metadata.fields?.length ? [{ key: 'fields', value: db.metadata.fields.join(', ') }] : []),
      ]
    }
    case 'data': {
      const dn = node as DataNode
      return [
        ...f('kind', dn.metadata.kind),
        ...f('scope', dn.metadata.scope),
        ...f('type', dn.metadata.dataType),
        ...f('value', dn.metadata.initialValue),
        ...f('mutable', dn.metadata.mutable),
      ]
    }
    case 'process': {
      const pn = node as ProcessNode
      return [
        ...f('kind', pn.metadata.kind),
        ...f('operator', pn.metadata.operator),
        ...f('expression', pn.metadata.description),
      ]
    }
    default:
      return [{ key: 'type', value: node.type }]
  }
}

// ─────────────────────────────────────────────────────────────
// SWIMLANES (Fase 2 #5) — classify nodes by layer, snap Y to bands
// ─────────────────────────────────────────────────────────────
type Layer = 'controller' | 'service' | 'repository' | 'external' | 'misc'

const LAYER_ORDER: Layer[] = ['controller', 'service', 'repository', 'external', 'misc']
const LAYER_LABEL: Record<Layer, string> = {
  controller: 'Controller',
  service: 'Service',
  repository: 'Repository',
  external: 'External',
  misc: 'Misc',
}

function classifyFunction(fn: FunctionNode): Layer {
  const cls = fn.metadata.className ?? ''
  if (/Controller(s)?$|Resource(s)?$|Resolver(s)?$/i.test(cls)) return 'controller'
  if (/Repository|Repositories|Dao$|Repo$|Mapper$/i.test(cls)) return 'repository'
  if (/Service(s)?$|UseCase|Manager$|Handler$|Workflow|Processor$/i.test(cls)) return 'service'
  const decos = fn.metadata.decorators ?? []
  if (decos.some(d => /^(Controller|Resource|Resolver|Get|Post|Put|Delete|Patch)/i.test(d))) return 'controller'
  if (decos.some(d => /^(Repository|Entity)/i.test(d))) return 'repository'
  if (decos.some(d => /^(Injectable|Service)/i.test(d))) return 'service'
  return 'service' // default for functions
}

function classifyByCodeNode(codeNode: CodeNode | undefined): Layer | null {
  if (!codeNode) return null
  switch (codeNode.type) {
    case 'endpoint':   return 'controller'
    case 'middleware': return 'controller'
    case 'dbProcess':  return 'repository'
    case 'externalCall': return 'external'
    case 'function':   return classifyFunction(codeNode as FunctionNode)
    default: return null
  }
}

function inferRegionFn(region: GaiaRegion | null, fns: FunctionNode[]): FunctionNode | null {
  if (!region) return null
  const rid = region.getAttribute('data-id') ?? ''
  for (const f of fns) {
    if (rid === f.id) return f
    if (rid.startsWith(f.id + '-')) return f
    const fHash = f.id.split(':')[1]
    if (fHash && (rid.includes(`sr-${fHash}-`) || rid.includes(`e-${fHash}-`))) return f
  }
  return null
}

function laneFor(
  gNode: GaiaNode,
  codeNodeMap: Map<string, CodeNode>,
  fns: FunctionNode[],
): Layer {
  const id = gNode.getAttribute('data-id') ?? ''
  const direct = classifyByCodeNode(codeNodeMap.get(id))
  if (direct) return direct
  const fn = inferRegionFn(gNode.__parent as GaiaRegion | null, fns)
  if (fn) return classifyFunction(fn)
  return 'misc'
}

interface SwimlaneInfo {
  used: Layer[]
  top: number
  left: number
  width: number
  bandH: number
}

function applySwimlanes(ctx: LayoutCtx, fns: FunctionNode[]): SwimlaneInfo | null {
  if (ctx.allNodes.length === 0) return null

  const layerOf = new Map<GaiaNode, Layer>()
  ctx.allNodes.forEach(n => layerOf.set(n, laneFor(n, ctx.codeNodeMap, fns)))

  const present = new Set(layerOf.values())
  const used = LAYER_ORDER.filter(l => present.has(l))
  if (used.length === 0) return null

  // Bounding box of laid-out nodes
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  ctx.allNodes.forEach(n => {
    const hw = n.__bounds.w / 2, hh = n.__bounds.h / 2
    if (n.__x - hw < minX) minX = n.__x - hw
    if (n.__y - hh < minY) minY = n.__y - hh
    if (n.__x + hw > maxX) maxX = n.__x + hw
    if (n.__y + hh > maxY) maxY = n.__y + hh
  })

  const layoutH = Math.max(600, maxY - minY)
  const bandH = layoutH / used.length
  const top = minY

  // Hide regions — their bboxes don't match scattered children anymore
  ctx.allRegions.forEach(r => { (r as SVGElement).style.display = 'none' })

  // Snap each node to its lane center; offset stacked nodes that share an X column
  used.forEach((lane, i) => {
    const cy = top + i * bandH + bandH / 2
    const nodes = ctx.allNodes.filter(n => layerOf.get(n) === lane)
    nodes.sort((a, b) => a.__x - b.__x)
    let prevX = -Infinity
    let stackIdx = 0
    nodes.forEach(n => {
      let y = cy
      if (n.__x - prevX < 100) {
        stackIdx++
        const off = 28 * Math.ceil(stackIdx / 2) * (stackIdx % 2 === 0 ? -1 : 1)
        y = cy + off
      } else {
        stackIdx = 0
      }
      n.setPosition(n.__x, y)
      prevX = n.__x
    })
  })

  // Recompute edges (path lengths + endpoints) after Y snapping
  ctx.allEdges.forEach(e => e.update())

  return { used, top, left: minX - 80, width: (maxX - minX) + 160, bandH }
}

function renderSwimlaneBands(layer: SVGGElement, info: SwimlaneInfo): void {
  while (layer.firstChild) layer.removeChild(layer.firstChild)
  const SVG_NS = 'http://www.w3.org/2000/svg'
  info.used.forEach((lane, i) => {
    const top = info.top + i * info.bandH
    const g = document.createElementNS(SVG_NS, 'g')
    g.setAttribute('class', `gn-lane gn-lane--${lane}`)
    const rect = document.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', String(info.left))
    rect.setAttribute('y', String(top))
    rect.setAttribute('width', String(info.width))
    rect.setAttribute('height', String(info.bandH))
    rect.setAttribute('class', 'gn-lane__rect')
    g.appendChild(rect)
    const label = document.createElementNS(SVG_NS, 'text')
    label.setAttribute('x', String(info.left + 16))
    label.setAttribute('y', String(top + 24))
    label.setAttribute('class', 'gn-lane__label')
    label.textContent = LAYER_LABEL[lane]
    g.appendChild(label)
    layer.appendChild(g)
  })
}

// ─────────────────────────────────────────────────────────────
// REACT COMPONENT
// ─────────────────────────────────────────────────────────────
export function EndpointView() {
  const endpoint = useCurrentEndpoint()
  const { selectNode, selectedNodeId, activeTopology, activeTopologyId, navigation, setExportReady } = useTopologyStore()

  // Resolve the service that owns this endpoint (for function lookup)
  const svcFunctions: FunctionNode[] = React.useMemo(() => {
    if (!activeTopology || !navigation.endpointId) return []
    const svc = activeTopology.services.find(s =>
      s.endpoints.some(e => e.id === navigation.endpointId)
    )
    return svc?.functions ?? []
  }, [activeTopology, navigation.endpointId])
  const svgRef = useRef<SVGSVGElement>(null)
  const zpRef = useRef<ZoomPanHandle | null>(null)
  const allRegionsRef = useRef<GaiaRegion[] | null>(null)
  const [zoom, setZoom] = useState(1)
  const [detailInfo, setDetailInfo] = useState<NodeDetailInfo | null>(null)
  const [docTarget, setDocTarget] = useState<DocTarget | null>(null)
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [simulatorOpen, setSimulatorOpen] = useState(false)
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null)
  const [walkOpen, setWalkOpen] = useState(false)
  const [walkResult, setWalkResult] = useState<WalkResult | null>(null)
  const [walkActiveNodeId, setWalkActiveNodeId] = useState<string | null>(null)
  const [density, setDensity] = useState<Density>(() => {
    try { return (localStorage.getItem('gaia-density') as Density) || 'expanded' } catch { return 'expanded' }
  })
  const [swimlanes, setSwimlanes] = useState<boolean>(() => {
    try { return localStorage.getItem('gaia-swimlanes') === '1' } catch { return false }
  })

  // Per-endpoint collapsed-region IDs, persisted in localStorage so toggles
  // survive density changes and tab revisits.
  const [collapsedRegions, setCollapsedRegions] = useState<Set<string>>(new Set())
  const collapsedRef = useRef<Set<string>>(collapsedRegions)
  useEffect(() => { collapsedRef.current = collapsedRegions }, [collapsedRegions])

  // Load persisted collapse state when the endpoint changes
  useEffect(() => {
    if (!endpoint) return
    try {
      const raw = localStorage.getItem(`gaia-collapsed:${endpoint.id}`)
      setCollapsedRegions(raw ? new Set(JSON.parse(raw) as string[]) : new Set())
    } catch {
      setCollapsedRegions(new Set())
    }
  }, [endpoint?.id])

  // Persist on change
  useEffect(() => {
    if (!endpoint) return
    try {
      localStorage.setItem(
        `gaia-collapsed:${endpoint.id}`,
        JSON.stringify([...collapsedRegions]),
      )
    } catch {}
  }, [endpoint?.id, collapsedRegions])

  const handleDensity = useCallback((d: Density) => {
    setDensity(d)
    try { localStorage.setItem('gaia-density', d) } catch {}
  }, [])

  const handleSwimlanes = useCallback(() => {
    setSwimlanes(prev => {
      const next = !prev
      try { localStorage.setItem('gaia-swimlanes', next ? '1' : '0') } catch {}
      return next
    })
  }, [])

  const handleCollapseAll = useCallback(() => {
    const regions = allRegionsRef.current
    if (!regions) return
    regions.forEach(r => { if (!r.__collapsed) r.toggleCollapse() })
    const ids = regions.map(r => r.getAttribute('data-id') ?? '').filter(Boolean)
    setCollapsedRegions(new Set(ids))
  }, [])

  const handleExpandAll = useCallback(() => {
    const regions = allRegionsRef.current
    if (!regions) return
    regions.forEach(r => { if (r.__collapsed) r.toggleCollapse() })
    setCollapsedRegions(new Set())
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
    bgRect.addEventListener('click', () => selectNode(null))
    svg.appendChild(bgRect)

    const bgLayer     = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const regionLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const edgeLayer   = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const nodeLayer   = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    bgLayer.setAttribute('class', 'gn-lane-bg')
    svg.appendChild(bgLayer)
    svg.appendChild(regionLayer)
    svg.appendChild(edgeLayer)
    svg.appendChild(nodeLayer)

    const codeNodeMap = new Map<string, CodeNode>()
    const ctx: LayoutCtx = {
      nodeLayer, edgeLayer, regionLayer,
      allNodes: [], allEdges: [], allRegions: [],
      functions: svcFunctions, codeNodeMap, resolveDepth: 0,
    }

    const svgRect = svg.getBoundingClientRect()
    const W = svgRect.width || 1200
    const H = svgRect.height || 800

    if (density === 'collapsed') {
      const ep = createEndpointNode(endpoint.id, endpoint.metadata.method, endpoint.metadata.path)
      setNodeSubtitle(ep, endpoint.metadata.llm?.humanName)
      addNode(ctx, ep, W / 2, H / 2, null, endpoint as unknown as EndpointCodeNode)
    } else if (density === 'short') {
      buildShortFlow(endpoint, ctx, W, H, svcFunctions)
    } else {
      buildExpandedFlow(endpoint, ctx, W, H, svcFunctions)
    }

    // ── Swimlanes (Fase 2 #5) — apply Y snapping after layout ──
    if (swimlanes && density !== 'collapsed') {
      const info = applySwimlanes(ctx, svcFunctions)
      if (info) renderSwimlaneBands(bgLayer, info)
    }

    // Drag
    ctx.allNodes.forEach(n => {
      enableDrag(n, svg, () => { ctx.allEdges.forEach(e => e.update()) })
    })

    // ── Per-region collapse persistence ──────────────────────
    // Apply previously-collapsed state to freshly-built regions,
    // and attach listeners that mirror DOM toggles into React state.
    allRegionsRef.current = ctx.allRegions
    ctx.allRegions.forEach(r => {
      const rid = r.getAttribute('data-id') ?? ''
      if (rid && collapsedRef.current.has(rid) && !r.__collapsed) {
        r.toggleCollapse()
      }
      const onToggle = () => {
        // Internal handler in createFunctionRegion ran first; r.__collapsed reflects new state.
        setCollapsedRegions(prev => {
          const next = new Set(prev)
          if (r.__collapsed) next.add(rid)
          else next.delete(rid)
          return next
        })
      }
      r.__chev.addEventListener('click', onToggle)
      r.__label.addEventListener('click', onToggle)
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

    // Dblclick — rich detail panel from codeNodeMap
    svg.addEventListener('gn-dblclick', (e: Event) => {
      const nodeEl = (e.target as Element)?.closest('[data-id]') as SVGGElement | null
      const nodeId = nodeEl?.getAttribute('data-id')
      if (!nodeId) return
      const kind = nodeEl?.getAttribute('data-type') ?? 'node'
      const labelEl = nodeEl?.querySelector('text.gn-node__title, text.gn-node__code')
      const label = labelEl?.textContent ?? nodeId
      const codeNode = codeNodeMap.get(nodeId)
      const llm = (codeNode as any)?.metadata?.llm
      setDetailInfo({
        id: nodeId,
        label,
        kind,
        humanName: llm?.humanName,
        description: llm?.description,
        file: codeNode?.location.file,
        line: codeNode?.location.line,
        topologyId: activeTopologyId ?? undefined,
        fields: codeNode ? extractFields(codeNode) : [{ key: 'type', value: kind }],
      })
    })

    // Zoom/pan
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    const zp = enableZoomPan(svg, nodeLayer, () => {
      selectNode(null)
      ctx.allEdges.forEach(e => { e.classList.remove('is-lit', 'is-firing') })
    })
    zpRef.current = zp
    setTimeout(() => { zp.fitContent(80); setZoom(zp.getScale()) }, 150)

    // Register export snapshot for the export menu
    const epTitle = `${endpoint.metadata.method} ${endpoint.metadata.path}`.replace(/\//g, '-').replace(/^-/, '')
    const exportFn = (): ExportGraph => {
      const nodes: ExportNode[] = ctx.allNodes.map(n => {
        const id = n.getAttribute('data-id') ?? n.__type
        const type = n.getAttribute('data-type') ?? n.__type
        const labelEl = n.querySelector<SVGElement>('.gn-node__title, .gn-node__code, .gn-node__method')
        const label = labelEl?.textContent ?? id
        const subLabelEl = n.querySelector<SVGElement>('.gn-node__meta')
        const subLabel = subLabelEl?.textContent ?? undefined
        const status = n.classList.contains('gn-node--status-err') ? 'err' as const : 'ok' as const
        return { id, type, label, subLabel, x: n.__x, y: n.__y, w: n.__bounds.w, h: n.__bounds.h, shape: n.__bounds.shape, status }
      })
      const edges: ExportEdge[] = ctx.allEdges.map(e => ({
        fromId: e.__source.getAttribute('data-id') ?? '',
        toId: e.__target.getAttribute('data-id') ?? '',
        label: e.__label,
      }))
      return { title: epTitle, nodes, edges }
    }
    setExportReady(exportFn)

    return () => {
      zp.destroy()
      setExportReady(null)
      allRegionsRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, density, swimlanes, svcFunctions])

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

  // Simulation overlay (Fase 8) — paints touched/forced/escaped nodes
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    // Always clear previous overlay first
    svg.querySelectorAll('.gn-sim-touched, .gn-sim-forced, .gn-sim-escape')
       .forEach(n => n.classList.remove('gn-sim-touched', 'gn-sim-forced', 'gn-sim-escape'))
    if (!simulationResult) return

    const paint = (id: string, cls: string) => {
      svg.querySelector(`[data-id="${id}"]`)?.classList.add(cls)
    }
    for (const e of simulationResult.externals) {
      paint(e.nodeId, e.forcedFailure ? 'gn-sim-forced' : 'gn-sim-touched')
    }
    for (const d of simulationResult.dbOps) {
      paint(d.nodeId, d.forcedFailure ? 'gn-sim-forced' : 'gn-sim-touched')
    }
    for (const t of simulationResult.throws) {
      // Synthesized "forced" throws have ids like `<src>:forced` or `<ep>:mw:N:forced` —
      // those don't correspond to real DOM nodes, so painting them is a no-op (safe).
      paint(t.nodeId, t.caught ? 'gn-sim-touched' : 'gn-sim-escape')
    }
    for (const r of simulationResult.returns) {
      paint(r.nodeId, 'gn-sim-touched')
    }
  }, [simulationResult])

  // Walk-path overlay (Fase 8b) — paints visited nodes up to current step,
  // highlights the active step, dims skipped branches.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    svg.querySelectorAll('.gn-sim-visited, .gn-sim-active, .gn-sim-skipped')
       .forEach(n => n.classList.remove('gn-sim-visited', 'gn-sim-active', 'gn-sim-skipped'))
    if (!walkResult) return

    const activeIdx = walkActiveNodeId ? walkResult.walkOrder.indexOf(walkActiveNodeId) : -1
    const upTo = activeIdx >= 0 ? activeIdx : walkResult.walkOrder.length - 1

    // The expanded flow renders some nodes with derived data-ids
    // (`<id>-entry`, `<id>-exit`, `e-<hash>-<suffix>` for inlined function
    // entries, etc.). Try the exact id first; if missing, fall back to a
    // prefix match so functions/calls still light up.
    function findEl(id: string): Element | null {
      const exact = svg!.querySelector(`[data-id="${id}"]`)
      if (exact) return exact
      const escaped = id.replace(/"/g, '\\"')
      return svg!.querySelector(`[data-id^="${escaped}-"], [data-id$="-${escaped}"], [data-id*="-${escaped.split(':')[1] ?? escaped}"]`)
    }

    for (let i = 0; i <= upTo; i++) {
      const id = walkResult.walkOrder[i]
      const el = findEl(id)
      if (el) el.classList.add(i === activeIdx ? 'gn-sim-active' : 'gn-sim-visited')
    }
  }, [walkResult, walkActiveNodeId])

  const handleFit     = useCallback(() => { zpRef.current?.fitContent(80); setZoom(zpRef.current?.getScale() ?? 1) }, [])
  const handleZoomIn  = useCallback(() => { zpRef.current?.zoomIn();  setZoom(zpRef.current?.getScale() ?? 1) }, [])
  const handleZoomOut = useCallback(() => { zpRef.current?.zoomOut(); setZoom(zpRef.current?.getScale() ?? 1) }, [])

  // Global keyboard zoom/fit shortcuts (Spec 9.4)
  useEffect(() => {
    const onFit    = () => handleFit()
    const onZoomIn = () => handleZoomIn()
    const onZoomOut= () => handleZoomOut()
    document.addEventListener('gaia:fit',     onFit)
    document.addEventListener('gaia:zoom-in', onZoomIn)
    document.addEventListener('gaia:zoom-out',onZoomOut)
    return () => {
      document.removeEventListener('gaia:fit',     onFit)
      document.removeEventListener('gaia:zoom-in', onZoomIn)
      document.removeEventListener('gaia:zoom-out',onZoomOut)
    }
  }, [handleFit, handleZoomIn, handleZoomOut])

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
        <span className={styles.divider} aria-hidden="true" />
        <button
          className={styles.densityBtn}
          onClick={handleCollapseAll}
          title="Recolher todas as regiões"
        >
          <span>▸</span><span>collapse</span>
        </button>
        <button
          className={styles.densityBtn}
          onClick={handleExpandAll}
          title="Expandir todas as regiões"
        >
          <span>▾</span><span>expand</span>
        </button>
        <span className={styles.divider} aria-hidden="true" />
        <button
          className={`${styles.densityBtn} ${swimlanes ? styles.densityBtnActive : ''}`}
          onClick={handleSwimlanes}
          title="Agrupar por camada (controller / service / repository / external)"
        >
          <span>≡</span><span>swimlane</span>
        </button>
        {activeTopologyId && endpoint && (
          <>
            <span className={styles.divider} aria-hidden="true" />
            <button
              className={styles.densityBtn}
              onClick={() => setDocTarget({
                kind: 'endpoint',
                topologyId: activeTopologyId,
                endpointId: endpoint.id,
                title: `${endpoint.metadata.method} ${endpoint.metadata.path}`,
              })}
              title="Generate endpoint documentation via LLM"
            >
              <span>✨</span><span>generate doc</span>
            </button>
            <button
              className={styles.densityBtn}
              onClick={() => setSnapshotsOpen(true)}
              title="View topology snapshots and diff between versions"
            >
              <span>↻</span><span>snapshots</span>
            </button>
            <button
              className={`${styles.densityBtn} ${simulatorOpen ? styles.densityBtnActive : ''}`}
              onClick={() => setSimulatorOpen(o => !o)}
              title="Simulate this endpoint with optional injected failures"
            >
              <span>⚡</span><span>simulate</span>
            </button>
            <button
              className={`${styles.densityBtn} ${walkOpen ? styles.densityBtnActive : ''}`}
              onClick={() => setWalkOpen(o => !o)}
              title="Generate input form, evaluate conditions deterministically, animate the path"
            >
              <span>→</span><span>walk path</span>
            </button>
          </>
        )}
      </div>

      <ZoomControls zoom={zoom} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onFit={handleFit} />
      {detailInfo && <NodeDetailPanel info={detailInfo} onClose={() => setDetailInfo(null)} />}
      {docTarget && <DocModal target={docTarget} onClose={() => setDocTarget(null)} />}
      {snapshotsOpen && activeTopologyId && (
        <SnapshotsModal
          topologyId={activeTopologyId}
          topologyName={endpoint ? `${endpoint.metadata.method} ${endpoint.metadata.path}` : activeTopologyId}
          onClose={() => setSnapshotsOpen(false)}
        />
      )}
      {simulatorOpen && activeTopologyId && endpoint && (
        <SimulatorPanel
          topologyId={activeTopologyId}
          endpointId={endpoint.id}
          onResult={setSimulationResult}
          onClose={() => {
            setSimulatorOpen(false)
            setSimulationResult(null)
          }}
        />
      )}
      {walkOpen && endpoint && (
        <WalkPathPanel
          endpoint={endpoint}
          onWalk={setWalkResult}
          onActiveNode={setWalkActiveNodeId}
          onClose={() => {
            setWalkOpen(false)
            setWalkResult(null)
            setWalkActiveNodeId(null)
          }}
        />
      )}
    </div>
  )
}
