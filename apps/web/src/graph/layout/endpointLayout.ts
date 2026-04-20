import type { CodeNode, EndpointNode, FlowControlNode, DbProcessNode, ReturnNode, ThrowNode } from '@/types/topology'

export type FlowNodeKind = 'client' | 'handler' | 'function' | 'branch' | 'db' | 'return' | 'error'

export interface FlowNode {
  id: string
  kind: FlowNodeKind
  label: string
  sub: string
  x: number
  y: number
  col: number
  /** for lateral/external nodes */
  lateral?: boolean
  /** source metadata */
  meta: {
    file?: string
    line?: number
    condition?: string
    status?: number
    operation?: string
    method?: string
  }
}

export interface FlowEdge {
  from: string
  to: string
  label?: string
  lateral?: boolean
  isBranch?: boolean
  busX?: number
}

export type Density = 'expanded' | 'short' | 'collapsed'

// Column X positions
const COL = {
  client:   80,
  handler:  200,
  fn:       340,
  branch:   480,
  ret:      680,
  lateral:  820,
}

const ROW_MAIN = 300
const ROW_GAP  = 130

export interface FlowLayout {
  nodes: FlowNode[]
  edges: FlowEdge[]
  width: number
  height: number
}

let _uid = 0
const uid = (prefix: string) => `${prefix}-${++_uid}`

export function buildEndpointLayout(endpoint: EndpointNode, density: Density): FlowLayout {
  if (density === 'collapsed') return buildCollapsed(endpoint)
  if (density === 'short') return buildShort(endpoint)
  return buildExpanded(endpoint)
}

// ── Collapsed: single node ──────────────────────────────────────────────────
function buildCollapsed(ep: EndpointNode): FlowLayout {
  const n: FlowNode = {
    id: ep.id, kind: 'handler',
    label: `${ep.metadata.method} ${ep.metadata.path}`,
    sub: 'endpoint · click para expandir',
    x: 200, y: 200, col: 1,
    meta: {},
  }
  return { nodes: [n], edges: [], width: 400, height: 400 }
}

// ── Short: one circle per function, lateral for dbs ────────────────────────
function buildShort(ep: EndpointNode): FlowLayout {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []

  const clientId = uid('client')
  nodes.push({ id: clientId, kind: 'client', label: 'client', sub: 'external', x: COL.client, y: ROW_MAIN, col: 0, meta: {} })

  const handlerId = ep.id
  nodes.push({ id: handlerId, kind: 'handler', label: 'handler', sub: ep.metadata.path, x: COL.handler, y: ROW_MAIN, col: 1, meta: { method: ep.metadata.method } })
  edges.push({ from: clientId, to: handlerId })

  let prevId = handlerId
  let fnCol = COL.fn
  let lateralY = ROW_MAIN - 100

  const walk = (children: CodeNode[], depth = 0) => {
    for (const child of children) {
      if (child.type === 'function') {
        const nid = child.id
        nodes.push({ id: nid, kind: 'function', label: child.name, sub: 'fn', x: fnCol, y: ROW_MAIN, col: 2 + depth, meta: { file: child.location?.file, line: child.location?.line } })
        edges.push({ from: prevId, to: nid })
        prevId = nid
        fnCol += 120
        walk(child.children, depth + 1)
      } else if (child.type === 'flowControl') {
        const fc = child as FlowControlNode
        const nid = child.id
        nodes.push({ id: nid, kind: 'branch', label: fc.metadata.condition ?? 'branch', sub: fc.metadata.kind, x: fnCol, y: ROW_MAIN, col: 2 + depth, meta: { condition: fc.metadata.condition, file: child.location?.file, line: child.location?.line } })
        edges.push({ from: prevId, to: nid })
        prevId = nid
        fnCol += 120
      } else if (child.type === 'dbProcess') {
        const db = child as DbProcessNode
        const nid = child.id
        nodes.push({ id: nid, kind: 'db', label: db.metadata.tableId || db.metadata.databaseId, sub: db.metadata.operation, x: fnCol, y: lateralY, col: 2 + depth, lateral: true, meta: { operation: db.metadata.operation, file: child.location?.file, line: child.location?.line } })
        edges.push({ from: prevId, to: nid, lateral: true, label: db.metadata.operation })
        lateralY -= 80
      } else if (child.type === 'return') {
        const ret = child as ReturnNode
        const nid = child.id
        const isErr = (ret.metadata.httpStatus ?? 200) >= 400
        nodes.push({ id: nid, kind: isErr ? 'error' : 'return', label: 'return', sub: ret.metadata.httpStatus ? String(ret.metadata.httpStatus) : ret.metadata.value ?? '', x: COL.ret, y: ROW_MAIN + (isErr ? -80 : 0), col: 4, meta: { status: ret.metadata.httpStatus } })
        edges.push({ from: prevId, to: nid })
      }
    }
  }

  walk(ep.children)

  // If no children, add a simple return
  if (!nodes.find(n => n.kind === 'return' || n.kind === 'error')) {
    const retId = uid('ret')
    nodes.push({ id: retId, kind: 'return', label: 'return', sub: '200', x: COL.ret, y: ROW_MAIN, col: 4, meta: { status: 200 } })
    edges.push({ from: prevId, to: retId })
  }

  return {
    nodes,
    edges,
    width: Math.max(...nodes.map(n => n.x)) + 200,
    height: Math.max(500, Math.max(...nodes.map(n => n.y)) + 200),
  }
}

// ── Expanded: full detail with regions ─────────────────────────────────────
function buildExpanded(ep: EndpointNode): FlowLayout {
  // For expanded, use same logic as short but with more vertical spread
  const layout = buildShort(ep)

  // Re-space vertically for expanded
  let branchRow = 0
  for (const node of layout.nodes) {
    if (node.kind === 'branch') {
      node.y = ROW_MAIN - 100 + branchRow * ROW_GAP
      branchRow++
    }
  }

  return layout
}
