import React, { useEffect, useRef, useState, useCallback } from 'react'
import { ZoomControls } from '@/shell/ZoomControls'
import { useTopologyStore, type ExportGraph, type ExportNode, type ExportEdge } from '@/store/topologyStore'
import { buildServiceLayout } from '@/graph/layout/serviceLayout'
import {
  createEndpointNode, createDatabaseNode, createBrokerNode,
  createEdge, createGraphDefs, enableDrag, enableZoomPan,
  triggerTap, setNodeState, setNodeSubtitle, type GaiaNode, type GaiaEdge, type ZoomPanHandle,
} from '@/graph/gaiaNodes'
import { NodeDetailPanel, type NodeDetailInfo } from '@/detail/NodeDetailPanel'
import styles from './ServiceView.module.css'

export function ServiceView() {
  const {
    activeTopology, navigation,
    loadService, serviceStatus, serviceError,
    navigateToEndpoint, selectNode, setExportReady,
  } = useTopologyStore()

  const { serviceId } = navigation
  // Primary: match by service id (new topologies use repoName as service id)
  // Fallback: use first service when the topology was loaded by file id (legacy nanoid ids)
  const service = activeTopology
    ? (activeTopology.services.find(s => s.id === serviceId) ?? activeTopology.services[0] ?? null)
    : null

  const svgRef = useRef<SVGSVGElement>(null)
  const zpRef = useRef<ZoomPanHandle | null>(null)
  const [zoom, setZoom] = useState(1)
  const [detailInfo, setDetailInfo] = useState<NodeDetailInfo | null>(null)

  // Load topology if needed
  useEffect(() => {
    if (serviceId && serviceStatus === 'idle') loadService(serviceId)
  }, [serviceId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!service || !activeTopology || !svgRef.current) return
    const svg = svgRef.current

    while (svg.firstChild) svg.removeChild(svg.firstChild)

    const layout = buildServiceLayout(service, activeTopology)

    svg.appendChild(createGraphDefs())

    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bgRect.setAttribute('class', 'gn-bg')
    bgRect.setAttribute('x', '-5000'); bgRect.setAttribute('y', '-5000')
    bgRect.setAttribute('width', '10000'); bgRect.setAttribute('height', '10000')
    bgRect.setAttribute('fill', 'transparent')
    svg.appendChild(bgRect)

    const zoomG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const containerLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    zoomG.appendChild(containerLayer)
    zoomG.appendChild(edgeLayer)
    zoomG.appendChild(nodeLayer)
    svg.appendChild(zoomG)

    // Render service container
    const { container } = layout
    const cRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    cRect.setAttribute('x', String(container.x))
    cRect.setAttribute('y', String(container.y))
    cRect.setAttribute('width', String(container.width))
    cRect.setAttribute('height', String(container.height))
    cRect.setAttribute('rx', '14')
    cRect.setAttribute('fill', 'rgba(57,255,110,0.03)')
    cRect.setAttribute('stroke', 'rgba(57,255,110,0.18)')
    cRect.setAttribute('stroke-width', '1')
    cRect.setAttribute('stroke-dasharray', '6 4')
    containerLayer.appendChild(cRect)

    const cLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    cLabel.setAttribute('x', String(container.x + 14))
    cLabel.setAttribute('y', String(container.y + 18))
    cLabel.setAttribute('fill', 'rgba(57,255,110,0.45)')
    cLabel.setAttribute('font-size', '11')
    cLabel.setAttribute('font-family', 'Space Grotesk, sans-serif')
    cLabel.setAttribute('font-weight', '500')
    cLabel.setAttribute('letter-spacing', '0.04em')
    cLabel.textContent = container.label
    containerLayer.appendChild(cLabel)

    const nodeMap = new Map<string, GaiaNode>()
    const endpointIds = new Set(layout.nodes.filter(n => n.kind === 'endpoint').map(n => n.id))

    for (const n of layout.nodes) {
      let gNode: GaiaNode
      if (n.kind === 'endpoint') {
        gNode = createEndpointNode(n.id, n.method ?? 'GET', n.label.replace((n.method ?? '') + ' ', ''))
        const ep = service?.endpoints.find(ep => ep.id === n.id)
        setNodeSubtitle(gNode, ep?.metadata?.llm?.humanName)
      } else if (n.kind === 'database') {
        gNode = createDatabaseNode(n.id, n.label, n.sub)
      } else {
        gNode = createBrokerNode(n.id, n.label, n.sub)
      }
      gNode.setPosition(n.x, n.y)
      nodeLayer.appendChild(gNode)
      nodeMap.set(n.id, gNode)
    }

    interface EdgeData { el: GaiaEdge; from: string; to: string; internal: boolean }
    const edgeDataList: EdgeData[] = []

    for (const e of layout.edges) {
      const s = nodeMap.get(e.from), t = nodeMap.get(e.to)
      if (!s || !t) continue
      const edge = createEdge(s, t, e.kind) as GaiaEdge
      const isInternal = endpointIds.has(e.from) && endpointIds.has(e.to)
      if (isInternal) edge.setAttribute('opacity', '0')
      edgeLayer.appendChild(edge)
      edgeDataList.push({ el: edge, from: e.from, to: e.to, internal: isInternal })
    }

    const allEdges = edgeDataList.map(d => d.el)

    nodeMap.forEach(gNode => {
      enableDrag(gNode, svg, () => allEdges.forEach(e => e.update()))
    })

    const resetHighlights = () => {
      edgeDataList.forEach(({ el, internal }) => {
        el.setAttribute('opacity', internal ? '0' : '1')
      })
      nodeMap.forEach(gNode => setNodeState(gNode, 'default'))
    }

    bgRect.addEventListener('click', () => {
      resetHighlights()
      selectNode(null)
      setDetailInfo(null)
    })

    // Single click on endpoint → highlight + show outgoing edges
    nodeLayer.addEventListener('gn-click', (e: Event) => {
      const target = (e as Event).target as SVGGElement | null
      const nodeEl = target?.closest('[data-id]') as SVGGElement | null
      const nodeId = nodeEl?.getAttribute('data-id')
      if (!nodeId) return
      const ln = layout.nodes.find(n => n.id === nodeId)
      if (!ln) return
      const gNode = nodeMap.get(nodeId)
      if (gNode) triggerTap(gNode)
      if (ln.kind !== 'endpoint') return

      selectNode(nodeId)
      nodeMap.forEach((g, id) => setNodeState(g, id === nodeId ? 'selected' : 'default'))
      edgeDataList.forEach(({ el, from, internal }) => {
        el.setAttribute('opacity', from === nodeId ? '1' : internal ? '0' : '1')
      })
    })

    // Double click → info panel with "Ver fluxo" button
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
      const ep = service?.endpoints.find(ep => ep.id === nodeId)
      const llm = ep?.metadata?.llm ?? ((ln.kind as string) === 'service' ? service?.metadata?.llm : undefined)
      setDetailInfo({ id: nodeId, label: ln.label, kind: ln.kind, humanName: llm?.humanName, description: llm?.description, fields })
    })

    const rect = svg.getBoundingClientRect()
    const W = rect.width || 1200
    const H = rect.height || 800
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    const zp = enableZoomPan(svg, zoomG, () => {
      resetHighlights()
      selectNode(null)
      allEdges.forEach(e => { e.classList.remove('is-lit', 'is-firing') })
    })
    zpRef.current = zp
    setTimeout(() => { zp.fitContent(80); setZoom(zp.getScale()) }, 150)

    // Register export snapshot for the export menu
    const exportFn = (): ExportGraph => {
      const nodes: ExportNode[] = [...nodeMap.values()].map(n => {
        const id = n.getAttribute('data-id') ?? ''
        const type = n.getAttribute('data-type') ?? n.__type
        const labelEl = n.querySelector<SVGElement>('.gn-node__title')
        const label = labelEl?.textContent ?? id
        const subLabelEl = n.querySelector<SVGElement>('.gn-node__meta')
        const subLabel = subLabelEl?.textContent ?? undefined
        return { id, type, label, subLabel, x: n.__x, y: n.__y, w: n.__bounds.w, h: n.__bounds.h, shape: n.__bounds.shape }
      })
      const edges: ExportEdge[] = edgeDataList.map(({ el: e }) => ({
        fromId: e.__source.getAttribute('data-id') ?? '',
        toId: e.__target.getAttribute('data-id') ?? '',
      }))
      return { title: service.name, nodes, edges }
    }
    setExportReady(exportFn)

    return () => { zp.destroy(); setExportReady(null) }
  }, [service, activeTopology]) // eslint-disable-line react-hooks/exhaustive-deps

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

  if (serviceStatus === 'loading') {
    return (
      <div className={styles.container} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', opacity: 0.6 }}>
          <div style={{ fontSize: 32 }}>⟳</div>
          <div>Carregando serviço…</div>
        </div>
      </div>
    )
  }

  if (serviceStatus === 'error') {
    return (
      <div className={styles.container} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--color-error)', textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>⚠</div>
          <div>{serviceError ?? 'Falha ao carregar serviço'}</div>
        </div>
      </div>
    )
  }

  if (!service || !activeTopology) return null

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
      {detailInfo && (
        <NodeDetailPanel
          info={detailInfo}
          onClose={() => setDetailInfo(null)}
          actions={detailInfo.kind === 'endpoint' && serviceId
            ? [{ label: 'Ver fluxo', onClick: () => { navigateToEndpoint(serviceId, detailInfo.id); setDetailInfo(null) } }]
            : undefined
          }
        />
      )}
    </div>
  )
}
