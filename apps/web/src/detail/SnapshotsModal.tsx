import React, { useEffect, useMemo, useState } from 'react'
import { topologyApi } from '@/api/topology.api'
import type { SnapshotMeta, SnapshotsResponse, TopologyDiff } from '@/api/types'
import styles from './SnapshotsModal.module.css'

interface Props {
  topologyId: string
  topologyName: string
  onClose: () => void
}

type SelKind = 'from' | 'to'

export function SnapshotsModal({ topologyId, topologyName, onClose }: Props) {
  const [snaps, setSnaps] = useState<SnapshotsResponse | null>(null)
  const [snapsErr, setSnapsErr] = useState<string | null>(null)
  const [snapsLoading, setSnapsLoading] = useState(true)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [reanalyzeErr, setReanalyzeErr] = useState<string | null>(null)

  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [diff, setDiff] = useState<TopologyDiff | null>(null)
  const [diffErr, setDiffErr] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  const refreshSnapshots = () => {
    setSnapsLoading(true)
    setSnapsErr(null)
    return topologyApi.getSnapshots(topologyId)
      .then(s => setSnaps(s))
      .catch(err => setSnapsErr(err?.message ?? 'failed'))
      .finally(() => setSnapsLoading(false))
  }

  // Initial load
  useEffect(() => {
    refreshSnapshots()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyId])

  // Default selection: from = oldest history (or current if none), to = current
  useEffect(() => {
    if (!snaps) return
    const currentSha = snaps.current?.sha ?? null
    if (!from && snaps.history.length > 0) {
      setFrom(snaps.history[snaps.history.length - 1].sha)
    } else if (!from && currentSha) {
      setFrom(currentSha)
    }
    if (!to) setTo(currentSha)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snaps])

  // Compute diff when both selected and they differ
  useEffect(() => {
    if (!from || !to) { setDiff(null); return }
    if (from === to) { setDiff(null); setDiffErr(null); return }
    let cancelled = false
    setDiffLoading(true)
    setDiffErr(null)
    topologyApi.getDiff(topologyId, from, to)
      .then(d => { if (!cancelled) setDiff(d) })
      .catch(err => { if (!cancelled) setDiffErr(err?.message ?? 'failed') })
      .finally(() => { if (!cancelled) setDiffLoading(false) })
    return () => { cancelled = true }
  }, [topologyId, from, to])

  const onReanalyze = async () => {
    setReanalyzing(true)
    setReanalyzeErr(null)
    try {
      await topologyApi.reanalyze(topologyId)
      await refreshSnapshots()
    } catch (err: any) {
      setReanalyzeErr(err?.message ?? 'failed')
    } finally {
      setReanalyzing(false)
    }
  }

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const allSnaps: SnapshotMeta[] = useMemo(() => {
    if (!snaps) return []
    const list: SnapshotMeta[] = []
    if (snaps.current) list.push(snaps.current)
    list.push(...snaps.history)
    return list
  }, [snaps])

  const selectSnap = (sha: string) => {
    if (from === null) { setFrom(sha); return }
    if (to === sha) { setTo(null); return }
    if (from === sha) { setFrom(null); return }
    setTo(sha)
  }

  const toggleSelKind = (sha: string, kind: SelKind) => {
    if (kind === 'from') setFrom(from === sha ? null : sha)
    else setTo(to === sha ? null : sha)
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.kindPill}>snapshots</span>
          <span className={styles.title}>{topologyName}</span>
          <button
            className={styles.actionBtn}
            onClick={onReanalyze}
            disabled={reanalyzing}
            title="Re-extract topology using stored source (archives current snapshot)"
          >
            {reanalyzing ? '⟳ re-analyzing…' : '↻ re-analyze'}
          </button>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        {reanalyzeErr && (
          <div className={styles.statusRow} style={{ color: 'var(--accent-red, #ff6b6b)' }}>
            ⚠ re-analyze failed: {reanalyzeErr}
          </div>
        )}

        <div className={styles.body}>
          <div className={styles.list}>
            <div className={styles.listHeader}>snapshots</div>
            <div className={styles.pickHint}>
              click to set <span style={{ color: 'var(--accent-red, #ff6b6b)' }}>from</span>, again for <span style={{ color: 'var(--accent-green)' }}>to</span>
            </div>
            {snapsLoading && (
              <div className={styles.statusRow}>
                <span className={styles.spinner} /> <span>loading…</span>
              </div>
            )}
            {snapsErr && (
              <div className={styles.statusRow} style={{ color: 'var(--accent-red, #ff6b6b)' }}>
                ⚠ {snapsErr}
              </div>
            )}
            {!snapsLoading && !snapsErr && allSnaps.length === 0 && (
              <div className={styles.statusRow}>no snapshots yet</div>
            )}
            {allSnaps.map((s, idx) => {
              const isCurrent = idx === 0
              const isFrom = s.sha === from
              const isTo = s.sha === to
              const cls = [
                styles.snapItem,
                isCurrent && styles.snapItemCurrent,
                isFrom && styles.snapItemFrom,
                isTo && styles.snapItemTo,
              ].filter(Boolean).join(' ')
              return (
                <div
                  key={s.sha}
                  className={cls}
                  onClick={(e) => {
                    if (e.shiftKey) toggleSelKind(s.sha, 'to')
                    else if (e.altKey) toggleSelKind(s.sha, 'from')
                    else selectSnap(s.sha)
                  }}
                  title="click: cycle from→to • alt+click: set from • shift+click: set to"
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className={styles.snapSha}>{shortenSha(s.sha)}</span>
                    {isCurrent && <span className={styles.snapTag}>current</span>}
                    {isFrom && !isCurrent && <span className={styles.snapTag} style={{ color: 'var(--accent-red, #ff6b6b)' }}>from</span>}
                    {isTo && !isCurrent && <span className={styles.snapTag}>to</span>}
                  </div>
                  <div className={styles.snapMeta}>analyzed: {formatTs(s.analyzedAt)}</div>
                  {s.archivedAt && (
                    <div className={styles.snapMeta}>archived: {formatTs(s.archivedAt)}</div>
                  )}
                </div>
              )
            })}
          </div>

          <div className={styles.diff}>
            {!from || !to ? (
              <div className={styles.diffPlaceholder}>
                pick two snapshots to view diff
              </div>
            ) : from === to ? (
              <div className={styles.diffPlaceholder}>
                from and to are the same snapshot
              </div>
            ) : diffLoading ? (
              <div className={styles.statusRow}>
                <span className={styles.spinner} /> <span>computing diff…</span>
              </div>
            ) : diffErr ? (
              <div className={styles.statusRow} style={{ color: 'var(--accent-red, #ff6b6b)' }}>
                ⚠ {diffErr}
              </div>
            ) : diff ? (
              <DiffBody diff={diff} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────

function DiffBody({ diff }: { diff: TopologyDiff }) {
  const noChanges = diff.summary.totalChanges === 0
  return (
    <>
      <div className={styles.diffSummary}>
        <span className={styles.summaryChip}>
          from {shortenSha(diff.from.sha)} → to {shortenSha(diff.to.sha)}
        </span>
        {diff.summary.servicesAdded > 0 && (
          <span className={`${styles.summaryChip} ${styles.summaryChipAdd}`}>+{diff.summary.servicesAdded} svc</span>
        )}
        {diff.summary.servicesRemoved > 0 && (
          <span className={`${styles.summaryChip} ${styles.summaryChipRem}`}>−{diff.summary.servicesRemoved} svc</span>
        )}
        {diff.summary.servicesModified > 0 && (
          <span className={`${styles.summaryChip} ${styles.summaryChipMod}`}>~{diff.summary.servicesModified} svc</span>
        )}
        {diff.summary.endpointsAdded > 0 && (
          <span className={`${styles.summaryChip} ${styles.summaryChipAdd}`}>+{diff.summary.endpointsAdded} ep</span>
        )}
        {diff.summary.endpointsRemoved > 0 && (
          <span className={`${styles.summaryChip} ${styles.summaryChipRem}`}>−{diff.summary.endpointsRemoved} ep</span>
        )}
        {diff.summary.endpointsModified > 0 && (
          <span className={`${styles.summaryChip} ${styles.summaryChipMod}`}>~{diff.summary.endpointsModified} ep</span>
        )}
      </div>

      {noChanges && (
        <div className={styles.diffPlaceholder}>no structural differences</div>
      )}

      {diff.services.added.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>services added</div>
          <ul className={styles.diffList}>
            {diff.services.added.map(s => (
              <li key={s.id} className={`${styles.diffItem} ${styles['diffItem--added']}`}>
                <span className={styles.diffMarker}>+</span>
                <span>{s.name} <span style={{ opacity: 0.6 }}>({s.id})</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {diff.services.removed.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>services removed</div>
          <ul className={styles.diffList}>
            {diff.services.removed.map(s => (
              <li key={s.id} className={`${styles.diffItem} ${styles['diffItem--removed']}`}>
                <span className={styles.diffMarker}>−</span>
                <span>{s.name} <span style={{ opacity: 0.6 }}>({s.id})</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {diff.services.modified.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>services modified</div>
          {diff.services.modified.map(s => (
            <div key={s.id} className={styles.serviceBlock}>
              <div className={styles.serviceTitle}>~ {s.name}</div>
              {s.changes.length > 0 && s.changes.map((c, i) => (
                <div key={i} className={styles.diffSubItem}>{c}</div>
              ))}
              {s.endpoints.added.map(ep => (
                <div key={ep.id} className={`${styles.diffItem} ${styles['diffItem--added']}`}>
                  <span className={styles.diffMarker}>+</span>
                  <span>{ep.method} {ep.path}</span>
                </div>
              ))}
              {s.endpoints.removed.map(ep => (
                <div key={ep.id} className={`${styles.diffItem} ${styles['diffItem--removed']}`}>
                  <span className={styles.diffMarker}>−</span>
                  <span>{ep.method} {ep.path}</span>
                </div>
              ))}
              {s.endpoints.modified.map(ep => (
                <div key={ep.id}>
                  <div className={`${styles.diffItem} ${styles['diffItem--modified']}`}>
                    <span className={styles.diffMarker}>~</span>
                    <span>{ep.method} {ep.path}</span>
                  </div>
                  {ep.changes.map((c, i) => (
                    <div key={i} className={styles.diffSubItem}>{c}</div>
                  ))}
                </div>
              ))}
              {s.databases.added.map(d => (
                <div key={`db-add-${d}`} className={`${styles.diffItem} ${styles['diffItem--added']}`} style={{ marginLeft: 12 }}>
                  <span className={styles.diffMarker}>+</span>
                  <span>db dep: {d}</span>
                </div>
              ))}
              {s.databases.removed.map(d => (
                <div key={`db-rem-${d}`} className={`${styles.diffItem} ${styles['diffItem--removed']}`} style={{ marginLeft: 12 }}>
                  <span className={styles.diffMarker}>−</span>
                  <span>db dep: {d}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {(diff.databases.added.length > 0 || diff.databases.removed.length > 0) && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>databases (topology-level)</div>
          <ul className={styles.diffList}>
            {diff.databases.added.map(d => (
              <li key={d.id} className={`${styles.diffItem} ${styles['diffItem--added']}`}>
                <span className={styles.diffMarker}>+</span>
                <span>{d.name} <span style={{ opacity: 0.6 }}>({d.id})</span></span>
              </li>
            ))}
            {diff.databases.removed.map(d => (
              <li key={d.id} className={`${styles.diffItem} ${styles['diffItem--removed']}`}>
                <span className={styles.diffMarker}>−</span>
                <span>{d.name} <span style={{ opacity: 0.6 }}>({d.id})</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(diff.edges.added.length > 0 || diff.edges.removed.length > 0) && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>edges</div>
          <ul className={styles.diffList}>
            {diff.edges.added.map((e, i) => (
              <li key={`a-${i}`} className={`${styles.diffItem} ${styles['diffItem--added']}`}>
                <span className={styles.diffMarker}>+</span>
                <span>{e.source} → {e.target} <span style={{ opacity: 0.6 }}>[{e.kind}]</span></span>
              </li>
            ))}
            {diff.edges.removed.map((e, i) => (
              <li key={`r-${i}`} className={`${styles.diffItem} ${styles['diffItem--removed']}`}>
                <span className={styles.diffMarker}>−</span>
                <span>{e.source} → {e.target} <span style={{ opacity: 0.6 }}>[{e.kind}]</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function shortenSha(sha: string): string {
  if (sha.startsWith('ts-')) return sha
  if (sha.length <= 10) return sha
  return sha.slice(0, 10)
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ts
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  } catch {
    return ts
  }
}
