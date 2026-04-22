import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { ZoomControls } from '@/shell/ZoomControls'
import { useTopologyStore } from '@/store/topologyStore'
import { enableZoomPan, type ZoomPanHandle } from '@/graph/gaiaNodes'
import type { EcosystemServiceEntry, EcosystemDatabaseEntry, EcosystemIndex } from '@/types/topology'
import styles from './EcosystemView.module.css'

type EcoNode = d3.SimulationNodeDatum & {
  id: string
  label: string
  kind: 'service' | 'database'
  inDegree: number
  status: 'active' | 'provisional'
  meta: EcosystemServiceEntry | EcosystemDatabaseEntry
}

type EcoLink = d3.SimulationLinkDatum<EcoNode> & {
  sourceId: string
  targetId: string
}

interface InfoPanel {
  node: EcoNode
}

interface EdgeInfoPanel {
  srcNode: EcoNode
  tgtNode: EcoNode
}

const MIN_R = 18
const MAX_R = 52

function nodeRadius(inDegree: number, maxInDegree: number): number {
  if (maxInDegree === 0) return MIN_R + 8
  const t = inDegree / maxInDegree
  return MIN_R + t * (MAX_R - MIN_R)
}

export function EcosystemView() {
  const {
    ecosystem, ecosystemStatus, ecosystemError,
    loadEcosystem,
    highlightedNodeId, selectNode,
    navigateToService,
  } = useTopologyStore()

  const svgRef = useRef<SVGSVGElement>(null)
  const zpRef = useRef<ZoomPanHandle | null>(null)
  const [zoom, setZoom] = useState(1)
  const [infoPanel, setInfoPanel] = useState<InfoPanel | null>(null)
  const [edgeInfoPanel, setEdgeInfoPanel] = useState<EdgeInfoPanel | null>(null)

  // Load ecosystem on mount
  useEffect(() => {
    if (!ecosystem && ecosystemStatus === 'idle') loadEcosystem()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Build graph when ecosystem changes
  useEffect(() => {
    if (!svgRef.current || !ecosystem) return
    const svg = svgRef.current

    // Clear previous
    while (svg.firstChild) svg.removeChild(svg.firstChild)

    const rect = svg.getBoundingClientRect()
    const W = rect.width || 1200
    const H = rect.height || 800

    // Compute inDegree for each node
    const inDegreeMap = new Map<string, number>()
    for (const entry of [...ecosystem.services, ...ecosystem.databases]) {
      inDegreeMap.set(entry.id, 0)
    }
    for (const edge of ecosystem.edges) {
      inDegreeMap.set(edge.to, (inDegreeMap.get(edge.to) ?? 0) + 1)
    }
    const maxInDegree = Math.max(0, ...inDegreeMap.values())

    // Build d3Nodes
    const d3Nodes: EcoNode[] = [
      ...ecosystem.services.map(s => ({
        id: s.id,
        label: s.name,
        kind: 'service' as const,
        inDegree: inDegreeMap.get(s.id) ?? 0,
        status: s.status,
        meta: s,
        x: W / 2 + (Math.random() - 0.5) * W * 0.6,
        y: H / 2 + (Math.random() - 0.5) * H * 0.6,
      })),
      ...ecosystem.databases.map(db => ({
        id: db.id,
        label: db.name,
        kind: 'database' as const,
        inDegree: inDegreeMap.get(db.id) ?? 0,
        status: db.status,
        meta: db,
        x: W / 2 + (Math.random() - 0.5) * W * 0.6,
        y: H / 2 + (Math.random() - 0.5) * H * 0.6,
      })),
    ]

    const nodeIdSet = new Set(d3Nodes.map(n => n.id))
    const d3Links: EcoLink[] = ecosystem.edges
      .filter(e => nodeIdSet.has(e.from) && nodeIdSet.has(e.to))
      .map(e => ({ sourceId: e.from, targetId: e.to, source: e.from, target: e.to }))

    // ── SVG layers ────────────────────────────────────────────
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)

    // Transparent background for click-to-deselect
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('x', '-5000'); bg.setAttribute('y', '-5000')
    bg.setAttribute('width', '10000'); bg.setAttribute('height', '10000')
    bg.setAttribute('fill', 'transparent')
    bg.style.cursor = 'default'
    bg.addEventListener('click', () => { selectNode(null); setInfoPanel(null); setEdgeInfoPanel(null) })
    svg.appendChild(bg)

    const zoomG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    svg.appendChild(zoomG)

    const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    zoomG.appendChild(edgeLayer)
    const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    zoomG.appendChild(nodeLayer)

    // ── Arrowhead ─────────────────────────────────────────────
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
    marker.setAttribute('id', 'eco-arrow')
    marker.setAttribute('viewBox', '0 0 8 8')
    marker.setAttribute('refX', '7'); marker.setAttribute('refY', '4')
    marker.setAttribute('markerWidth', '6'); marker.setAttribute('markerHeight', '6')
    marker.setAttribute('orient', 'auto-start-reverse')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M0,0 L8,4 L0,8 Z')
    path.setAttribute('fill', 'var(--border)')
    marker.appendChild(path)
    defs.appendChild(marker)
    svg.insertBefore(defs, svg.firstChild)

    // ── Edge elements ─────────────────────────────────────────
    const edgeEls = new Map<string, SVGLineElement>()
    for (const link of d3Links) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('stroke', 'var(--border)')
      line.setAttribute('stroke-width', '1.5')
      line.setAttribute('marker-end', 'url(#eco-arrow)')
      line.setAttribute('data-src', link.sourceId)
      line.setAttribute('data-tgt', link.targetId)
      edgeLayer.appendChild(line)
      edgeEls.set(`${link.sourceId}→${link.targetId}`, line)
    }

    // ── Node elements (circles) ───────────────────────────────
    const nodeEls = new Map<string, SVGGElement>()
    for (const dn of d3Nodes) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      g.setAttribute('data-id', dn.id)
      g.setAttribute('class', 'eco-node')
      g.style.cursor = 'pointer'

      const r = nodeRadius(dn.inDegree, maxInDegree)
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      circle.setAttribute('r', String(r))
      circle.setAttribute('fill', dn.kind === 'service' ? 'var(--accent-green)' : 'var(--accent-blue)')
      circle.setAttribute('fill-opacity', dn.status === 'provisional' ? '0.3' : '0.15')
      circle.setAttribute('stroke', dn.kind === 'service' ? 'var(--accent-green)' : 'var(--accent-blue)')
      circle.setAttribute('stroke-width', '1.5')
      if (dn.status === 'provisional') circle.setAttribute('stroke-dasharray', '4 3')
      g.appendChild(circle)

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      text.setAttribute('text-anchor', 'middle')
      text.setAttribute('dy', String(r + 14))
      text.setAttribute('font-size', '11')
      text.setAttribute('fill', 'var(--text-primary)')
      text.textContent = dn.label.length > 14 ? dn.label.slice(0, 13) + '…' : dn.label
      g.appendChild(text)

      nodeLayer.appendChild(g)
      nodeEls.set(dn.id, g)
    }

    // ── D3 simulation ─────────────────────────────────────────
    const sim = d3.forceSimulation(d3Nodes)
      .force('charge', d3.forceManyBody<EcoNode>().strength(n => -(400 + n.inDegree * 50)))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.05))
      .force('collide', d3.forceCollide<EcoNode>(n => nodeRadius(n.inDegree, maxInDegree) + 30).strength(0.8))
      .force('link', d3.forceLink<EcoNode, EcoLink>(d3Links).id(n => n.id).distance(200).strength(0.4))
      .alphaDecay(0.025)
      .velocityDecay(0.4)

    sim.on('tick', () => {
      for (const dn of d3Nodes) {
        const g = nodeEls.get(dn.id)
        if (g && dn.x != null && dn.y != null) {
          g.setAttribute('transform', `translate(${dn.x},${dn.y})`)
        }
      }
      for (const link of d3Links) {
        const src = link.source as EcoNode
        const tgt = link.target as EcoNode
        const line = edgeEls.get(`${link.sourceId}→${link.targetId}`)
        if (line && src.x != null && src.y != null && tgt.x != null && tgt.y != null) {
          const rTgt = nodeRadius(tgt.inDegree, maxInDegree)
          const dx = tgt.x - src.x, dy = tgt.y - src.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          line.setAttribute('x1', String(src.x))
          line.setAttribute('y1', String(src.y))
          line.setAttribute('x2', String(tgt.x - (dx / dist) * (rTgt + 8)))
          line.setAttribute('y2', String(tgt.y - (dy / dist) * (rTgt + 8)))
        }
      }
    })

    // ── Interactions ──────────────────────────────────────────

    let clickTimer: ReturnType<typeof setTimeout> | null = null

    nodeLayer.addEventListener('click', (e) => {
      const nodeEl = (e.target as Element).closest('[data-id]') as SVGGElement | null
      const nodeId = nodeEl?.getAttribute('data-id')
      if (!nodeId) return

      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return }

      clickTimer = setTimeout(() => {
        clickTimer = null
        const dn = d3Nodes.find(n => n.id === nodeId)
        if (!dn) return
        selectNode(nodeId)
        // Highlight outgoing edges from this node
        edgeEls.forEach((line, key) => {
          const isOutgoing = key.startsWith(`${nodeId}→`)
          line.setAttribute('stroke', isOutgoing ? 'var(--accent-green)' : 'var(--border)')
          line.setAttribute('stroke-width', isOutgoing ? '2.5' : '1.5')
        })
        // Highlight this node
        nodeEls.forEach((g, id) => {
          const circle = g.querySelector('circle')
          if (circle) {
            circle.setAttribute('stroke-width', id === nodeId ? '3' : '1.5')
          }
        })
      }, 220)
    })

    nodeLayer.addEventListener('dblclick', (e) => {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null }
      const nodeEl = (e.target as Element).closest('[data-id]') as SVGGElement | null
      const nodeId = nodeEl?.getAttribute('data-id')
      if (!nodeId) return
      const dn = d3Nodes.find(n => n.id === nodeId)
      if (dn) setInfoPanel({ node: dn })
    })

    edgeLayer.addEventListener('dblclick', (e) => {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null }
      const lineEl = e.target as SVGLineElement | null
      const srcId = lineEl?.getAttribute('data-src')
      const tgtId = lineEl?.getAttribute('data-tgt')
      if (!srcId || !tgtId) return
      const srcNode = d3Nodes.find(n => n.id === srcId)
      const tgtNode = d3Nodes.find(n => n.id === tgtId)
      if (srcNode && tgtNode) setEdgeInfoPanel({ srcNode, tgtNode })
    })

    // ── Drag ──────────────────────────────────────────────────
    const drag = d3.drag<SVGGElement, EcoNode>()
      .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
      .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null })

    d3Nodes.forEach(dn => {
      const el = nodeEls.get(dn.id)
      if (el) d3.select<SVGGElement, EcoNode>(el).datum(dn).call(drag)
    })

    // ── Zoom/Pan ──────────────────────────────────────────────
    const zp = enableZoomPan(svg, zoomG, () => { selectNode(null); setInfoPanel(null) })
    zpRef.current = zp
    setTimeout(() => { zp.fitContent(100); setZoom(zp.getScale()) }, 1000)

    return () => { zp.destroy(); sim.stop() }
  }, [ecosystem]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset edge/node highlights when selection cleared
  useEffect(() => {
    if (!highlightedNodeId) {
      svgRef.current?.querySelectorAll('line').forEach(line => {
        line.setAttribute('stroke', 'var(--border)')
        line.setAttribute('stroke-width', '1.5')
        line.setAttribute('opacity', '1')
      })
      svgRef.current?.querySelectorAll('circle').forEach(c => c.setAttribute('stroke-width', '1.5'))
    }
  }, [highlightedNodeId])

  // Global keyboard zoom/fit shortcuts (Spec 9.4)
  useEffect(() => {
    const onFit    = () => { zpRef.current?.fitContent(100); setZoom(zpRef.current?.getScale() ?? 1) }
    const onZoomIn = () => { zpRef.current?.zoomIn();  setZoom(zpRef.current?.getScale() ?? 1) }
    const onZoomOut= () => { zpRef.current?.zoomOut(); setZoom(zpRef.current?.getScale() ?? 1) }
    document.addEventListener('gaia:fit',     onFit)
    document.addEventListener('gaia:zoom-in', onZoomIn)
    document.addEventListener('gaia:zoom-out',onZoomOut)
    return () => {
      document.removeEventListener('gaia:fit',     onFit)
      document.removeEventListener('gaia:zoom-in', onZoomIn)
      document.removeEventListener('gaia:zoom-out',onZoomOut)
    }
  }, [])

  const handleFit     = useCallback(() => zpRef.current?.fitContent(100), [])
  const handleZoomIn  = useCallback(() => { zpRef.current?.zoomIn();  setZoom(zpRef.current?.getScale() ?? 1) }, [])
  const handleZoomOut = useCallback(() => { zpRef.current?.zoomOut(); setZoom(zpRef.current?.getScale() ?? 1) }, [])

  return (
    <div className={styles.container}>
      <svg ref={svgRef} className={styles.svg} viewBox="0 0 1200 800" />

      {!ecosystem && ecosystemStatus !== 'loading' && (
        <div className={styles.emptyState}>
          <div style={{ fontSize: 36, color: 'var(--accent-green)' }}>◎</div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Nenhum serviço extraído ainda</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Use Extract na Home para adicionar serviços ao ecossistema</div>
        </div>
      )}

      {ecosystemStatus === 'loading' && (
        <div className={styles.loadingOverlay}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, color: 'var(--accent-green)', marginBottom: 12 }}>◌</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>carregando ecossistema…</div>
          </div>
        </div>
      )}

      {ecosystemStatus === 'error' && (
        <div className={styles.errorBanner}>
          <span>⚠</span> {ecosystemError ?? 'Falha ao carregar ecossistema'}
        </div>
      )}

      <ZoomControls zoom={zoom} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onFit={handleFit} />

      {infoPanel && (
        <EcosystemInfoPanel
          node={infoPanel.node}
          ecosystem={ecosystem}
          onClose={() => setInfoPanel(null)}
          onNavigate={() => {
            if (infoPanel.node.kind === 'service') navigateToService(infoPanel.node.id)
            setInfoPanel(null)
          }}
        />
      )}

      {edgeInfoPanel && (
        <EcosystemEdgeInfoPanel
          srcNode={edgeInfoPanel.srcNode}
          tgtNode={edgeInfoPanel.tgtNode}
          onClose={() => setEdgeInfoPanel(null)}
        />
      )}
    </div>
  )
}

