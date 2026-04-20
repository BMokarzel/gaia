import React, { useRef, useState, useCallback } from 'react'
import styles from './NodeDetail.module.css'

export interface NodeDetailInfo {
  id: string
  label: string
  kind: string
  fields?: Array<{ key: string; value: string | number }>
  file?: string
  line?: number
}

interface Props {
  info: NodeDetailInfo
  onClose: () => void
}

const KIND_COLORS: Record<string, string> = {
  service:  'var(--accent-green)',
  database: 'var(--accent-blue)',
  broker:   'var(--accent-purple)',
  frontend: 'var(--accent-orange)',
  endpoint: 'var(--accent-green)',
  function: 'var(--accent-green)',
  control:  'var(--accent-orange)',
  return:   'var(--text-muted)',
  event:    'var(--accent-purple)',
  error:    'var(--accent-red)',
}

export function NodeDetailPanel({ info, onClose }: Props) {
  const [pos, setPos] = useState({ x: 60, y: 120 })
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

  const kindColor = KIND_COLORS[info.kind] ?? 'var(--text-muted)'

  return (
    <div className={styles.panel} style={{ left: pos.x, top: pos.y }}>
      <div
        className={styles.header}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className={styles.dragHandle}>⋮⋮</span>
        <span className={styles.title}>{info.label}</span>
        <span className={styles.kindPill} style={{ borderColor: kindColor, color: kindColor }}>{info.kind}</span>
        <div style={{ flex: 1 }} />
        <button className={styles.closeBtn} onClick={onClose}>×</button>
      </div>

      <div className={styles.body}>
        {info.file && (
          <div className={styles.location}>
            {info.file}{info.line != null ? `:${info.line}` : ''}
          </div>
        )}
        <div className={styles.fields}>
          <div className={styles.field}>
            <span className={styles.fieldKey}>id</span>
            <span className={styles.fieldVal}>{info.id}</span>
          </div>
          {info.fields?.map(f => (
            <div key={f.key} className={styles.field}>
              <span className={styles.fieldKey}>{f.key}</span>
              <span className={styles.fieldVal}>{String(f.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
