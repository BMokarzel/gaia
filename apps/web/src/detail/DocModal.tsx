import React, { useEffect, useState } from 'react'
import { topologyApi } from '@/api/topology.api'
import { renderMarkdown } from '@/utils/markdown'
import styles from './DocModal.module.css'

export type DocTarget =
  | { kind: 'service'; topologyId: string; serviceId: string; title: string }
  | { kind: 'endpoint'; topologyId: string; endpointId: string; title: string }

interface Props {
  target: DocTarget
  onClose: () => void
}

export function DocModal({ target, onClose }: Props) {
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setMarkdown(null)

    const promise = target.kind === 'service'
      ? topologyApi.getServiceDoc(target.topologyId, target.serviceId)
      : topologyApi.getEndpointDoc(target.topologyId, target.endpointId)

    promise
      .then(res => { if (!cancelled) setMarkdown(res.markdown) })
      .catch(err => { if (!cancelled) setError(err?.message ?? 'failed to generate doc') })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [target.kind, target.topologyId,
      target.kind === 'service' ? target.serviceId : target.endpointId])

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const onCopy = () => {
    if (markdown) navigator.clipboard?.writeText(markdown).catch(() => {})
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.kindPill}>{target.kind} doc</span>
          <span className={styles.title}>{target.title}</span>
          {markdown && (
            <button className={styles.copyBtn} onClick={onCopy} title="Copy markdown">
              copy
            </button>
          )}
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.body}>
          {loading && (
            <div className={styles.statusRow}>
              <span className={styles.spinner} />
              <span>generating documentation…</span>
            </div>
          )}
          {error && (
            <div className={styles.errorRow}>
              <span>⚠</span>
              <span>{error}</span>
            </div>
          )}
          {markdown && (
            <div
              dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

