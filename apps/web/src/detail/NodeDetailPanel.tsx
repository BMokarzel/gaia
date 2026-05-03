import React, { useRef, useState, useCallback, useEffect } from 'react'
import styles from './NodeDetail.module.css'
import { topologyApi, type SourceSnippet } from '@/api/topology.api'
import type { ServiceMetrics, EndpointMetrics } from '@/api/types'

export interface NodeDetailInfo {
  id: string
  label: string
  kind: string
  humanName?: string
  description?: string
  fields?: Array<{ key: string; value: string | number }>
  file?: string
  line?: number
  /** Required to fetch source snippet from API */
  topologyId?: string
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

  // ── Source snippet (Fase 2 #2) ───────────────────────────────────
  const [snippet, setSnippet] = useState<SourceSnippet | null>(null)
  const [snippetError, setSnippetError] = useState<string | null>(null)
  const [snippetLoading, setSnippetLoading] = useState(false)

  useEffect(() => {
    setSnippet(null)
    setSnippetError(null)
    if (!info.topologyId || !info.file || !info.line) return
    let cancelled = false
    setSnippetLoading(true)
    topologyApi
      .getSourceSnippet(info.topologyId, info.file, info.line, 8)
      .then(s => { if (!cancelled) setSnippet(s) })
      .catch(err => { if (!cancelled) setSnippetError(err?.message ?? 'failed') })
      .finally(() => { if (!cancelled) setSnippetLoading(false) })
    return () => { cancelled = true }
  }, [info.topologyId, info.file, info.line])

  // ── Runtime metrics (Fase 4) ─────────────────────────────────────
  // Only meaningful for service/endpoint nodes; backed by the mock
  // provider until a real OTel/Prometheus source is wired up.
  const [runtime, setRuntime] = useState<ServiceMetrics | EndpointMetrics | null>(null)
  const [runtimeLoading, setRuntimeLoading] = useState(false)

  useEffect(() => {
    setRuntime(null)
    if (!info.topologyId) return
    if (info.kind !== 'service' && info.kind !== 'endpoint') return
    let cancelled = false
    setRuntimeLoading(true)
    topologyApi
      .getRuntime(info.topologyId)
      .then(rt => {
        if (cancelled) return
        const m = info.kind === 'service'
          ? rt.services.find(s => s.serviceId === info.id)
          : rt.endpoints.find(e => e.endpointId === info.id)
        setRuntime(m ?? null)
      })
      .catch(() => { /* runtime is optional — ignore */ })
      .finally(() => { if (!cancelled) setRuntimeLoading(false) })
    return () => { cancelled = true }
  }, [info.topologyId, info.id, info.kind])

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
        {(snippet || snippetLoading || snippetError) && (
          <div className={styles.snippet}>
            {snippetLoading && <span className={styles.snippetMuted}>loading source…</span>}
            {snippetError && (
              <span className={styles.snippetError}>source unavailable: {snippetError}</span>
            )}
            {snippet && (
              <pre className={styles.snippetPre}>
                {snippet.lines.map((ln, i) => {
                  const lineNo = snippet.startLine + i
                  const isFocus = lineNo === snippet.focusLine
                  return (
                    <div
                      key={lineNo}
                      className={`${styles.snippetLine} ${isFocus ? styles.snippetLineFocus : ''}`}
                    >
                      <span className={styles.snippetGutter}>{lineNo}</span>
                      <span className={styles.snippetCode}>{ln || ' '}</span>
                    </div>
                  )
                })}
              </pre>
            )}
          </div>
        )}
        {(runtime || runtimeLoading) && (
          <div className={styles.runtime}>
            <div className={styles.runtimeHeader}>
              <span>runtime <span className={styles.runtimeMockTag}>mock</span></span>
            </div>
            {runtimeLoading && !runtime && (
              <span className={styles.snippetMuted}>loading metrics…</span>
            )}
            {runtime && (
              <div className={styles.runtimeGrid}>
                <RuntimeStat label="rps" value={runtime.rps.toFixed(2)} />
                <RuntimeStat
                  label="err"
                  value={`${(runtime.errorRate * 100).toFixed(2)}%`}
                  tone={
                    runtime.errorRate >= 0.10 ? 'crit'
                    : runtime.errorRate >= 0.02 ? 'warn'
                    : 'ok'
                  }
                />
                <RuntimeStat label="p50" value={`${runtime.p50LatencyMs.toFixed(0)}ms`} />
                <RuntimeStat
                  label="p95"
                  value={`${runtime.p95LatencyMs.toFixed(0)}ms`}
                  tone={
                    runtime.p95LatencyMs >= 1500 ? 'crit'
                    : runtime.p95LatencyMs >= 500 ? 'warn'
                    : 'ok'
                  }
                />
              </div>
            )}
          </div>
        )}
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

function RuntimeStat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'crit' }) {
  const cls = tone === 'crit' ? styles.runtimeStatCrit
    : tone === 'warn' ? styles.runtimeStatWarn
    : styles.runtimeStatOk
  return (
    <div className={`${styles.runtimeStat} ${cls}`}>
      <span className={styles.runtimeStatLabel}>{label}</span>
      <span className={styles.runtimeStatValue}>{value}</span>
    </div>
  )
}
