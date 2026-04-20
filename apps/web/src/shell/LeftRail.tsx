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
  const { viewLevel, navigateTo, selectedServiceId, selectedEndpointId, topology } = useTopologyStore()

  const canNavigate = (level: 'ecosystem' | 'service' | 'endpoint') => {
    if (level === 'ecosystem') return !!topology
    if (level === 'service') return !!selectedServiceId
    if (level === 'endpoint') return !!selectedEndpointId
    return false
  }

  const handleNav = (level: 'ecosystem' | 'service' | 'endpoint') => {
    if (!canNavigate(level)) return
    if (level === 'ecosystem') navigateTo('ecosystem')
    else if (level === 'service') navigateTo('service', selectedServiceId!)
    else if (level === 'endpoint') navigateTo('endpoint', selectedServiceId!, selectedEndpointId!)
  }

  return (
    <div
      className={`${styles.rail} ${expanded ? styles.railExpanded : ''}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {NAV_ITEMS.map((item) => {
        const active = viewLevel === item.level
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
