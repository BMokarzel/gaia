import type { ServiceNode, DatabaseNode, BrokerNode, SystemTopology } from '@/types/topology'

export interface ServiceLayoutNode {
  id: string
  kind: 'endpoint' | 'database' | 'broker'
  label: string
  sub: string
  method?: string    // for endpoints
  x: number
  y: number
}

export interface ServiceLayoutEdge {
  from: string
  to: string
  kind: 'sync' | 'async' | 'data'
}

export interface ServiceLayout {
  nodes: ServiceLayoutNode[]
  edges: ServiceLayoutEdge[]
  width: number
  height: number
}

const COL_ENDPOINTS_X = 280
const COL_DEPS_X = 640
const ROW_GAP = 90

export function buildServiceLayout(service: ServiceNode, topology: SystemTopology): ServiceLayout {
  const nodes: ServiceLayoutNode[] = []
  const edges: ServiceLayoutEdge[] = []

  // Collect deps first to know counts for vertical centering
  const depItems: Array<{ id: string; kind: 'database' | 'broker'; label: string; sub: string }> = []
  for (const dep of service.dependencies) {
    const db = topology.databases.find(d => d.id === dep.targetId)
    if (db) { depItems.push({ id: db.id, kind: 'database', label: db.name, sub: db.metadata.engine }); continue }
    const broker = topology.brokers.find(b => b.id === dep.targetId)
    if (broker) depItems.push({ id: broker.id, kind: 'broker', label: broker.name, sub: broker.metadata.engine })
  }

  const epCount = service.endpoints.length
  const depCount = depItems.length
  const maxRows = Math.max(epCount, depCount, 1)
  const totalH = maxRows * ROW_GAP
  // Center each column: offset so center of column aligns to same Y
  const epStartY = (totalH - epCount * ROW_GAP) / 2 + ROW_GAP / 2
  const depStartY = (totalH - depCount * ROW_GAP) / 2 + ROW_GAP / 2

  // Endpoints column (left)
  service.endpoints.forEach((ep, i) => {
    nodes.push({
      id: ep.id,
      kind: 'endpoint',
      label: `${ep.metadata.method} ${ep.metadata.path}`,
      sub: ep.metadata.framework ?? '',
      method: ep.metadata.method,
      x: COL_ENDPOINTS_X,
      y: epStartY + i * ROW_GAP,
    })
  })

  // Deps column (right)
  depItems.forEach((dep, i) => {
    nodes.push({ ...dep, x: COL_DEPS_X, y: depStartY + i * ROW_GAP })
  })
  const depRow = depItems.length

  // Edges from global topology edges involving this service
  const nodeIds = new Set(nodes.map(n => n.id))
  for (const e of topology.edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) continue
    const kind: ServiceLayoutEdge['kind'] =
      e.kind === 'publishes_to' || e.kind === 'consumes_from' ? 'async' :
      e.kind === 'reads_from' || e.kind === 'writes_to' ? 'data' : 'sync'
    edges.push({ from: e.from, to: e.to, kind })
  }

  // If no global edges, draw edges from endpoints to all deps (fallback)
  if (edges.length === 0 && depRow > 0) {
    for (const ep of service.endpoints) {
      for (const dep of nodes.filter(n => n.kind !== 'endpoint')) {
        edges.push({ from: ep.id, to: dep.id, kind: 'sync' })
      }
    }
  }

  const height = Math.max(epCount, depRow) * ROW_GAP + ROW_GAP

  return {
    nodes,
    edges,
    width: COL_DEPS_X + 200,
    height,
  }
}
