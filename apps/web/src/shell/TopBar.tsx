import React, { useState, useCallback } from 'react'
import { useTopologyStore } from '@/store/topologyStore'
import { ExportMenu } from './ExportMenu'
import styles from './TopBar.module.css'

export function TopBar() {
  const {
    navigation, activeTopology,
    navigateToEcosystem, navigateToService,
    toggleTheme, theme, goHome,
  } = useTopologyStore()

  const { screen, serviceId, endpointId } = navigation
  const [searchOpen, setSearchOpen] = useState(false)

  const service = activeTopology?.services.find(s => s.id === serviceId)
  const endpoint = service?.endpoints.find(e => e.id === endpointId)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      setSearchOpen(o => !o)
    }
    if (e.key === 'Escape') setSearchOpen(false)
  }, [])

  React.useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className={styles.topbar}>
      {/* Breadcrumb */}
      <div className={styles.breadcrumb}>
        <span
          className={`${styles.crumb} ${styles.crumbBrand}`}
          onClick={goHome}
          title="Voltar para home"
        >
          gaia
        </span>

        <span className={styles.sep}>›</span>
        <span
          className={`${styles.crumb} ${screen === 'ecosystem' ? styles.crumbActive : ''}`}
          onClick={navigateToEcosystem}
        >
          Ecossistema
        </span>

        {service && (
          <>
            <span className={styles.sep}>›</span>
            <span
              className={`${styles.crumb} ${screen === 'service' ? styles.crumbActive : ''}`}
              onClick={() => serviceId && navigateToService(serviceId)}
            >
              {service.name}
            </span>
          </>
        )}

        {endpoint && (
          <>
            <span className={styles.sep}>›</span>
            <span className={`${styles.crumb} ${styles.crumbMono} ${screen === 'endpoint' ? styles.crumbActive : ''}`}>
              {endpoint.metadata.method} {endpoint.metadata.path}
            </span>
          </>
        )}
      </div>

      {/* Search */}
      <div
        className={`${styles.searchPill} ${searchOpen ? styles.searchPillOpen : ''}`}
        onClick={() => setSearchOpen(true)}
      >
        <span className={styles.searchIcon}>⌕</span>
        {searchOpen && (
          <span className={styles.searchPlaceholder}>Ir para serviço, endpoint, função…</span>
        )}
        {!searchOpen && <span className={styles.searchShortcut}>⌘K</span>}
      </div>

      <div style={{ flex: 1 }} />

      {/* Controls */}
      <div className={styles.controls}>
        <ExportMenu />
        <div className={styles.divider} />
        <button className={styles.iconBtn} onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <div className={styles.avatar}>U</div>
      </div>
    </div>
  )
}
