import * as d3 from 'd3'
import type { SystemTopology, ServiceNode, DatabaseNode, BrokerNode } from '@/types/topology'

export type EcoNodeKind = 'service' | 'database' | 'broker' | 'frontend'

export interface EcoNode extends d3.SimulationNodeDatum {
  id: string
  kind: EcoNodeKind
  label: string
  sub: string
  /** for service: endpoint count; for others: 0 */
  size: number
}

export interface EcoLink extends d3.SimulationLinkDatum<EcoNode> {
  kind: 'sync' | 'async' | 'event' | 'data'
}

export interface EcoGraph {
  nodes: EcoNode[]
  links: EcoLink[]
}

export function buildEcoGraph(topology: SystemTopology): EcoGraph {
  const nodes: EcoNode[] = []
  const nodeIds = new Set<string>()

  const addNode = (n: EcoNode) => {
    if (!nodeIds.has(n.id)) { nodes.push(n); nodeIds.add(n.id) }
  }

  for (const s of topology.services) {
    const isFrontend = s.metadata.kind === 'frontend' || s.metadata.kind === 'microfrontend' || s.metadata.kind === 'mobile'
    addNode({
      id: s.id,
      kind: isFrontend ? 'frontend' : 'service',
      label: s.name,
      sub: `${s.endpoints.length} endpoints`,
      size: Math.min(56, 26 + s.endpoints.length * 2),
    })
  }

  for (const db of topology.databases) {
    addNode({ id: db.id, kind: 'database', label: db.name, sub: db.metadata.engine, size: 28 })
  }

  for (const b of topology.brokers) {
    addNode({ id: b.id, kind: 'broker', label: b.name, sub: b.metadata.engine, size: 28 })
  }

  // Build links from global edges + service dependencies
  const links: EcoLink[] = []
  const linkKey = (a: string, b: string) => `${a}--${b}`
  const seen = new Set<string>()

  const addLink = (from: string, to: string, kind: EcoLink['kind']) => {
    if (!nodeIds.has(from) || !nodeIds.has(to)) return
    const k = linkKey(from, to)
    if (seen.has(k)) return
    seen.add(k)
    links.push({ source: from, target: to, kind })
  }

  for (const e of topology.edges) {
    const kind: EcoLink['kind'] =
      e.kind === 'publishes_to' || e.kind === 'consumes_from' || e.kind === 'emits' ? 'async' :
      e.kind === 'reads_from' || e.kind === 'writes_to' || e.kind === 'uses' ? 'data' :
      'sync'
    if (e.from && e.to) addLink(e.from, e.to, kind)
  }

  for (const s of topology.services) {
    for (const dep of s.dependencies) {
      const kind: EcoLink['kind'] =
        dep.callKind === 'async' || dep.callKind === 'event' || dep.callKind === 'stream' ? 'async' : 'sync'
      addLink(s.id, dep.id, kind)
    }
  }

  return { nodes, links }
}

export function runForceSimulation(
  graph: EcoGraph,
  width: number,
  height: number,
  onTick: (nodes: EcoNode[]) => void,
  onEnd: (nodes: EcoNode[]) => void
): d3.Simulation<EcoNode, EcoLink> {
  const sim = d3.forceSimulation<EcoNode>(graph.nodes)
    .force('link', d3.forceLink<EcoNode, EcoLink>(graph.links)
      .id(d => d.id)
      .distance(d => {
        const s = d.source as EcoNode
        const t = d.target as EcoNode
        return 120 + (s.size ?? 28) + (t.size ?? 28)
      })
      .strength(0.4)
    )
    .force('charge', d3.forceManyBody().strength(-600))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide<EcoNode>(d => (d.size ?? 28) + 30))
    .alphaDecay(0.028)

  sim.on('tick', () => onTick([...graph.nodes]))
  sim.on('end', () => onEnd([...graph.nodes]))

  return sim
}
