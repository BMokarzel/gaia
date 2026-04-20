import { useEffect, useRef } from 'react'

const NODE_COUNT  = 52
const MAX_DIST    = 150
const NODE_R      = 2
const PULSE_R     = 2.5
const DRIFT       = 0.12
const FADE_RATE   = 0.004   // very slow fade
const MAX_PULSES  = 7       // max simultaneous pulses
const MAX_DEPTH   = 4       // max cascade hops
const FIRE_PAUSE  = 5000    // ms between spontaneous bursts

const G = { r: 57, g: 255, b: 110 }
const c = (a: number) => `rgba(${G.r},${G.g},${G.b},${Math.min(1, a).toFixed(3)})`

interface N { x: number; y: number; vx: number; vy: number; act: number }
interface P { fi: number; ti: number; t: number; spd: number; depth: number }

export function NeuralBackground() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    let W = 0, H = 0, raf = 0
    let lastBurst = 0          // timestamp of last spontaneous fire
    const nodes: N[] = []
    const pulses: P[] = []

    function resize() {
      W = cv.offsetWidth
      H = cv.offsetHeight
      cv.width  = W * devicePixelRatio
      cv.height = H * devicePixelRatio
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    }

    function seed() {
      nodes.length = 0
      pulses.length = 0
      lastBurst = 0
      for (let i = 0; i < NODE_COUNT; i++) {
        const a = Math.random() * Math.PI * 2
        nodes.push({
          x: 20 + Math.random() * (W - 40),
          y: 20 + Math.random() * (H - 40),
          vx: Math.cos(a) * DRIFT * (.4 + Math.random() * .6),
          vy: Math.sin(a) * DRIFT * (.4 + Math.random() * .6),
          act: 0,
        })
      }
    }

    // Controlled cascade: propagate only if depth < MAX_DEPTH and room for pulses
    function cascade(i: number, depth: number) {
      nodes[i].act = 1
      if (depth >= MAX_DEPTH) return
      if (pulses.length >= MAX_PULSES) return

      const nb: number[] = []
      for (let j = 0; j < nodes.length; j++) {
        if (j === i) continue
        const dx = nodes[i].x - nodes[j].x
        const dy = nodes[i].y - nodes[j].y
        if (dx*dx + dy*dy < MAX_DIST * MAX_DIST) nb.push(j)
      }
      if (!nb.length) return

      // Probability decreases with depth; pick fewer targets at deeper levels
      const prob  = 0.75 - depth * 0.18
      const maxTargets = Math.max(1, 3 - depth)
      nb.sort(() => Math.random() - .5)
      let fired = 0
      for (const j of nb) {
        if (fired >= maxTargets) break
        if (Math.random() > prob) continue
        if (pulses.some(p => p.fi === i && p.ti === j)) continue
        if (pulses.length >= MAX_PULSES) break
        pulses.push({ fi: i, ti: j, t: 0, spd: .007 + Math.random() * .006, depth: depth + 1 })
        fired++
      }
    }

    function draw(now: number) {
      ctx.clearRect(0, 0, W, H)

      // drift
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy
        if (n.x < 0) { n.x = 0; n.vx *= -1 }
        if (n.x > W) { n.x = W; n.vx *= -1 }
        if (n.y < 0) { n.y = 0; n.vy *= -1 }
        if (n.y > H) { n.y = H; n.vy *= -1 }
        n.act = Math.max(0, n.act - FADE_RATE)
      }

      // spontaneous burst — only when network is quiet
      if (now - lastBurst > FIRE_PAUSE && pulses.length === 0) {
        const i = Math.floor(Math.random() * nodes.length)
        cascade(i, 0)
        lastBurst = now
      }

      // resting edges
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const d2 = dx*dx + dy*dy
          if (d2 > MAX_DIST * MAX_DIST) continue
          const prox  = 1 - Math.sqrt(d2) / MAX_DIST
          const boost = (nodes[i].act + nodes[j].act) * 0.2
          ctx.beginPath()
          ctx.moveTo(nodes[i].x, nodes[i].y)
          ctx.lineTo(nodes[j].x, nodes[j].y)
          ctx.strokeStyle = c(prox * 0.10 + boost)
          ctx.lineWidth = 0.6 + boost * 1.2
          ctx.stroke()
        }
      }

      // pulses
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]
        p.t = Math.min(1, p.t + p.spd)
        const src = nodes[p.fi], dst = nodes[p.ti]

        const e = p.t < .5 ? 4*p.t*p.t*p.t : 1 - Math.pow(-2*p.t+2, 3)/2
        const px = src.x + (dst.x - src.x) * e
        const py = src.y + (dst.y - src.y) * e

        // lit trail on edge
        const gl = ctx.createLinearGradient(src.x, src.y, dst.x, dst.y)
        const t0 = Math.max(0, e - .3)
        gl.addColorStop(t0, c(0))
        gl.addColorStop(e,  c(0.5))
        gl.addColorStop(Math.min(1, e + .02), c(0.08))
        gl.addColorStop(1,  c(0))
        ctx.beginPath()
        ctx.moveTo(src.x, src.y)
        ctx.lineTo(dst.x, dst.y)
        ctx.strokeStyle = gl
        ctx.lineWidth = 1.6
        ctx.stroke()

        // halo
        const halo = ctx.createRadialGradient(px, py, 0, px, py, PULSE_R * 5)
        halo.addColorStop(0, c(.45))
        halo.addColorStop(.5, c(.12))
        halo.addColorStop(1, c(0))
        ctx.beginPath()
        ctx.arc(px, py, PULSE_R * 5, 0, Math.PI * 2)
        ctx.fillStyle = halo
        ctx.fill()

        // core
        ctx.beginPath()
        ctx.arc(px, py, PULSE_R, 0, Math.PI * 2)
        ctx.fillStyle = c(1)
        ctx.fill()

        if (p.t >= 1) {
          cascade(p.ti, p.depth)
          pulses.splice(i, 1)
        }
      }

      // nodes
      for (const n of nodes) {
        if (n.act > 0.04) {
          const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, NODE_R * 8)
          glow.addColorStop(0, c(n.act * 0.45))
          glow.addColorStop(.5, c(n.act * 0.12))
          glow.addColorStop(1, c(0))
          ctx.beginPath()
          ctx.arc(n.x, n.y, NODE_R * 8, 0, Math.PI * 2)
          ctx.fillStyle = glow
          ctx.fill()
        }
        ctx.beginPath()
        ctx.arc(n.x, n.y, NODE_R, 0, Math.PI * 2)
        ctx.fillStyle = c(0.14 + n.act * 0.86)
        ctx.fill()
      }

      raf = requestAnimationFrame(draw)
    }

    const ro = new ResizeObserver(() => { resize(); seed() })
    ro.observe(cv)
    resize(); seed()
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return (
    <canvas ref={ref} style={{
      position: 'fixed', inset: 0,
      width: '100vw', height: '100vh',
      pointerEvents: 'none',
      zIndex: 0,
    }} />
  )
}
