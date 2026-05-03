import React, { useEffect, useMemo, useState, useCallback } from 'react'
import styles from './SimulatorPanel.module.css'
import { topologyApi } from '@/api/topology.api'
import type { SimulationResult, SimulationToggles } from '@/api/types'

interface Props {
  topologyId: string
  endpointId: string
  onResult?: (result: SimulationResult | null) => void
  onClose: () => void
}

interface Discoverable {
  externals: { id: string; label: string }[]
  dbOps:     { id: string; label: string }[]
  middlewares: { name: string; kind: string }[]
}

/** Extracts toggleable knobs from a baseline (no-toggles) simulation result. */
function discover(result: SimulationResult): Discoverable {
  const externals = result.externals.map(e => ({
    id: e.nodeId,
    label: `${e.method ?? '?'} ${e.path ?? e.baseUrl ?? e.nodeId}`,
  }))
  const dbOps = result.dbOps.map(d => ({
    id: d.nodeId,
    label: `${d.operation}${d.tableId ? ` ${d.tableId}` : ''}`,
  }))
  // De-dupe middlewares by name (a single guard might fire on every endpoint hit, but the toggle is name-based)
  const seenMw = new Set<string>()
  const middlewares: Discoverable['middlewares'] = []
  for (const mw of result.middlewares) {
    if (seenMw.has(mw.name)) continue
    seenMw.add(mw.name)
    middlewares.push({ name: mw.name, kind: mw.kind })
  }
  return { externals, dbOps, middlewares }
}

