import React, { useEffect } from 'react'
import { useTopologyStore } from '@/store/topologyStore'
import { TopBar } from '@/shell/TopBar'
import { LeftRail } from '@/shell/LeftRail'
import { HomeView } from '@/views/HomeView'
import { EcosystemView } from '@/views/EcosystemView'
import { ServiceView } from '@/views/ServiceView'
import { EndpointView } from '@/views/EndpointView'
import './styles/design-system.css'
import './styles/graph-nodes.css'
import styles from './App.module.css'

export function App() {
  const { status, viewLevel, theme, appScreen } = useTopologyStore()

  // Apply theme on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  if (appScreen === 'home') {
    return <HomeView />
  }

  const hasTopology = status === 'loaded'
  // EcosystemView is always shown when in 'ecosystem' level (handles empty state internally)
  const showEcosystem = viewLevel === 'ecosystem'
  const showShell = showEcosystem || hasTopology

  return (
    <div className={styles.shell}>
      {showShell && <TopBar />}
      {showShell && <LeftRail />}

      <main className={`${styles.canvas} ${showShell ? styles.canvasWithShell : ''}`}>
        {showEcosystem && <EcosystemView />}
        {hasTopology && viewLevel === 'service' && <ServiceView />}
        {hasTopology && viewLevel === 'endpoint' && <EndpointView />}
      </main>
    </div>
  )
}
