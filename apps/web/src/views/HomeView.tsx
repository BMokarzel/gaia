import React, { useState } from 'react'
import { useTopologyStore, useHasEcosystem } from '@/store/topologyStore'
import { topologyApi } from '@/api/topology.api'
import type { AnalyzeRequest, SourceDescriptor, ExtractionProgressSummary } from '@/api/types'
import type { PendingMergeEntry } from '@/types/topology'
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

type ExtractStep = 'form' | 'progress' | 'merge' | 'summary'

interface ExtractModalProps {
  onClose: () => void
  onSuccess: () => void
}

function ExtractModal({ onClose }: ExtractModalProps) {
  const { loadEcosystem, loadService, navigateToService, navigateToEcosystem } = useTopologyStore()

  const [step, setStep] = useState<ExtractStep>('form')
  const [form, setForm] = useState<{
    kind: 'local' | 'git'
    path: string
    url: string
    branch: string
    clonePolicy: 'persist' | 'delete'
  }>({ kind: 'local', path: '', url: '', branch: '', clonePolicy: 'delete' })

  // progress step
  const [extractError, setExtractError] = useState<string | null>(null)

  // merge step
  const [sessionId, setSessionId] = useState<string>('')
  const [pendingMerges, setPendingMerges] = useState<PendingMergeEntry[]>([])
  const [mergeIndex, setMergeIndex] = useState(0)
  const [decisions, setDecisions] = useState<Array<{ externalCallId: string; decision: string | null }>>([])
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null)
  const [submittingMerge, setSubmittingMerge] = useState(false)

  // summary step
  const [summary, setSummary] = useState<ExtractionProgressSummary | null>(null)
  const [completedTopologyId, setCompletedTopologyId] = useState<string>('')

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (step === 'summary' || step === 'form') {
      if (e.target === e.currentTarget) onClose()
    }
  }

  // ── Etapa 1 → 2: submeter formulário ──────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setExtractError(null)
    setStep('progress')
    try {
      const source: SourceDescriptor = form.kind === 'local'
        ? { kind: 'local', path: form.path }
        : { kind: 'git', url: form.url, branch: form.branch || undefined }
      const req: AnalyzeRequest = {
        source,
        clonePolicy: form.kind === 'git' ? form.clonePolicy : undefined,
        options: { skipTests: false },
      }
      const result = await topologyApi.analyze(req)

      if (result.status === 'pending_merge_decisions') {
        setSessionId(result.sessionId)
        setPendingMerges(result.pendingMerges)
        setMergeIndex(0)
        setDecisions([])
        setSelectedCandidate(result.pendingMerges[0]?.candidates[0]?.endpointId ?? null)
        setStep('merge')
      } else {
        // status === 'complete'
        setSummary(result.summary)
        setCompletedTopologyId(result.topologyId)
        await loadEcosystem()
        setStep('summary')
      }
    } catch (err) {
      setExtractError((err as Error).message)
      setStep('form')
    }
  }

  // ── Etapa 3: decisão de merge para um item ─────────────────────────────────

  const currentMerge = pendingMerges[mergeIndex]
  const topCandidate = currentMerge?.candidates.reduce(
    (best, c) => (c.confidence > best.confidence ? c : best),
    currentMerge.candidates[0],
  )

  const commitDecision = async (decision: string | null) => {
    const newDecisions = [...decisions, { externalCallId: currentMerge.externalCallId, decision }]
    setDecisions(newDecisions)

    const nextIndex = mergeIndex + 1
    if (nextIndex < pendingMerges.length) {
      setMergeIndex(nextIndex)
      setSelectedCandidate(pendingMerges[nextIndex]?.candidates[0]?.endpointId ?? null)
      return
    }

    // Todas as decisões coletadas — submeter
    setSubmittingMerge(true)
    try {
      const result = await topologyApi.submitMergeDecisions({ sessionId, decisions: newDecisions })
      if (result.status === 'complete') {
        setSummary(result.summary)
        setCompletedTopologyId(result.topologyId)
        await loadEcosystem()
        setStep('summary')
      }
    } catch (err) {
      setExtractError((err as Error).message)
      setStep('form')
    } finally {
      setSubmittingMerge(false)
    }
  }

  // ── Etapa 4: navegar após resumo ──────────────────────────────────────────

  const handleGoEcosystem = () => { navigateToEcosystem(); onClose() }

  const handleGoService = async () => {
    await loadService(completedTopologyId)
    navigateToService(completedTopologyId)
    onClose()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.backdrop} onClick={handleBackdrop}>
      <div className={styles.modal}>

        {/* ── Etapa 1: Formulário ── */}
        {step === 'form' && (
          <>
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

              {extractError && <div className={styles.formError}>⚠ {extractError}</div>}

              <div className={styles.formActions}>
                <button type="button" className={styles.cancelBtn} onClick={onClose}>cancelar</button>
                <button type="submit" className={styles.submitBtn}>analisar</button>
              </div>
            </form>
          </>
        )}

        {/* ── Etapa 2: Progresso ── */}
        {step === 'progress' && (
          <>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Extraindo…</span>
            </div>
            <div className={styles.form} style={{ gap: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                › Detectando stack tecnológica<br />
                › Extraindo endpoints<br />
                › Analisando chamadas externas
              </div>
              <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', background: 'var(--accent-green)', borderRadius: 2,
                  width: '60%', animation: 'pulse 1.5s ease-in-out infinite',
                }} />
              </div>
            </div>
          </>
        )}

        {/* ── Etapa 3: Decisão de merge ── */}
        {step === 'merge' && currentMerge && (
          <>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>
                Chamada externa — {mergeIndex + 1}/{pendingMerges.length}
              </span>
            </div>
            <div className={styles.form} style={{ gap: 14 }}>
              {/* Contexto */}
              <div style={{ background: 'var(--bg-canvas)', borderRadius: 8, padding: '10px 14px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
                <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Serviço chamador</div>
                <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{currentMerge.context.callerServiceName}</div>
                <div style={{ color: 'var(--text-muted)', marginTop: 8, marginBottom: 4 }}>Chamada detectada</div>
                <div style={{ color: 'var(--accent-green)' }}>
                  {currentMerge.context.method} {currentMerge.context.path}
                </div>
                {currentMerge.context.bodyFields && currentMerge.context.bodyFields.length > 0 && (
                  <div style={{ color: 'var(--text-muted)', marginTop: 4, fontSize: 11 }}>
                    body: {'{' + currentMerge.context.bodyFields.join(', ') + '}'}
                  </div>
                )}
              </div>

              {/* Sugestão da IA */}
              {currentMerge.llmReason && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', padding: '0 2px' }}>
                  IA: {currentMerge.llmReason}
                </div>
              )}

              {/* Candidatos */}
              {currentMerge.candidates.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Candidatos</div>
                  {currentMerge.candidates.map(c => (
                    <label key={c.endpointId} style={{
                      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                      padding: '8px 12px', borderRadius: 6,
                      background: selectedCandidate === c.endpointId ? 'rgba(57,255,110,0.08)' : 'var(--bg-canvas)',
                      border: `1px solid ${selectedCandidate === c.endpointId ? 'var(--accent-green)' : 'var(--border)'}`,
                    }}>
                      <input type="radio" name="candidate" value={c.endpointId}
                        checked={selectedCandidate === c.endpointId}
                        onChange={() => setSelectedCandidate(c.endpointId)}
                        style={{ accentColor: 'var(--accent-green)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-primary)' }}>
                          {c.serviceName} — {c.method} {c.path}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 11, fontWeight: 600, flexShrink: 0,
                        color: c.confidence >= 0.8 ? 'var(--accent-green)' : 'var(--text-muted)',
                      }}>
                        {Math.round(c.confidence * 100)}%
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>
                  Nenhum candidato encontrado
                </div>
              )}

              <div className={styles.formActions}>
                <button
                  type="button" className={styles.cancelBtn}
                  onClick={() => commitDecision('unresolvable')}
                  disabled={submittingMerge}
                >
                  Ignorar
                </button>
                {currentMerge.candidates.length > 0 && (
                  <button
                    type="button" className={styles.submitBtn}
                    onClick={() => commitDecision(selectedCandidate ?? topCandidate?.endpointId ?? 'unresolvable')}
                    disabled={submittingMerge}
                  >
                    {selectedCandidate === topCandidate?.endpointId ? 'Aprovar sugestão' : 'Confirmar escolha'}
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Etapa 4: Resumo ── */}
        {step === 'summary' && summary && (
          <>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Extração concluída</span>
              <button className={styles.modalClose} onClick={onClose}>✕</button>
            </div>
            <div className={styles.form} style={{ gap: 10 }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 16px',
                fontSize: 13, fontFamily: 'JetBrains Mono, monospace',
                background: 'var(--bg-canvas)', borderRadius: 8, padding: '12px 16px',
              }}>
                <span style={{ color: 'var(--text-muted)' }}>Endpoints extraídos</span>
                <span style={{ color: 'var(--text-primary)', textAlign: 'right' }}>{summary.endpointsExtracted}</span>
                <span style={{ color: 'var(--text-muted)' }}>Bancos identificados</span>
                <span style={{ color: 'var(--text-primary)', textAlign: 'right' }}>{summary.databasesFound}</span>
                <span style={{ color: 'var(--text-muted)' }}>Calls resolvidas</span>
                <span style={{ color: 'var(--accent-green)', textAlign: 'right' }}>{summary.externalCallsResolved}</span>
                <span style={{ color: 'var(--text-muted)' }}>Calls pendentes</span>
                <span style={{ color: summary.externalCallsPending > 0 ? 'var(--accent-amber, #f59e0b)' : 'var(--text-primary)', textAlign: 'right' }}>{summary.externalCallsPending}</span>
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.cancelBtn} onClick={handleGoEcosystem}>
                  Ver no ecossistema
                </button>
                <button type="button" className={styles.submitBtn} onClick={handleGoService}>
                  Ver este serviço →
                </button>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  )
}

// ── HomeView ──────────────────────────────────────────────────────────────────

export function HomeView() {
  const { navigateToEcosystem, toggleTheme, theme, loadEcosystem, ecosystemStatus } = useTopologyStore()
  const canNavigate = useHasEcosystem()

  const [showExtract, setShowExtract] = useState(false)

  // Carrega o ecossistema ao montar para saber se Navigate deve estar habilitado
  React.useEffect(() => {
    if (ecosystemStatus === 'idle') loadEcosystem()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleNavigate = () => navigateToEcosystem()

  const navigateDesc = 'Explore o grafo de topologia'

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
              desc={navigateDesc}
              accent="var(--accent-green)"
              onClick={handleNavigate}
              disabled={!canNavigate}
              loading={false}
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

      {showExtract && (
        <ExtractModal
          onClose={() => setShowExtract(false)}
          onSuccess={() => {}}
        />
      )}
    </div>
  )
}