export function SimulatorPanel({ topologyId, endpointId, onResult, onClose }: Props) {
  const [baseline, setBaseline] = useState<SimulationResult | null>(null)
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [failingExternalIds, setFailingExternalIds] = useState<Set<string>>(new Set())
  const [failingDbIds, setFailingDbIds] = useState<Set<string>>(new Set())
  const [failingMiddleware, setFailingMiddleware] = useState<Set<string>>(new Set())

  // Initial discovery: run the simulator without toggles to learn what's available.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setBaseline(null)
    setResult(null)
    onResult?.(null)
    setFailingExternalIds(new Set())
    setFailingDbIds(new Set())
    setFailingMiddleware(new Set())

    topologyApi.simulateEndpoint(topologyId, endpointId)
      .then(r => {
        if (cancelled) return
        setBaseline(r)
        setResult(r)
        onResult?.(r)
      })
      .catch(err => { if (!cancelled) setError(err?.message ?? 'simulate failed') })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
    // onResult is intentionally omitted — it's a stable callback from parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyId, endpointId])

  const discoverable = useMemo(() => baseline ? discover(baseline) : null, [baseline])

  const togglesActive =
    failingExternalIds.size + failingDbIds.size + failingMiddleware.size > 0

  const run = useCallback(() => {
    let cancelled = false
    const toggles: SimulationToggles = {
      failingExternalIds: failingExternalIds.size ? [...failingExternalIds] : undefined,
      failingDbIds:       failingDbIds.size       ? [...failingDbIds]       : undefined,
      failingMiddleware:  failingMiddleware.size  ? [...failingMiddleware]  : undefined,
    }
    setLoading(true)
    setError(null)
    topologyApi.simulateEndpoint(topologyId, endpointId, { toggles })
      .then(r => {
        if (cancelled) return
        setResult(r)
        onResult?.(r)
      })
      .catch(err => { if (!cancelled) setError(err?.message ?? 'simulate failed') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [topologyId, endpointId, failingExternalIds, failingDbIds, failingMiddleware, onResult])

  const reset = useCallback(() => {
    setFailingExternalIds(new Set())
    setFailingDbIds(new Set())
    setFailingMiddleware(new Set())
    if (baseline) {
      setResult(baseline)
      onResult?.(baseline)
    }
  }, [baseline, onResult])

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) {
    setter(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>simulator</span>
        <span className={styles.tag}>fase 8</span>
        <button className={styles.closeBtn} onClick={onClose}>×</button>
      </div>

      <div className={styles.body}>
        {error && <span className={styles.error}>{error}</span>}
        {loading && !baseline && <span className={styles.muted}>discovering toggles…</span>}

        {discoverable && (
          <>
            <div className={styles.section}>
              <span className={styles.sectionTitle}>middlewares</span>
              {discoverable.middlewares.length === 0
                ? <span className={styles.empty}>none</span>
                : discoverable.middlewares.map(mw => (
                  <label key={mw.name} className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={failingMiddleware.has(mw.name)}
                      onChange={() => toggleSet(setFailingMiddleware, mw.name)}
                    />
                    <span className={styles.toggleLabel}>{mw.name}</span>
                    <span className={styles.toggleMeta}>{mw.kind}</span>
                  </label>
                ))}
            </div>

            <div className={styles.section}>
              <span className={styles.sectionTitle}>external calls</span>
              {discoverable.externals.length === 0
                ? <span className={styles.empty}>none</span>
                : discoverable.externals.map(e => (
                  <label key={e.id} className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={failingExternalIds.has(e.id)}
                      onChange={() => toggleSet(setFailingExternalIds, e.id)}
                    />
                    <span className={styles.toggleLabel}>{e.label}</span>
                  </label>
                ))}
            </div>

            <div className={styles.section}>
              <span className={styles.sectionTitle}>db ops</span>
              {discoverable.dbOps.length === 0
                ? <span className={styles.empty}>none</span>
                : discoverable.dbOps.map(d => (
                  <label key={d.id} className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={failingDbIds.has(d.id)}
                      onChange={() => toggleSet(setFailingDbIds, d.id)}
                    />
                    <span className={styles.toggleLabel}>{d.label}</span>
                  </label>
                ))}
            </div>

            <div className={styles.runRow}>
              <button
                className={styles.runBtn}
                onClick={run}
                disabled={loading || !togglesActive}
                title={togglesActive ? 'Re-run simulation with selected failures' : 'Toggle a failure to enable'}
              >
                {loading ? 'running…' : 'inject failures'}
              </button>
              {togglesActive && (
                <button className={styles.clearBtn} onClick={reset}>reset</button>
              )}
            </div>
          </>
        )}

        {result && (
          <div className={styles.results}>
            <span className={styles.sectionTitle}>likely outcomes</span>
            <div className={styles.summary}>
              {result.likelyResponses.length === 0 && (
                <span className={styles.muted}>none reachable (every path is conditional)</span>
              )}
              {result.likelyResponses.map((lr, i) => lr.kind === 'throw' ? (
                <span key={i} className={`${styles.chip} ${styles.chipThrow}`}>
                  {lr.httpStatus ?? '5xx'} · {lr.errorClass}
                </span>
              ) : (
                <span key={i} className={`${styles.chip} ${styles.chipReturn}`}>
                  {lr.httpStatus ?? 200}
                </span>
              ))}
              {result.branches.length > 0 && (
                <span className={`${styles.chip} ${styles.chipBranch}`}>
                  {result.branches.length} branch{result.branches.length === 1 ? '' : 'es'}
                </span>
              )}
            </div>

            {result.throws.length > 0 && (
              <div className={styles.section}>
                <span className={styles.sectionTitle}>throws ({result.throws.length})</span>
                <div className={styles.list}>
                  {result.throws.map(t => (
                    <div
                      key={t.nodeId}
                      className={`${styles.listItem} ${t.triggeredBy ? styles.listItemForced : ''}`}
                      title={t.caught ? 'caught (try/catch or non-propagating)' : 'escapes to client'}
                    >
                      <span>{t.httpStatus ?? '—'}</span>
                      <span style={{ flex: 1 }}>{t.errorClass}</span>
                      <span style={{ color: t.caught ? 'var(--text-faint)' : 'var(--accent-red)' }}>
                        {t.caught ? 'caught' : t.triggeredBy ? `forced·${t.triggeredBy}` : 'escapes'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.returns.length > 0 && (
              <div className={styles.section}>
                <span className={styles.sectionTitle}>returns ({result.returns.length})</span>
                <div className={styles.list}>
                  {result.returns.map(r => (
                    <div
                      key={r.nodeId}
                      className={`${styles.listItem} ${r.conditional ? styles.listItemConditional : ''}`}
                    >
                      <span>{r.httpStatus ?? 200}</span>
                      <span style={{ flex: 1 }}>{r.conditional ? 'conditional' : 'unconditional'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
