import React from 'react'
import { useTopologyStore } from '@/store/topologyStore'
import styles from './LandingView.module.css'

/**
 * Estado intermediário exibido dentro da shell quando nenhuma topologia
 * está carregada (status !== 'loaded'). Instrui o usuário a voltar à Home
 * e selecionar uma topologia da lista.
 */
export function LandingView() {
  const { status, error, goHome } = useTopologyStore()

  if (status === 'loading') {
    return (
      <div className={styles.container}>
        <div className={styles.loadingState}>
          <div className={styles.loadingLabel}>carregando topologia…</div>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.idleState}>
        <div className={styles.logo}>topology</div>
        <div className={styles.instructions}>
          Selecione uma topologia para visualizar
        </div>
        <button className={styles.backBtn} onClick={goHome}>
          ← voltar ao início
        </button>
        {error && (
          <div className={styles.errorBanner}>
            <span className={styles.errorIcon}>⚠</span>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