// ── Info panel component ─────────────────────────────────────────────────────

function EcosystemInfoPanel({
  node, ecosystem, onClose, onNavigate,
}: {
  node: EcoNode
  ecosystem: EcosystemIndex | null
  onClose: () => void
  onNavigate: () => void
}) {
  const svc = node.kind === 'service' ? (node.meta as EcosystemServiceEntry) : null
  const db  = node.kind === 'database' ? (node.meta as EcosystemDatabaseEntry) : null

  // Compute outgoing dependencies from ecosystem edges
  const deps = ecosystem?.edges
    .filter(e => e.from === node.id)
    .map(e => {
      const target = [
        ...(ecosystem.services ?? []),
        ...(ecosystem.databases ?? []),
      ].find(n => n.id === e.to)
      return target ? { id: e.to, name: target.name, kind: 'databases' in target ? 'database' : 'service' } : null
    })
    .filter(Boolean) ?? []

  const accentColor = node.kind === 'service' ? 'var(--accent-green)' : 'var(--accent-blue)'

  return (
    <div style={{
      position: 'absolute', top: 16, right: 16,
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${accentColor}`,
      borderRadius: '0 12px 12px 0', padding: '16px 20px', minWidth: 260, maxWidth: 320,
      color: 'var(--text-primary)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      fontFamily: '"Space Grotesk", sans-serif',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: accentColor, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>{node.label}</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
      </div>

      {/* Tech badges */}
      {svc && (svc.language || svc.framework) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {svc.language && <span style={{ background: 'rgba(57,255,110,0.1)', color: 'var(--accent-green)', border: '1px solid rgba(57,255,110,0.25)', borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 500 }}>{svc.language}</span>}
          {svc.framework && <span style={{ background: 'rgba(57,255,110,0.07)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 500 }}>{svc.framework}</span>}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border)', margin: '10px 0' }} />

      {/* Counters */}
      {svc && (
        <div style={{ fontSize: 13, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 0', marginBottom: 10 }}>
          <span style={{ color: 'var(--text-muted)' }}>Endpoints</span>
          <span style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{svc.endpointCount}</span>
          <span style={{ color: 'var(--text-muted)' }}>Dependências</span>
          <span style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{deps.length}</span>
        </div>
      )}
      {db && (
        <div style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.6 }}>
          <div style={{ color: 'var(--text-muted)' }}>Engine: <span style={{ color: 'var(--text-primary)' }}>{db.kind}</span></div>
          {db.status === 'provisional' && <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 11, fontStyle: 'italic' }}>Inferido (não confirmado)</div>}
        </div>
      )}

      {/* Dependencies list */}
      {deps.length > 0 && (
        <>
          <div style={{ borderTop: '1px solid var(--border)', margin: '10px 0' }} />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Dependências</div>
          {deps.map(dep => dep && (
            <div key={dep.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: dep.kind === 'database' ? 'var(--accent-blue)' : 'var(--accent-green)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>{dep.name}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>{dep.kind === 'database' ? 'db' : 'svc'}</span>
            </div>
          ))}
        </>
      )}

      {/* Actions */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12, display: 'flex', gap: 8 }}>
        {node.kind === 'service' && (
          <button onClick={onNavigate} style={{
            background: 'var(--accent-green)', color: 'var(--bg-canvas)',
            border: 'none', borderRadius: 6, padding: '7px 14px', cursor: 'pointer',
            fontSize: 12, fontWeight: 600, flex: 1,
          }}>
            Explorar →
          </button>
        )}
      </div>
    </div>
  )
}

// ── Edge info panel ──────────────────────────────────────────────────────────

function EcosystemEdgeInfoPanel({
  srcNode, tgtNode, onClose,
}: {
  srcNode: EcoNode
  tgtNode: EcoNode
  onClose: () => void
}) {
  const srcColor = srcNode.kind === 'service' ? 'var(--accent-green)' : 'var(--accent-blue)'
  const tgtColor = tgtNode.kind === 'service' ? 'var(--accent-green)' : 'var(--accent-blue)'

  return (
    <div style={{
      position: 'absolute', top: 16, right: 16,
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderLeft: '3px solid var(--border)',
      borderRadius: '0 12px 12px 0', padding: '16px 20px', minWidth: 260, maxWidth: 320,
      color: 'var(--text-primary)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      fontFamily: '"Space Grotesk", sans-serif',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Dependência</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: srcColor, display: 'inline-block' }} />
          <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>{srcNode.label}</span>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>→</span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: tgtColor, display: 'inline-block' }} />
          <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-secondary)' }}>{tgtNode.label}</span>
        </div>
      </div>
    </div>
  )
}
