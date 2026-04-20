import React, { useEffect, useRef, useState, useCallback } from 'react'
import { ZoomControls } from '@/shell/ZoomControls'
import { useTopologyStore, useCurrentService } from '@/store/topologyStore'
import { buildServiceLayout } from '@/graph/layout/serviceLayout'
import {
  createEndpointNode, createDatabaseNode, createBrokerNode,
  createEdge, createGraphDefs, enableDrag, enableZoomPan,
  triggerTap, type GaiaNode, type GaiaEdge, type ZoomPanHandle,
} from '@/graph/gaiaNodes'
import { NodeDetailPanel, type NodeDetailInfo } from '@/detail/NodeDetailPanel'
import styles from './ServiceView.module.css'

export function ServiceView() {
  const { topology, navigateTo, selectedServiceId, selectNode } = useTopologyStore()
  const service = useCurrentService()
  const svgRef = useRef<SVGSVGElement>(null)
  const zpRef = useRef<ZoomPanHandle | null>(null)
  const [zoom, setZoom] = useState(1)
  const [detailInfo, setDetailInfo] = useState<NodeDetailInfo | null>(null)

  useEffect(() => {
    if (!service || !topology || !svgRef.current) return
    const svg = svgRef.current

    // ── clear ─────────────────────────────────────────────────
    while (svg.firstChild) svg.removeChild(svg.firstChild)

    const layout = buildServiceLayout(service, topology)

    svg.appendChild(createGraphDefs())

    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bgRect.setAttribute('class', 'gn-bg')
    bgRect.setAttribute('x', '-5000'); bgRect.setAttribute('y', '-5000')
    bgRect.setAttribute('width', '10000'); bgRect.setAttribute('height', '10000')
    bgRect.setAttribute('fill', 'transparent')
    svg.appendChild(bgRect)

    const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    svg.appendChild(edgeLayer)
    svg.appendChild(nodeLayer)

    const nodeMap = new Map<string, GaiaNode>()
    const allEdges: GaiaEdge[] = []

    for (const n of layout.nodes) {
      let gNode: GaiaNode
      if (n.kind === 'endpoint') {
        gNode = createEndpointNode(n.id, n.method ?? 'GET', n.label.replace((n.method ?? '') + ' ', ''))
      } else if (n.kind === 'database') {
        gNode = createDatabaseNode(n.id, n.label, n.sub)
      } else {
        gNode = createBrokerNode(n.id, n.label, n.sub)
      }
      gNode.setPosition(n.x, n.y)
      nodeLayer.appendChild(gNode)
      nodeMap.set(n.id, gNode)
    }

    for (const e of layout.edges) {
      const s = nodeMap.get(e.from), t = nodeMap.get(e.to)
      if (!s || !t) continue
      const edge = createEdge(s, t, e.kind)
      edgeLayer.appendChild(edge)
      allEdges.push(edge as GaiaEdge)
    }

    // drag
    nodeMap.forEach(gNode => {
      enableDrag(gNode, svg, () => allEdges.forEach(e => e.update()))
    })

    // click: endpoint → navigate to endpoint view
    nodeLayer.addEventListener('gn-click', (e: Event) => {
      const target = (e as Event).target as SVGGElement | null
      const nodeEl = target?.closest('[data-id]') as SVGGElement | null
      const nodeId = nodeEl?.getAttribute('data-id')
      if (!nodeId) return
      const ln = layout.nodes.find(n => n.id === nodeId)
      if (!ln) return
      triggerTap(nodeMap.get(nodeId)!)
      if (ln.kind === 'endpoint') {
        navigateTo('endpoint', selectedServiceId!, nodeId)
      }
    })

    // dblclick: show detail panel
    nodeLayer.addEventListener('gn-dblclick', (e: Event) => {
      const target = (e as Event).target as SVGGElement | null
      const nodeEl = target?.closest('[data-id]') as SVGGElement | null
      const nodeId = nodeEl?.getAttribute('data-id')
      if (!nodeId) return
      const ln = layout.nodes.find(n => n.id === nodeId)
      if (!ln) return
      const fields: NodeDetailInfo['fields'] = [{ key: 'type', value: ln.kind }]
      if (ln.method) fields.push({ key: 'method', value: ln.method })
      if (ln.sub) fields.push({ key: 'sub', value: ln.sub })
      setDetailInfo({ id: nodeId, label: ln.label, kind: ln.kind, fields })
    })

    // zoom/pan
    const rect = svg.getBoundingClientRect()
    const W = rect.width || 1200
    const H = rect.height || 800
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    const zp = enableZoomPan(svg, nodeLayer, () => {
      selectNode(null)
      allEdges.forEach(e => { e.classList.remove('is-lit', 'is-firing') })
    })
    zpRef.current = zp

    setTimeout(() => { zp.fitContent(80); setZoom(zp.getScale()) }, 150)

    return () => { zp.destroy() }
  }, [service, topology]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFit = useCallback(() => zpRef.current?.fitContent(80), [])
  const handleZoomIn = useCallback(() => { zpRef.current?.zoomIn(); setZoom(zpRef.current?.getScale() ?? 1) }, [])
  const handleZoomOut = useCallback(() => { zpRef.current?.zoomOut(); setZoom(zpRef.current?.getScale() ?? 1) }, [])

  if (!service || !topology) return null

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerName}>{service.name}</div>
        <div className={styles.headerMeta}>
          {service.metadata.language && <span className={styles.badge}>{service.metadata.language}</span>}
          {service.metadata.framework && <span className={styles.badge}>{service.metadata.framework}</span>}
          <span className={styles.badge}>{service.endpoints.length} endpoints</span>
        </div>
      </div>

      <svg ref={svgRef} className={styles.svg} viewBox="0 0 1200 800" />

      <ZoomControls zoom={zoom} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onFit={handleFit} />
      {detailInfo && <NodeDetailPanel info={detailInfo} onClose={() => setDetailInfo(null)} />}
    </div>
  )
}
