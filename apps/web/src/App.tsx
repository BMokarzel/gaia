import React, { useEffect, useState } from 'react'
import { useTopologyStore } from '@/store/topologyStore'
import { TopBar } from '@/shell/TopBar'
import { LeftRail } from '@/shell/LeftRail'
import { HomeView } from '@/views/HomeView'
import { EcosystemView } from '@/views/EcosystemView'
import { EcosystemView3D } from '@/views/EcosystemView3D'
import { ServiceView } from '@/views/ServiceView'
import { EndpointView } from '@/views/EndpointView'
import { ChatPanel, ChatFab } from '@/detail/ChatPanel'
import './styles/design-system.css'
import './styles/graph-nodes.css'
import styles from './App.module.css'

export function App() {
  const { navigation, theme, goHome, navigateToEcosystem, activeTopologyId } = useTopologyStore()
  const { screen } = navigation
  const [ecoMode, setEcoMode] = useState<'2d' | '3d'>('2d')
  const [chatOpen, setChatOpen] = useState(false)

  // Apply theme on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Global keyboard shortcuts (Spec 9.4)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as Element)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const cur = useTopologyStore.getState().navigation.screen
      if (e.key === 'h' || e.key === 'H') { goHome(); return }
      if ((e.key === 'g' || e.key === 'G') && cur !== 'home') { navigateToEcosystem(); return }
      if (e.key === 'f' || e.key === 'F') { document.dispatchEvent(new CustomEvent('gaia:fit')); return }
      if (e.key === '+' || e.key === '=') { document.dispatchEvent(new CustomEvent('gaia:zoom-in')); return }
      if (e.key === '-') { document.dispatchEvent(new CustomEvent('gaia:zoom-out')); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goHome, navigateToEcosystem])

  if (screen === 'home') {
    return <HomeView />
  }

  return (
    <div className={styles.shell}>
      <TopBar />
      <LeftRail />

      <main className={`${styles.canvas} ${styles.canvasWithShell}`}>
        {screen === 'ecosystem' && (
          <>
            {ecoMode === '2d' ? <EcosystemView /> : <EcosystemView3D />}
            <div className={styles.ecoToggle}>
              <button
                className={ecoMode === '2d' ? styles.ecoToggleActive : ''}
                onClick={() => setEcoMode('2d')}
              >2D</button>
              <button
                className={ecoMode === '3d' ? styles.ecoToggleActive : ''}
                onClick={() => setEcoMode('3d')}
              >3D</button>
            </div>
          </>
        )}
        {screen === 'service'   && <ServiceView />}
        {screen === 'endpoint'  && <EndpointView />}
      </main>

      {!chatOpen && <ChatFab onClick={() => setChatOpen(true)} />}
      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        topologyId={activeTopologyId ?? undefined}
      />
    </div>
  )
}
