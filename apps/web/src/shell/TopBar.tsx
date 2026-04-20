import React, { useState, useCallback } from 'react'
import { useTopologyStore } from '@/store/topologyStore'
import styles from './TopBar.module.css'

export function TopBar() {
  const { viewLevel, selectedServiceId, selectedEndpointId, topology, navigateTo, toggleTheme, theme, goHome } = useTopologyStore()
  const [searchOpen, setSearchOpen] = useState(false)

  const service = topology?.services.find(s => s.id === selectedServiceId)
  const endpoint = service?.endpoints.find(e => e.id === selectedEndpointId)

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
          className={`${styles.crumb} ${viewLevel === 'ecosystem' ? styles.crumbActive : ''}`}
          onClick={() => navigateTo('ecosystem')}
        >
          serviços
        </span>

        {service && (
          <>
            <span className={styles.sep}>›</span>
            <span
              className={`${styles.crumb} ${viewLevel === 'service' ? styles.crumbActive : ''}`}
              onClick={() => navigateTo('service', selectedServiceId!)}
            >
              {service.name}
            </span>
          </>
        )}

        {endpoint && (
          <>
            <span className={styles.sep}>›</span>
            <span className={`${styles.crumb} ${styles.crumbMono} ${viewLevel === 'endpoint' ? styles.crumbActive : ''}`}>
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
        <button className={styles.iconBtn} onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <div className={styles.avatar}>U</div>
      </div>
    </div>
  )
}
