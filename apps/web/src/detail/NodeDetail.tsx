import React, { useRef, useState, useCallback } from 'react'
import type { FlowNode } from '@/graph/layout/endpointLayout'
import styles from './NodeDetail.module.css'

interface NodeDetailProps {
  node: FlowNode
  onClose: () => void
}

export function NodeDetail({ node, onClose }: NodeDetailProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 60, y: 520 })
  const dragRef = useRef<{ ox: number; oy: number } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y }
  }, [pos])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    setPos({ x: e.clientX - dragRef.current.ox, y: e.clientY - dragRef.current.oy })
  }, [])

  const onPointerUp = useCallback(() => { dragRef.current = null }, [])

  const kindColor = {
    client:  'var(--accent-purple)',
    handler: 'var(--accent-green)',
    function:'var(--accent-green)',
    branch:  'var(--accent-orange)',
    db:      'var(--accent-blue)',
    return:  'var(--text-muted)',
    error:   'var(--accent-red)',
  }[node.kind] ?? 'var(--text-muted)'

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Drag handle / header */}
      <div
        className={styles.header}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className={styles.dragHandle}>⋮⋮</span>
        <span className={styles.title}>{node.label}</span>
        <span className={styles.kindPill} style={{ borderColor: kindColor, color: kindColor }}>{node.kind}</span>
        <div style={{ flex: 1 }} />
        <button className={styles.closeBtn} onClick={onClose}>×</button>
      </div>

      {/* Body */}
      <div className={styles.body}>
        {node.meta.file && (
          <div className={styles.location}>
            {node.meta.file}:{node.meta.line}
          </div>
        )}

        <div className={styles.fields}>
          {node.meta.condition && (
            <div className={styles.field}>
              <span className={styles.fieldKey}>condition</span>
              <span className={styles.fieldVal}>{node.meta.condition}</span>
            </div>
          )}
          {node.meta.operation && (
            <div className={styles.field}>
              <span className={styles.fieldKey}>operation</span>
              <span className={styles.fieldVal}>{node.meta.operation}</span>
            </div>
          )}
          {node.meta.status && (
            <div className={styles.field}>
              <span className={styles.fieldKey}>status</span>
              <span className={styles.fieldVal} style={{ color: node.meta.status >= 400 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                {node.meta.status}
              </span>
            </div>
          )}
          {node.meta.method && (
            <div className={styles.field}>
              <span className={styles.fieldKey}>method</span>
              <span className={styles.fieldVal}>{node.meta.method}</span>
            </div>
          )}
          {node.sub && (
            <div className={styles.field}>
              <span className={styles.fieldKey}>sub</span>
              <span className={styles.fieldVal}>{node.sub}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
