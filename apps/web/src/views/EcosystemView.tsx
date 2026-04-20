import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { ZoomControls } from '@/shell/ZoomControls'
import { useTopologyStore } from '@/store/topologyStore'
import {
  createServiceNode, createDatabaseNode, createBrokerNode,
  createEdge, createGraphDefs, enableDrag, enableZoomPan,
  triggerTap, type GaiaNode, type GaiaEdge, type ZoomPanHandle,
} from '@/graph/gaiaNodes'
import { NodeDetailPanel, type NodeDetailInfo } from '@/detail/NodeDetailPanel'
import styles from './EcosystemView.module.css'

export function EcosystemView() {
  const {
    topology, status,
    navigateTo, selectedNodeId, selectNode,
  } = useTopologyStore()

  const svgRef = useRef<SVGSVGElement>(null)
  const [zoom, setZoom] = useState(1)
  const zpRef = useRef<ZoomPanHandle | null>(null)
  const [detailInfo, setDetailInfo] = useState<NodeDetailInfo | null>(null)

  // ── D3 graph de serviços, databases e brokers ─────────────
  useEffect(() => {
    if (!svgRef.current || !topology) return
    const svg = svgRef.current

    while (svg.firstChild) svg.removeChild(svg.firstChild)
    svg.appendChild(createGraphDefs())

    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bgRect.setAttribute('class', 'gn-bg')
    bgRect.setAttribute('x', '-5000'); bgRect.setAttribute('y', '-5000')
    bgRect.setAttribute('width', '10000'); bgRect.setAttribute('height', '10000')
    bgRect.setAttribute('fill', 'transparent')
    svg.appendChild(bgRect)

    const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    edgeLayer.setAttribute('class', 'gn-edge-layer')
    svg.appendChild(edgeLayer)

    const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    nodeLayer.setAttribute('class', 'gn-node-layer')
    svg.appendChild(nodeLayer)

    const rect = svg.getBoundingClientRect()
    const W = rect.width || 1200
    const H = rect.height || 800

    // ── Build node lists ──────────────────────────────────────
    const { services, databases, brokers, edges } = topology

    type D3Node = d3.SimulationNodeDatum & { id: string; kind: 'service' | 'database' | 'broker' }

    const d3Nodes: D3Node[] = [
      ...services.map(s => ({
        id: s.id, kind: 'service' as const,
        x: W / 2 + (Math.random() - 0.5) * W * 0.5,
        y: H / 2 + (Math.random() - 0.5) * H * 0.5,
      })),
      ...databases.map(db => ({
        id: db.id, kind: 'database' as const,
        x: W / 2 + (Math.random() - 0.5) * W * 0.5,
        y: H / 2 + (Math.random() - 0.5) * H * 0.5,
      })),
      ...brokers.map(br => ({
        id: br.id, kind: 'broker' as const,
        x: W / 2 + (Math.random() - 0.5) * W * 0.5,
        y: H / 2 + (Math.random() - 0.5) * H * 0.5,
      })),
    ]

    // ── Edges: service→service, service→db, service→broker ──
    const nodeIds = new Set(d3Nodes.map(n => n.id))
    const d3Links = edges
      .filter(e => nodeIds.has(e.from) && nodeIds.has(e.to))
      .map(e => ({ source: e.from, target: e.to, kind: e.kind }))

    // ── Create DOM nodes ──────────────────────────────────────
    const nodeMap = new Map<string, GaiaNode>()

    for (const svc of services) {
      const gNode = createServiceNode(svc.id, svc.name, svc.endpoints.length)
      nodeMap.set(svc.id, gNode)
      nodeLayer.appendChild(gNode)
    }
    for (const db of databases) {
      const gNode = createDatabaseNode(db.id, db.name, db.metadata.engine)
      nodeMap.set(db.id, gNode)
      nodeLayer.appendChild(gNode)
    }
    for (const br of brokers) {
      const gNode = createBrokerNode(br.id, br.name, br.metadata.engine)
      nodeMap.set(br.id, gNode)
      nodeLayer.appendChild(gNode)
    }

    // ── Edges ─────────────────────────────────────────────────
    const allEdges: GaiaEdge[] = []
    for (const link of d3Links) {
      const src = nodeMap.get(link.source as string)
      const tgt = nodeMap.get(link.target as string)
      if (src && tgt) {
        const edge = createEdge(src, tgt, link.kind)
        edgeLayer.appendChild(edge)
        allEdges.push(edge as GaiaEdge)
      }
    }

    // ── D3 force simulation ───────────────────────────────────
    const sim = d3.forceSimulation(d3Nodes)
      .force('charge', d3.forceManyBody<D3Node>().strength(d => d.kind === 'service' ? -900 : -500))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.05))
      .force('collide', d3.forceCollide<D3Node>(d => d.kind === 'service' ? 110 : 70).strength(0.9))
      .force('x', d3.forceX(W / 2).strength(0.04))
      .force('y', d3.forceY(H / 2).strength(0.04))
      .force('link', d3.forceLink<D3Node, { source: string; target: string }>(d3Links)
        .id(d => d.id)
        .distance(180)
        .strength(0.4)
      )
      .alphaDecay(0.025)
      .velocityDecay(0.4)

    sim.on('tick', () => {
      d3Nodes.forEach(dn => {
        const gNode = nodeMap.get(dn.id)
        if (gNode && dn.x != null && dn.y != null) gNode.setPosition(dn.x, dn.y)
      })
      allEdges.forEach(e => e.update())
    })

    // ── Drag ─────────────────────────────────────────────────
    nodeMap.forEach((gNode, id) => {
      const dn = d3Nodes.find(n => n.id === id)
      enableDrag(gNode, svg, () => {
        if (dn) { dn.fx = gNode.__x; dn.fy = gNode.__y }
        sim.alpha(0.15).restart()
      })
    })

    // ── Click: service → navigate; db/broker → select ────────
    nodeLayer.addEventListener('gn-click', (e: Event) => {
      const target = (e as CustomEvent).target as SVGGElement | null
      const nodeEl = target?.closest('[data-id]') as SVGGElement | null
      const nodeId = nodeEl?.getAttribute('data-id')
      if (!nodeId) return

      if (services.find(s => s.id === nodeId)) {
        triggerTap(nodeMap.get(nodeId)!)
        navigateTo('service', nodeId)
        return
      }
      selectNode(selectedNodeId === nodeId ? null : nodeId)
    })

    // ── Double-click → detail panel ───────────────────────────
    nodeLayer.addEventListener('gn-dblclick', (e: Event) => {
      const target = (e as CustomEvent).target as SVGGElement | null
      const nodeEl = target?.closest('[data-id]') as SVGGElement | null
      const nodeId = nodeEl?.getAttribute('data-id')
      if (!nodeId) return

      const svc = services.find(s => s.id === nodeId)
      if (svc) {
        const fields: NodeDetailInfo['fields'] = []
        if (svc.metadata.language) fields.push({ key: 'language', value: svc.metadata.language })
        if (svc.metadata.framework) fields.push({ key: 'framework', value: svc.metadata.framework })
        fields.push({ key: 'endpoints', value: svc.endpoints.length })
        setDetailInfo({ id: svc.id, label: svc.name, kind: 'service', fields })
        return
      }
      const db = databases.find(d => d.id === nodeId)
      if (db) {
        setDetailInfo({ id: db.id, label: db.name, kind: 'database', fields: [{ key: 'engine', value: db.metadata.engine }] })
        return
      }
      const br = brokers.find(b => b.id === nodeId)
      if (br) {
        setDetailInfo({ id: br.id, label: br.name, kind: 'broker', fields: [{ key: 'engine', value: br.metadata.engine }] })
      }
    })

    // ── Zoom/pan ──────────────────────────────────────────────
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    const zp = enableZoomPan(svg, nodeLayer, () => { selectNode(null) })
    zpRef.current = zp

    setTimeout(() => { zp.fitContent(100); setZoom(zp.getScale()) }, 1200)

    return () => {
      zp.destroy()
      sim.stop()
    }
  }, [topology]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selection sync ────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    svg.querySelectorAll('.gn-node--selected').forEach(n => n.classList.remove('gn-node--selected'))
    if (selectedNodeId) {
      svg.querySelector(`[data-id="${selectedNodeId}"]`)?.classList.add('gn-node--selected')
    }
  }, [selectedNodeId])

  const handleFit     = useCallback(() => zpRef.current?.fitContent(100), [])
  const handleZoomIn  = useCallback(() => { zpRef.current?.zoomIn();  setZoom(zpRef.current?.getScale() ?? 1) }, [])
  const handleZoomOut = useCallback(() => { zpRef.current?.zoomOut(); setZoom(zpRef.current?.getScale() ?? 1) }, [])

  return (
    <div className={styles.container}>
      <svg ref={svgRef} className={styles.svg} viewBox="0 0 1200 800" />

      {!topology && status !== 'loading' && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>◎</div>
          <div className={styles.emptyTitle}>Nenhuma topologia carregada</div>
        </div>
      )}

      {status === 'loading' && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>⟳</div>
          <div className={styles.emptyTitle}>Carregando…</div>
        </div>
      )}

      {status === 'error' && (
        <div className={styles.errorBanner}>
          <span>⚠</span> Falha ao carregar topologia
        </div>
      )}

      <ZoomControls zoom={zoom} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onFit={handleFit} />
      {detailInfo && <NodeDetailPanel info={detailInfo} onClose={() => setDetailInfo(null)} />}
    </div>
  )
}
