import React, { useState } from 'react'
import { useTopologyStore } from '@/store/topologyStore'
import styles from './LeftRail.module.css'

const NAV_ITEMS = [
  { level: 'ecosystem' as const, glyph: '◎', label: 'Ecosystem',  sub: 'todos os serviços' },
  { level: 'service'   as const, glyph: '▣', label: 'Service',    sub: 'endpoints & deps' },
  { level: 'endpoint'  as const, glyph: '◉', label: 'Endpoint',   sub: 'fluxo de controle' },
]

export function LeftRail() {
  const [expanded, setExpanded] = useState(false)
  const {
    navigation, activeTopology, ecosystem,
    navigateToEcosystem, navigateToService, navigateToEndpoint,
  } = useTopologyStore()

  const { screen, serviceId, endpointId } = navigation

  const canNavigate = (level: 'ecosystem' | 'service' | 'endpoint') => {
    if (level === 'ecosystem') return !!(activeTopology || ecosystem)
    if (level === 'service') return !!serviceId
    if (level === 'endpoint') return !!(serviceId && endpointId)
    return false
  }

  const handleNav = (level: 'ecosystem' | 'service' | 'endpoint') => {
    if (!canNavigate(level)) return
    if (level === 'ecosystem') navigateToEcosystem()
    else if (level === 'service' && serviceId) navigateToService(serviceId)
    else if (level === 'endpoint' && serviceId && endpointId) navigateToEndpoint(serviceId, endpointId)
  }

  return (
    <div
      className={`${styles.rail} ${expanded ? styles.railExpanded : ''}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {NAV_ITEMS.map((item) => {
        const active = screen === item.level
        const disabled = !canNavigate(item.level)
        return (
          <div
            key={item.level}
            className={`${styles.item} ${active ? styles.itemActive : ''} ${disabled ? styles.itemDisabled : ''}`}
            onClick={() => handleNav(item.level)}
          >
            <span className={styles.glyph}>{item.glyph}</span>
            {expanded && (
              <div className={styles.labelGroup}>
                <span className={styles.label}>{item.label}</span>
                <span className={styles.sub}>{item.sub}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
