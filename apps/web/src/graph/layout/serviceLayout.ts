import type { ServiceNode, SystemTopology } from '@/types/topology'

export interface ServiceLayoutNode {
  id: string
  kind: 'endpoint' | 'database' | 'broker'
  label: string
  sub: string
  method?: string
  x: number
  y: number
}

export interface ServiceLayoutEdge {
  from: string
  to: string
  kind: 'sync' | 'async' | 'data'
}

export interface ServiceContainer {
  x: number
  y: number
  width: number
  height: number
  label: string
}

export interface ServiceLayout {
  nodes: ServiceLayoutNode[]
  edges: ServiceLayoutEdge[]
  container: ServiceContainer
  width: number
  height: number
}

// ── Layout constants ────────────────────────────────────────────
const MAX_PER_COL  = 24    // endpoints per column before adding another column
const EP_COL_W     = 260   // width allocated per endpoint column
const EP_COL_GAP   = 28    // horizontal gap between endpoint columns
const ROW_GAP      = 52    // vertical gap between endpoint rows
const NODE_H       = 28    // approximate endpoint node height
const CONTAINER_PAD = 28   // padding inside the service container
const CONTAINER_START_X = 40  // left edge of the service container
const DEP_OFFSET   = 100   // horizontal gap from container right edge to dep nodes
const DEP_ROW_GAP  = 90    // vertical gap between dep nodes

export function buildServiceLayout(service: ServiceNode, topology: SystemTopology): ServiceLayout {
  const nodes: ServiceLayoutNode[] = []
  const edges: ServiceLayoutEdge[] = []

  // ── Collect dependency items ──────────────────────────────────
  const depItems: Array<{ id: string; kind: 'database' | 'broker'; label: string; sub: string }> = []
  if ((service.dependencies ?? []).length > 0) {
    for (const dep of service.dependencies) {
      const db = topology.databases.find(d => d.id === dep.id)
      if (db) { depItems.push({ id: db.id, kind: 'database', label: db.name, sub: db.metadata.engine }); continue }
      const broker = topology.brokers.find(b => b.id === dep.id)
      if (broker) depItems.push({ id: broker.id, kind: 'broker', label: broker.name, sub: broker.metadata.engine })
    }
  } else {
    // Fallback: extractor didn't populate dependencies — use topology-level resources
    for (const db of topology.databases ?? []) {
      depItems.push({ id: db.id, kind: 'database', label: db.name, sub: db.metadata?.engine ?? 'db' })
    }
    for (const broker of topology.brokers ?? []) {
      depItems.push({ id: broker.id, kind: 'broker', label: broker.name, sub: broker.metadata?.engine ?? 'broker' })
    }
  }

  // ── Endpoint grid layout ──────────────────────────────────────
  const epCount = service.endpoints.length
  const numCols  = Math.max(1, Math.min(4, Math.ceil(epCount / MAX_PER_COL)))
  const perCol   = Math.ceil(epCount / numCols)

  const gridW    = numCols * EP_COL_W + (numCols - 1) * EP_COL_GAP
  const gridH    = perCol * ROW_GAP

  // Container dimensions
  const containerX = CONTAINER_START_X
  const containerY = CONTAINER_PAD
  const containerW = gridW + CONTAINER_PAD * 2
  const containerH = gridH + CONTAINER_PAD * 2 + NODE_H

  // Place endpoints: fill column-first (top→bottom, then next column)
  service.endpoints.forEach((ep, i) => {
    const col = Math.floor(i / perCol)
    const row = i % perCol
    const x = containerX + CONTAINER_PAD + col * (EP_COL_W + EP_COL_GAP) + EP_COL_W / 2
    const y = containerY + CONTAINER_PAD + NODE_H / 2 + row * ROW_GAP
    nodes.push({
      id: ep.id,
      kind: 'endpoint',
      label: `${ep.metadata.method} ${ep.metadata.path}`,
      sub: ep.metadata.framework ?? '',
      method: ep.metadata.method,
      x,
      y,
    })
  })

  // ── Dependency nodes (right of container) ─────────────────────
  const depX      = containerX + containerW + DEP_OFFSET
  const depTotalH = depItems.length * DEP_ROW_GAP
  const depStartY = containerY + containerH / 2 - depTotalH / 2 + DEP_ROW_GAP / 2

  depItems.forEach((dep, i) => {
    nodes.push({ ...dep, x: depX, y: depStartY + i * DEP_ROW_GAP })
  })

  // ── Edges ──────────────────────────────────────────────────────
  // Prefer explicit topology edges
  const nodeIds = new Set(nodes.map(n => n.id))
  for (const e of topology.edges) {
    const src = (e as any).source ?? (e as any).from
    const tgt = (e as any).target ?? (e as any).to
    if (!src || !tgt || !nodeIds.has(src) || !nodeIds.has(tgt)) continue
    const kind: ServiceLayoutEdge['kind'] =
      e.kind === 'publishes_to' || e.kind === 'consumes_from' ? 'async' :
      e.kind === 'reads_from'   || e.kind === 'writes_to'     ? 'data'  : 'sync'
    edges.push({ from: src, to: tgt, kind })
  }

  // Fallback: one representative edge per dep from the rightmost column sample
  if (edges.length === 0 && depItems.length > 0) {
    const depNodeIds = new Set(depItems.map(d => d.id))
    const depNodes   = nodes.filter(n => depNodeIds.has(n.id))
    // Pick one endpoint per column (the middle one) as representative source
    for (let col = 0; col < numCols; col++) {
      const colEps = nodes.filter((n, i) => n.kind === 'endpoint' && Math.floor(i / perCol) === col)
      const rep = colEps[Math.floor(colEps.length / 2)]
      if (!rep) continue
      for (const dep of depNodes) {
        edges.push({ from: rep.id, to: dep.id, kind: 'data' })
      }
    }
  }

  const container: ServiceContainer = {
    x: containerX,
    y: containerY,
    width: containerW,
    height: containerH,
    label: service.name,
  }

  return {
    nodes,
    edges,
    container,
    width: depX + 200,
    height: containerH + CONTAINER_PAD * 2,
  }
}
