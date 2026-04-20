import React, { useEffect, useState } from 'react'
import { useTopologyStore } from '@/store/topologyStore'
import { topologyApi } from '@/api/topology.api'
import type { AnalyzeRequest, SourceDescriptor } from '@/api/types'
import styles from './HomeView.module.css'

export function HomeView() {
  const {
    topologies, topologiesTotal, listStatus, listError,
    loadTopologies, loadTopologyById, deleteTopology,
    goApp, toggleTheme, theme,
  } = useTopologyStore()

  const [showForm, setShowForm] = useState(false)
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
  const [openingId, setOpeningId] = useState<string | null>(null)

  useEffect(() => {
    loadTopologies()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpen = async (id: string) => {
    setOpeningId(id)
    await loadTopologyById(id)
    setOpeningId(null)
    goApp()
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Remover esta topologia?')) return
    await deleteTopology(id)
  }

  const handleAnalyze = async (e: React.FormEvent) => {
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
      }
      const stored = await topologyApi.analyze(req)
      await loadTopologyById(stored.id)
      goApp()
    } catch (err) {
      setSubmitError((err as Error).message)
      setSubmitting(false)
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.logo}>topology</div>
        <div className={styles.subtitle}>system topology explorer</div>
        <button className={styles.themeBtn} onClick={toggleTheme} title="Alternar tema">
          {theme === 'dark' ? '◑' : '○'}
        </button>
      </div>

      <div className={styles.grid}>
        {/* ── Coluna: topologias salvas ── */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Topologias salvas</span>
            <span className={styles.panelCount}>{topologiesTotal}</span>
          </div>

          {listStatus === 'loading' && (
            <div className={styles.listState}>carregando…</div>
          )}
          {listStatus === 'error' && (
            <div className={styles.listError}>⚠ {listError}</div>
          )}
          {listStatus === 'idle' && topologies.length === 0 && (
            <div className={styles.listState}>Nenhuma topologia ainda.</div>
          )}

          <div className={styles.list}>
            {topologies.map(t => (
              <button
                key={t.id}
                className={styles.topologyItem}
                onClick={() => handleOpen(t.id)}
                disabled={openingId === t.id}
              >
                <div className={styles.itemMain}>
                  <span className={styles.itemName}>{t.name}</span>
                  {t.tags.length > 0 && (
                    <span className={styles.itemTags}>{t.tags.join(', ')}</span>
                  )}
                </div>
                <div className={styles.itemMeta}>
                  <span className={styles.itemDate}>{fmt(t.updatedAt)}</span>
                  <span
                    className={styles.itemDelete}
                    role="button"
                    onClick={(e) => handleDelete(t.id, e)}
                    title="Remover"
                  >✕</span>
                </div>
                {openingId === t.id && <span className={styles.itemLoading}>abrindo…</span>}
              </button>
            ))}
          </div>
        </div>

        {/* ── Coluna: analisar novo repo ── */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Analisar repositório</span>
          </div>

          {!showForm ? (
            <button className={styles.analyzeBtn} onClick={() => setShowForm(true)}>
              <span className={styles.analyzeBtnIcon}>⟳</span>
              Extrair nova topologia
            </button>
          ) : (
            <form className={styles.form} onSubmit={handleAnalyze}>
              <div className={styles.fieldRow}>
                <label className={styles.label}>Tipo de fonte</label>
                <div className={styles.toggle}>
                  <button
                    type="button"
                    className={`${styles.toggleBtn} ${form.kind === 'local' ? styles.toggleBtnActive : ''}`}
                    onClick={() => setForm(f => ({ ...f, kind: 'local' }))}
                  >local</button>
                  <button
                    type="button"
                    className={`${styles.toggleBtn} ${form.kind === 'git' ? styles.toggleBtnActive : ''}`}
                    onClick={() => setForm(f => ({ ...f, kind: 'git' }))}
                  >git</button>
                </div>
              </div>

              {form.kind === 'local' ? (
                <div className={styles.field}>
                  <label className={styles.label}>Caminho</label>
                  <input
                    className={styles.input}
                    placeholder="/caminho/para/o/repo"
                    value={form.path}
                    onChange={e => setForm(f => ({ ...f, path: e.target.value }))}
                    required
                  />
                </div>
              ) : (
                <>
                  <div className={styles.field}>
                    <label className={styles.label}>URL</label>
                    <input
                      className={styles.input}
                      placeholder="https://github.com/org/repo.git"
                      value={form.url}
                      onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                      required
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Branch</label>
                    <input
                      className={styles.input}
                      placeholder="main (opcional)"
                      value={form.branch}
                      onChange={e => setForm(f => ({ ...f, branch: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.label}>Clone</label>
                    <div className={styles.toggle}>
                      <button
                        type="button"
                        className={`${styles.toggleBtn} ${form.clonePolicy === 'delete' ? styles.toggleBtnActive : ''}`}
                        onClick={() => setForm(f => ({ ...f, clonePolicy: 'delete' }))}
                      >delete</button>
                      <button
                        type="button"
                        className={`${styles.toggleBtn} ${form.clonePolicy === 'persist' ? styles.toggleBtnActive : ''}`}
                        onClick={() => setForm(f => ({ ...f, clonePolicy: 'persist' }))}
                      >persist</button>
                    </div>
                  </div>
                </>
              )}

              <div className={styles.field}>
                <label className={styles.label}>Nome <span className={styles.labelOpt}>(opcional)</span></label>
                <input
                  className={styles.input}
                  placeholder="meu-sistema"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              {submitError && <div className={styles.formError}>⚠ {submitError}</div>}

              <div className={styles.formActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => { setShowForm(false); setSubmitError(null) }}
                  disabled={submitting}
                >cancelar</button>
                <button type="submit" className={styles.submitBtn} disabled={submitting}>
                  {submitting ? 'analisando…' : 'analisar'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <div className={styles.footer}>
        <span>topology v0.1</span>
        <span>·</span>
        <span>powered by @topology/core</span>
      </div>
    </div>
  )
}
