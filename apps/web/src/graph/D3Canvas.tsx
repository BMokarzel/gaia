import React, { useRef, useCallback, useEffect, useState } from 'react'
import styles from './D3Canvas.module.css'

interface Transform {
  x: number
  y: number
  scale: number
}

interface D3CanvasProps {
  children: React.ReactNode
  minScale?: number
  maxScale?: number
  onTransformChange?: (t: Transform) => void
  defaultTransform?: Transform
  className?: string
}

/**
 * Pan/zoom SVG canvas — port faithful to design-canvas.jsx.
 * Transform lives in a ref and is written directly to DOM (no React re-render on pan/zoom).
 * Exposes imperative handle via `onTransformChange` and `fitTo()`.
 */
export function D3Canvas({
  children,
  minScale = 0.05,
  maxScale = 8,
  onTransformChange,
  defaultTransform = { x: 0, y: 0, scale: 1 },
  className,
}: D3CanvasProps) {
  const vpRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const tf = useRef<Transform>({ ...defaultTransform })
  const [displayZoom, setDisplayZoom] = useState(defaultTransform.scale)

  const apply = useCallback(() => {
    const { x, y, scale } = tf.current
    if (worldRef.current) {
      worldRef.current.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`
    }
    setDisplayZoom(scale)
    onTransformChange?.(tf.current)
  }, [onTransformChange])

  useEffect(() => {
    const vp = vpRef.current
    if (!vp) return

    const zoomAt = (cx: number, cy: number, factor: number) => {
      const r = vp.getBoundingClientRect()
      const px = cx - r.left, py = cy - r.top
      const t = tf.current
      const next = Math.min(maxScale, Math.max(minScale, t.scale * factor))
      const k = next / t.scale
      t.x = px - (px - t.x) * k
      t.y = py - (py - t.y) * k
      t.scale = next
      apply()
    }

    const isMouseWheel = (e: WheelEvent) =>
      e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40)

    let isGesturing = false
    let gsBase = 1

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (isGesturing) return
      if (e.ctrlKey) {
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01))
      } else if (isMouseWheel(e)) {
        zoomAt(e.clientX, e.clientY, Math.exp(-Math.sign(e.deltaY) * 0.18))
      } else {
        tf.current.x -= e.deltaX
        tf.current.y -= e.deltaY
        apply()
      }
    }

    const onGestureStart = (e: Event) => { e.preventDefault(); isGesturing = true; gsBase = tf.current.scale }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const ge = e as unknown as { clientX: number; clientY: number; scale: number }
      zoomAt(ge.clientX, ge.clientY, (gsBase * ge.scale) / tf.current.scale)
    }
    const onGestureEnd = (e: Event) => { e.preventDefault(); isGesturing = false }

    let drag: { id: number; lx: number; ly: number } | null = null

    const onPointerDown = (e: PointerEvent) => {
      const onBg = e.target === vp || e.target === worldRef.current
      if (!(e.button === 1 || (e.button === 0 && onBg))) return
      e.preventDefault()
      vp.setPointerCapture(e.pointerId)
      drag = { id: e.pointerId, lx: e.clientX, ly: e.clientY }
      vp.style.cursor = 'grabbing'
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      tf.current.x += e.clientX - drag.lx
      tf.current.y += e.clientY - drag.ly
      drag.lx = e.clientX; drag.ly = e.clientY
      apply()
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      vp.releasePointerCapture(e.pointerId)
      drag = null
      vp.style.cursor = ''
    }

    vp.addEventListener('wheel', onWheel, { passive: false })
    vp.addEventListener('gesturestart', onGestureStart, { passive: false })
    vp.addEventListener('gesturechange', onGestureChange, { passive: false })
    vp.addEventListener('gestureend', onGestureEnd, { passive: false })
    vp.addEventListener('pointerdown', onPointerDown)
    vp.addEventListener('pointermove', onPointerMove)
    vp.addEventListener('pointerup', onPointerUp)
    vp.addEventListener('pointercancel', onPointerUp)

    return () => {
      vp.removeEventListener('wheel', onWheel)
      vp.removeEventListener('gesturestart', onGestureStart)
      vp.removeEventListener('gesturechange', onGestureChange)
      vp.removeEventListener('gestureend', onGestureEnd)
      vp.removeEventListener('pointerdown', onPointerDown)
      vp.removeEventListener('pointermove', onPointerMove)
      vp.removeEventListener('pointerup', onPointerUp)
      vp.removeEventListener('pointercancel', onPointerUp)
    }
  }, [apply, minScale, maxScale])

  // Imperative: fit all content
  const fit = useCallback(() => {
    const vp = vpRef.current
    const world = worldRef.current
    if (!vp || !world) return
    const vpR = vp.getBoundingClientRect()
    const wR = world.getBoundingClientRect()
    if (wR.width === 0 || wR.height === 0) return
    const scale = Math.min(
      (vpR.width - 80) / (wR.width / tf.current.scale),
      (vpR.height - 80) / (wR.height / tf.current.scale),
      1
    )
    tf.current = {
      scale,
      x: (vpR.width - (wR.width / tf.current.scale) * scale) / 2,
      y: (vpR.height - (wR.height / tf.current.scale) * scale) / 2,
    }
    apply()
  }, [apply])

  // Expose fit to parent via a data attribute shortcut (lightweight)
  useEffect(() => {
    const el = vpRef.current
    if (!el) return
    ;(el as unknown as Record<string, unknown>).__gaiaFit = fit
    ;(el as unknown as Record<string, unknown>).__gaiaZoomIn = () => {
      const vp = vpRef.current!
      const r = vp.getBoundingClientRect()
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      const next = Math.min(maxScale, tf.current.scale * 1.25)
      const k = next / tf.current.scale
      tf.current.x = (r.width / 2) - ((r.width / 2) - tf.current.x) * k
      tf.current.y = (r.height / 2) - ((r.height / 2) - tf.current.y) * k
      tf.current.scale = next
      apply()
    }
    ;(el as unknown as Record<string, unknown>).__gaiaZoomOut = () => {
      const vp = vpRef.current!
      const r = vp.getBoundingClientRect()
      const next = Math.max(minScale, tf.current.scale / 1.25)
      const k = next / tf.current.scale
      tf.current.x = (r.width / 2) - ((r.width / 2) - tf.current.x) * k
      tf.current.y = (r.height / 2) - ((r.height / 2) - tf.current.y) * k
      tf.current.scale = next
      apply()
    }
  }, [fit, apply, maxScale, minScale])

  return (
    <div ref={vpRef} className={`${styles.viewport} ${className ?? ''}`}>
      <div
        ref={worldRef}
        className={styles.world}
        style={{ transform: `translate3d(${defaultTransform.x}px,${defaultTransform.y}px,0) scale(${defaultTransform.scale})` }}
      >
        {children}
      </div>
    </div>
  )
}

/** Call fit/zoomIn/zoomOut on the canvas via the DOM ref */
export function canvasFit(el: HTMLDivElement | null) {
  ;(el as unknown as Record<string, (() => void) | undefined>)?.__gaiaFit?.()
}
export function canvasZoomIn(el: HTMLDivElement | null) {
  ;(el as unknown as Record<string, (() => void) | undefined>)?.__gaiaZoomIn?.()
}
export function canvasZoomOut(el: HTMLDivElement | null) {
  ;(el as unknown as Record<string, (() => void) | undefined>)?.__gaiaZoomOut?.()
}
