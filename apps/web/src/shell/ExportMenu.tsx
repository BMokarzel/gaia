import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useTopologyStore } from '@/store/topologyStore'
import { toDrawioXml, downloadFile } from '@/export/drawio'
import { buildEndpointDoc, buildServiceDoc } from '@/export/document'
import styles from './ExportMenu.module.css'

export function ExportMenu() {
  const { exportReady, navigation, activeTopology } = useTopologyStore()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<'drawio' | 'document' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const getGraph = useCallback(() => {
    if (!exportReady) return null
    try { return exportReady() } catch { return null }
  }, [exportReady])

  const handleDrawio = useCallback(async () => {
    setError(null)
    setLoading('drawio')
    try {
      const graph = getGraph()
      if (!graph) throw new Error('No graph available')
      const xml = toDrawioXml(graph)
      downloadFile(xml, `${graph.title}.drawio`, 'application/xml')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(null)
      setOpen(false)
    }
  }, [getGraph])

  const handleDocument = useCallback(async () => {
    setError(null)
    setLoading('document')
    try {
      const graph = getGraph()
      if (!graph || !activeTopology) throw new Error('No graph available')

      const { screen, serviceId, endpointId } = navigation
      const service = activeTopology.services.find(s =>
        screen === 'endpoint'
          ? s.endpoints.some(e => e.id === endpointId)
          : s.id === serviceId
      ) ?? activeTopology.services[0]

      let markdown: string
      if (screen === 'endpoint' && endpointId) {
        const endpoint = service.endpoints.find(e => e.id === endpointId)
        if (!endpoint) throw new Error('Endpoint not found')
        markdown = await buildEndpointDoc(endpoint, service, activeTopology, graph.title)
      } else {
        markdown = await buildServiceDoc(service, activeTopology, graph.title)
      }

      downloadFile(markdown, `${graph.title}.md`, 'text/markdown')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(null)
      setOpen(false)
    }
  }, [getGraph, navigation, activeTopology])

  if (!exportReady) return null

  return (
    <div className={styles.wrap} ref={menuRef}>
      <button
        className={styles.trigger}
        onClick={() => setOpen(o => !o)}
        title="Export"
        disabled={loading !== null}
      >
        {loading ? <span className={styles.spinner}>⟳</span> : '↓'}
        <span className={styles.label}>Export</span>
      </button>

      {open && (
        <div className={styles.dropdown}>
          {error && <div className={styles.error}>{error}</div>}
          <button className={styles.option} onClick={handleDrawio} disabled={loading !== null}>
            <span className={styles.optIcon}>⬡</span>
            <div className={styles.optText}>
              <span className={styles.optTitle}>draw.io</span>
              <span className={styles.optSub}>Diagrama importável no Confluence</span>
            </div>
          </button>
          <button className={styles.option} onClick={handleDocument} disabled={loading !== null}>
            {loading === 'document'
              ? <span className={`${styles.optIcon} ${styles.spinner}`}>⟳</span>
              : <span className={styles.optIcon}>◈</span>
            }
            <div className={styles.optText}>
              <span className={styles.optTitle}>Document</span>
              <span className={styles.optSub}>Markdown com IA · Confluence-ready</span>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}
