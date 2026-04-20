import React, { useState } from 'react'
import { useTopologyStore } from '@/store/topologyStore'
import { topologyApi } from '@/api/topology.api'
import type { AnalyzeRequest, SourceDescriptor } from '@/api/types'
import { NeuralBackground } from './NeuralBackground'
import styles from './HomeView.module.css'

// ── Icons ────────────────────────────────────────────────────────────────────

const IconNavigate = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2.5"/>
    <path d="M16.5 7.5a6.5 6.5 0 0 1 0 9M7.5 16.5a6.5 6.5 0 0 1 0-9"/>
    <path d="M20.5 3.5a12 12 0 0 1 0 17M3.5 20.5a12 12 0 0 1 0-17"/>
  </svg>
)

const IconExtract = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
)

const IconConfig = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

const IconDashboard = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="14" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/>
  </svg>
)

const IconSun = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
)

const IconMoon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
)

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActionCardProps {
  icon: React.ReactNode
  title: string
  desc: string
  accent?: string
  onClick?: () => void
  disabled?: boolean
  soon?: boolean
  loading?: boolean
}

// ── ActionCard ────────────────────────────────────────────────────────────────

function ActionCard({ icon, title, desc, accent, onClick, disabled, soon, loading }: ActionCardProps) {
  return (
    <button
      className={`${styles.card} ${disabled ? styles.cardDisabled : ''}`}
      style={accent ? { '--card-accent': accent } as React.CSSProperties : undefined}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
    >
      <div className={styles.cardIcon}>{icon}</div>
      <div className={styles.cardBody}>
        <span className={styles.cardTitle}>{loading ? `${title}…` : title}</span>
        <span className={styles.cardDesc}>{desc}</span>
      </div>
      {soon && <span className={styles.cardSoon}>em breve</span>}
    </button>
  )
}

// ── ExtractModal ──────────────────────────────────────────────────────────────

interface ExtractModalProps {
  onClose: () => void
  onSuccess: () => void
}

function ExtractModal({ onClose, onSuccess }: ExtractModalProps) {
  const { setTopology, goApp } = useTopologyStore()

  const [form, setForm] = useState<{
    kind: 'local' | 'git'
    path: string
    url: string
    branch: string
    name: string
    clonePolicy: 'persist' | 'delete'
  }>({ kind: 'local', path: '', url: '', branch: '', name: '', clonePolicy: 'delete' })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)
    try {
      const source: SourceDescriptor = form.kind === 'local'
        ? { kind: 'local', path: form.path }
        : { kind: 'git', url: form.url, branch: form.branch || undefined }
      const req: AnalyzeRequest = {
        source,
        name: form.name || undefined,
        clonePolicy: form.kind === 'git' ? form.clonePolicy : undefined,
        options: { skipTests: false },
      }
      const stored = await topologyApi.analyze(req)
      setTopology(stored.topology)
      goApp()
    } catch (err) {
      setSubmitError((err as Error).message)
      setSubmitting(false)
    }
  }

  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className={styles.backdrop} onClick={handleBackdrop}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>Extrair topologia</span>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.fieldRow}>
            <label className={styles.label}>Fonte</label>
            <div className={styles.toggle}>
              <button type="button"
                className={`${styles.toggleBtn} ${form.kind === 'local' ? styles.toggleBtnActive : ''}`}
                onClick={() => setForm(f => ({ ...f, kind: 'local' }))}>local</button>
              <button type="button"
                className={`${styles.toggleBtn} ${form.kind === 'git' ? styles.toggleBtnActive : ''}`}
                onClick={() => setForm(f => ({ ...f, kind: 'git' }))}>git</button>
            </div>
          </div>

          {form.kind === 'local' ? (
            <div className={styles.field}>
              <label className={styles.label}>Caminho</label>
              <input className={styles.input} placeholder="/caminho/para/o/repo"
                value={form.path} onChange={e => setForm(f => ({ ...f, path: e.target.value }))} required />
            </div>
          ) : (
            <>
              <div className={styles.field}>
                <label className={styles.label}>URL</label>
                <input className={styles.input} placeholder="https://github.com/org/repo.git"
                  value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} required />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Branch <span className={styles.labelOpt}>(opcional)</span></label>
                <input className={styles.input} placeholder="main"
                  value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))} />
              </div>
              <div className={styles.fieldRow}>
                <label className={styles.label}>Clone</label>
                <div className={styles.toggle}>
                  <button type="button"
                    className={`${styles.toggleBtn} ${form.clonePolicy === 'delete' ? styles.toggleBtnActive : ''}`}
                    onClick={() => setForm(f => ({ ...f, clonePolicy: 'delete' }))}>delete</button>
                  <button type="button"
                    className={`${styles.toggleBtn} ${form.clonePolicy === 'persist' ? styles.toggleBtnActive : ''}`}
                    onClick={() => setForm(f => ({ ...f, clonePolicy: 'persist' }))}>persist</button>
                </div>
              </div>
            </>
          )}

          <div className={styles.field}>
            <label className={styles.label}>Nome <span className={styles.labelOpt}>(opcional)</span></label>
            <input className={styles.input} placeholder="meu-sistema"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          {submitError && <div className={styles.formError}>⚠ {submitError}</div>}

          <div className={styles.formActions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={submitting}>cancelar</button>
            <button type="submit" className={styles.submitBtn} disabled={submitting}>
              {submitting ? 'analisando…' : 'analisar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── HomeView ──────────────────────────────────────────────────────────────────

export function HomeView() {
  const {
    topology,
    setTopology, goApp, toggleTheme, theme,
  } = useTopologyStore()

  const [showExtract, setShowExtract] = useState(false)

  const handleNavigate = () => {
    if (topology) goApp()
  }

  const canNavigate = topology !== null

  return (
    <div className={styles.root}>
      <NeuralBackground />

      <div className={styles.layout}>
        {/* Left: brand */}
        <div className={styles.left}>
          <div className={styles.brand}>
            <h1 className={styles.brandName}>Gaia</h1>
            <p className={styles.brandTagline}>the living graph of<br />application ecosystems.</p>
          </div>
          <span className={styles.version}>v0.1 · @topology/core</span>
        </div>

        {/* Right: action cards */}
        <div className={styles.right}>
          <button className={styles.themeBtn} onClick={toggleTheme} title="Alternar tema">
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
          <div className={styles.cards}>
            <ActionCard
              icon={<IconNavigate />}
              title="Navigate"
              desc="Explore o grafo de topologia"
              accent="var(--accent-green)"
              onClick={handleNavigate}
              disabled={!canNavigate}
            />
            <ActionCard
              icon={<IconExtract />}
              title="Extract"
              desc="Analise um novo repositório"
              accent="var(--accent-purple)"
              onClick={() => setShowExtract(true)}
            />
            <ActionCard
              icon={<IconConfig />}
              title="Config"
              desc="Configurações do sistema"
              disabled
              soon
            />
            <ActionCard
              icon={<IconDashboard />}
              title="Dashboard"
              desc="Métricas e insights"
              disabled
              soon
            />
          </div>
        </div>
      </div>

      {/* Extract modal */}
      {showExtract && (
        <ExtractModal
          onClose={() => setShowExtract(false)}
          onSuccess={() => setShowExtract(false)}
        />
      )}
    </div>
  )
}
