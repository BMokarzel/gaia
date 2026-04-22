import React, { useRef, useState, useCallback } from 'react'
import styles from './NodeDetail.module.css'

export interface NodeDetailInfo {
  id: string
  label: string
  kind: string
  humanName?: string
  description?: string
  fields?: Array<{ key: string; value: string | number }>
  file?: string
  line?: number
}

interface Props {
  info: NodeDetailInfo
  onClose: () => void
  actions?: Array<{ label: string; onClick: () => void }>
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

export function NodeDetailPanel({ info, onClose, actions }: Props) {
  const [pos, setPos] = useState({ x: 60, y: 120 })
  const dragRef = useRef<{ ox: number; oy: number } | null>(null)

  // Drag only from the handle — not from the whole header (prevents stealing close button clicks)
  const onHandlePointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y }
  }, [pos])

  const onHandlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    setPos({ x: e.clientX - dragRef.current.ox, y: e.clientY - dragRef.current.oy })
  }, [])

  const onHandlePointerUp = useCallback(() => { dragRef.current = null }, [])

  const kindColor = KIND_COLORS[info.kind] ?? 'var(--text-muted)'
  const title = info.humanName ?? info.label

  return (
    <div className={styles.panel} style={{ left: pos.x, top: pos.y }}>
      <div className={styles.header}>
        <span
          className={styles.dragHandle}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          style={{ cursor: 'grab', touchAction: 'none' }}
        >⋮⋮</span>
        <div className={styles.titleBlock}>
          <span className={styles.title}>{title}</span>
          {info.humanName && info.humanName !== info.label && (
            <span className={styles.subtitle}>{info.label}</span>
          )}
        </div>
        <span className={styles.kindPill} style={{ borderColor: kindColor, color: kindColor }}>{info.kind}</span>
        <div style={{ flex: 1 }} />
        <button className={styles.closeBtn} onClick={onClose}>×</button>
      </div>

      <div className={styles.body}>
        {info.description && (
          <p className={styles.description}>{info.description}</p>
        )}
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
        {actions && actions.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            {actions.map(a => (
              <button key={a.label} onClick={a.onClick} style={{
                background: 'var(--color-accent, #7c6ff7)', color: '#fff',
                border: 'none', borderRadius: 4, padding: '5px 10px',
                fontSize: 12, cursor: 'pointer',
              }}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
