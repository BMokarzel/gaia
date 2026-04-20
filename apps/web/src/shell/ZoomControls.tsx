import React from 'react'
import styles from './ZoomControls.module.css'

interface ZoomControlsProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
}

export function ZoomControls({ zoom, onZoomIn, onZoomOut, onFit }: ZoomControlsProps) {
  return (
    <div className={styles.controls}>
      <button className={styles.btn} onClick={onZoomOut} title="Zoom out">−</button>
      <span className={styles.label}>{Math.round(zoom * 100)}%</span>
      <button className={styles.btn} onClick={onZoomIn} title="Zoom in">+</button>
      <div className={styles.divider} />
      <button className={styles.btn} onClick={onFit} title="Fit to screen">⛶</button>
    </div>
  )
}
