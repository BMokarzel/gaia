/**
 * EcosystemView3D — 3D force-directed glass-orb visualization of the
 * ecosystem (services + databases + edges). Port of `graph-3d-preview.html`
 * tied to `useTopologyStore.ecosystem`.
 *
 * Phase 1 of the project roadmap. Coexists with the 2D EcosystemView via a
 * toggle in the parent (App.tsx).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import ForceGraph3DImport from '3d-force-graph'
import SpriteTextImport from 'three-spritetext'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

// 3d-force-graph's d.ts is too strict (insists on its own NodeObject shape),
// and three-spritetext's default export trips esModuleInterop. Cast to any —
// the runtime API is what we validated in graph-3d-preview.html.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph3D: any = ForceGraph3DImport as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpriteText: any = (SpriteTextImport as any).default ?? SpriteTextImport
import { useTopologyStore } from '@/store/topologyStore'
import type {
  EcosystemServiceEntry,
  EcosystemDatabaseEntry,
} from '@/types/topology'
import styles from './EcosystemView3D.module.css'

// ── Type taxonomy ───────────────────────────────────────────────────────────

type VisualType = 'gateway' | 'bff' | 'service' | 'data-store' | 'worker' | 'external'

const TYPES: Record<VisualType, { hue: string; label: string }> = {
  gateway:      { hue: '#22d3ee', label: 'gateway' },
  bff:          { hue: '#a78bfa', label: 'bff' },
  service:      { hue: '#4ade80', label: 'service' },
  'data-store': { hue: '#38bdf8', label: 'data store' },
  worker:       { hue: '#f472b6', label: 'worker' },
  external:     { hue: '#fbbf24', label: 'external' },
}

const LANG_DELTA: Record<string, number> = {
  typescript: -10, javascript: -10, ts: -10, js: -10,
  go: 0, golang: 0,
  java: 10,
  kotlin: -20,
  swift: 20,
  python: -5, py: -5,
  rust: 5,
  ruby: 15,
}

function typeOfService(s: EcosystemServiceEntry): VisualType {
  const name = s.name || s.id
  if (/-bff$|^bff-/i.test(name)) return 'bff'
  if (/gateway|cdn-edge|partner-api|edge/i.test(name)) return 'gateway'
  if (/-worker$|worker$|transcoder|resizer|thumbnail|etl-pipeline|migration-service|relay|dispatcher|external-sync|escalation|consumer|processor/i.test(name)) return 'worker'
  if (/proxy|external|partner|third-party/i.test(name)) return 'external'
  return 'service'
}

// ── Color helpers ───────────────────────────────────────────────────────────

function hexToA(hex: string, alpha: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n>>16)&255}, ${(n>>8)&255}, ${n&255}, ${alpha})`
}

function rotateHue(hex: string, deg: number): string {
  const c = new THREE.Color(hex)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  hsl.h = (hsl.h + deg / 360 + 1) % 1
  c.setHSL(hsl.h, hsl.s, hsl.l)
  return '#' + c.getHexString()
}

// ── Internal node/link types ────────────────────────────────────────────────

type GraphNode = {
  id: string
  name: string
  kind: 'service' | 'database'
  type: VisualType
  lang: string
  status: 'active' | 'provisional'
  endpoints: number
  meta: EcosystemServiceEntry | EcosystemDatabaseEntry
  inDeg: number
  outDeg: number
  degree: number
  val: number
  radius: number
  // populated by force-graph
  x?: number; y?: number; z?: number
}

type GraphLink = {
  source: string | GraphNode
  target: string | GraphNode
  kind: 'resolved' | 'unresolvable'
  // runtime-attached state
  __line?: THREE.Line
  __litColors?: { source: string; target: string }
  __drawing?: boolean
  __lit?: boolean
}

function colorOfNode(n: GraphNode): string {
  if (n.status === 'provisional') {
    // dim provisional nodes
    return rotateHue(TYPES[n.type].hue, (LANG_DELTA[n.lang] || 0))
  }
  const base = TYPES[n.type].hue
  return rotateHue(base, LANG_DELTA[n.lang] || 0)
}

// ── Texture caches (reused across re-renders within a scene) ────────────────

function makeHaloTexture(hex: string, cache: Map<string, THREE.Texture>): THREE.Texture {
  const cached = cache.get(hex)
  if (cached) return cached
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2)
  grad.addColorStop(0.00, hexToA(hex, 0.95))
  grad.addColorStop(0.18, hexToA(hex, 0.55))
  grad.addColorStop(0.45, hexToA(hex, 0.18))
  grad.addColorStop(1.00, 'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  cache.set(hex, tex)
  return tex
}

function makeRingTexture(hex: string, cache: Map<string, THREE.Texture>): THREE.Texture {
  const cached = cache.get(hex)
  if (cached) return cached
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const grad = ctx.createRadialGradient(size/2, size/2, size*0.30, size/2, size/2, size*0.50)
  grad.addColorStop(0.00, 'rgba(0,0,0,0)')
  grad.addColorStop(0.55, hexToA(hex, 0.9))
  grad.addColorStop(0.75, hexToA(hex, 0.45))
  grad.addColorStop(1.00, 'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  cache.set(hex, tex)
  return tex
}

function makeSheenTexture(): THREE.Texture {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2)
  grad.addColorStop(0, 'rgba(255,255,255,0.55)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.10)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// ── Edge color/opacity constants ────────────────────────────────────────────

const GRAY_HEX = 0x6e6e78
const GRAY_UNRESOLV_HEX = 0x3f3f46
const GRAY_OP = 0.42
const GRAY_UNRESOLV_OP = 0.25
const HOVER_OP = 0.70
const HOVER_UNRESOLV_OP = 0.40
const LIT_OP = 0.95
const LIT_UNRESOLV_OP = 0.50

const NODE_REL_SIZE = 4

// ────────────────────────────────────────────────────────────────────────────

export function EcosystemView3D() {
  const {
    ecosystem, ecosystemStatus, ecosystemError,
    loadEcosystem,
    selectNode,
    navigateToService,
  } = useTopologyStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredInfo, setHoveredInfo] = useState<GraphNode | null>(null)
  const [focusedInfo, setFocusedInfo] = useState<GraphNode | null>(null)

  // ── Filters ──────────────────────────────────────────────────────────────
  // Empty sets mean "match all" for that dimension. Search is an empty
  // string when inactive. The predicate is read from a ref so the 3D
  // visibility callbacks always see the latest filter snapshot.
  type Filters = {
    types: Set<VisualType>
    langs: Set<string>
    statuses: Set<'active' | 'provisional'>
    search: string
  }
  const [filters, setFilters] = useState<Filters>(() => ({
    types: new Set(),
    langs: new Set(),
    statuses: new Set(),
    search: '',
  }))
  const filtersRef = useRef(filters)
  useEffect(() => { filtersRef.current = filters }, [filters])

  // Available languages, derived from the loaded ecosystem.
  const availableLangs = useMemo<string[]>(() => {
    if (!ecosystem) return []
    const set = new Set<string>()
    for (const s of ecosystem.services) {
      const l = (s.language ?? '').toLowerCase()
      if (l) set.add(l)
    }
    return [...set].sort()
  }, [ecosystem])

  // Refs for triggering refresh on filter change.
  const graphRef = useRef<unknown>(null)

  const hasAnyFilter =
    filters.types.size > 0 ||
    filters.langs.size > 0 ||
    filters.statuses.size > 0 ||
    filters.search.trim().length > 0

  function toggleSetItem<T>(set: Set<T>, item: T): Set<T> {
    const next = new Set(set)
    if (next.has(item)) next.delete(item); else next.add(item)
    return next
  }

  // Load ecosystem on mount
  useEffect(() => {
    if (!ecosystem && ecosystemStatus === 'idle') loadEcosystem()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh graph visibility whenever filters change. The visibility
  // callbacks read filtersRef directly, so we just need to re-run them.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = graphRef.current as any
    if (g && typeof g.refresh === 'function') g.refresh()
  }, [filters])

  // Build the 3D graph whenever ecosystem changes
  useEffect(() => {
    if (!containerRef.current || !ecosystem) return
    const elem = containerRef.current

    // ── Build nodes/links from ecosystem ─────────────────────────────────
    const inDeg = new Map<string, number>()
    const outDeg = new Map<string, number>()
    const ids = new Set<string>()
    for (const s of ecosystem.services) { ids.add(s.id); inDeg.set(s.id, 0); outDeg.set(s.id, 0) }
    for (const d of ecosystem.databases) { ids.add(d.id); inDeg.set(d.id, 0); outDeg.set(d.id, 0) }
    for (const e of ecosystem.edges) {
      if (!ids.has(e.from) || !ids.has(e.to)) continue
      outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1)
      inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1)
    }

    const nodes: GraphNode[] = [
      ...ecosystem.services.map((s): GraphNode => {
        const i = inDeg.get(s.id) ?? 0
        const o = outDeg.get(s.id) ?? 0
        const val = 4 + i * 2.5 + (s.endpointCount ?? 0) * 0.3
        const radius = Math.cbrt(val) * NODE_REL_SIZE
        return {
          id: s.id, name: s.name,
          kind: 'service',
          type: typeOfService(s),
          lang: (s.language ?? '').toLowerCase(),
          status: s.status,
          endpoints: s.endpointCount ?? 0,
          meta: s,
          inDeg: i, outDeg: o, degree: i + o,
          val, radius,
        }
      }),
      ...ecosystem.databases.map((d): GraphNode => {
        const i = inDeg.get(d.id) ?? 0
        const o = outDeg.get(d.id) ?? 0
        const val = 4 + i * 2.5 + (d.connectionCount ?? 0) * 0.3
        const radius = Math.cbrt(val) * NODE_REL_SIZE
        return {
          id: d.id, name: d.name,
          kind: 'database',
          type: 'data-store',
          lang: (d.kind ?? '').toLowerCase(),
          status: d.status,
          endpoints: 0,
          meta: d,
          inDeg: i, outDeg: o, degree: i + o,
          val, radius,
        }
      }),
    ]
    const nodeById = new Map(nodes.map(n => [n.id, n]))
    const links: GraphLink[] = ecosystem.edges
      .filter(e => ids.has(e.from) && ids.has(e.to))
      .map(e => ({ source: e.from, target: e.to, kind: 'resolved' }))

    // neighbor map for isolate mode
    const neighborMap = new Map<string, Set<string>>()
    nodes.forEach(n => neighborMap.set(n.id, new Set([n.id])))
    links.forEach(l => {
      const s = typeof l.source === 'string' ? l.source : l.source.id
      const t = typeof l.target === 'string' ? l.target : l.target.id
      neighborMap.get(s)?.add(t)
      neighborMap.get(t)?.add(s)
    })

    // ── Texture caches scoped to this scene ──────────────────────────────
    const haloCache = new Map<string, THREE.Texture>()
    const ringCache = new Map<string, THREE.Texture>()
    const sheenTex = makeSheenTexture()

    // ── Glass node builder ───────────────────────────────────────────────
    function buildGlassNode(n: GraphNode): THREE.Group {
      const group = new THREE.Group()
      group.userData.kind = 'node'
      group.userData.nodeId = n.id

      const hue = colorOfNode(n)
      const r = n.radius

      const coreMat = new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 1.0 })
      const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.94, 32, 32), coreMat)
      core.userData.role = 'core'
      group.add(core)

      const shellMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
        roughness: 0.15,
        metalness: 0.0,
        clearcoat: 0.7,
        clearcoatRoughness: 0.1,
        transmission: 0.15,
        thickness: 0.3,
        ior: 1.4,
        depthWrite: false,
      })
      const shell = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 32), shellMat)
      shell.userData.role = 'shell'
      group.add(shell)

      const haloMat = new THREE.SpriteMaterial({
        map: makeHaloTexture(hue, haloCache),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.35,
      })
      const halo = new THREE.Sprite(haloMat)
      halo.scale.set(r * 1.9, r * 1.9, 1)
      halo.userData.role = 'halo'
      group.add(halo)

      const sheenMat = new THREE.SpriteMaterial({
        map: sheenTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.4,
      })
      const sheen = new THREE.Sprite(sheenMat)
      sheen.scale.set(r * 0.7, r * 0.35, 1)
      sheen.position.set(-r * 0.30, r * 0.45, r * 0.4)
      sheen.userData.role = 'sheen'
      group.add(sheen)

      // status halo for provisional nodes (yellow-ish)
      if (n.status === 'provisional') {
        const pMat = new THREE.SpriteMaterial({
          map: makeHaloTexture('#facc15', haloCache),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.45,
        })
        const p = new THREE.Sprite(pMat)
        p.scale.set(r * 2.4, r * 2.4, 1)
        p.userData.role = 'pendingHalo'
        group.add(p)
      }

      // label
      const sprite = new SpriteText(n.name)
      sprite.fontFace = 'JetBrains Mono, monospace'
      sprite.fontWeight = '500'
      sprite.color = '#ffffff'
      sprite.backgroundColor = 'rgba(8,8,12,0.78)'
      sprite.borderColor = hexToA(hue, 0.45)
      sprite.borderWidth = 0.5
      sprite.borderRadius = 3
      sprite.padding = 2
      sprite.textHeight = 3.5 + Math.min(2, n.degree * 0.15)
      sprite.position.set(0, r + sprite.textHeight * 0.7 + 1.5, 0)
      if (sprite.material) {
        sprite.material.depthTest = false
        sprite.material.depthWrite = false
      }
      sprite.renderOrder = 999
      sprite.userData.role = 'label'
      sprite.userData.nodeId = n.id
      sprite.userData.degree = n.degree
      group.add(sprite)

      group.userData.parts = { core, shell, halo, sheen }
      group.userData.baseHaloOpacity = 0.35
      group.userData.baseHaloScale = r * 1.9
      return group
    }

    // ── Edge builder ─────────────────────────────────────────────────────
    function buildEdge(link: GraphLink): THREE.Line {
      const sId = typeof link.source === 'string' ? link.source : link.source.id
      const tId = typeof link.target === 'string' ? link.target : link.target.id
      const sNode = nodeById.get(sId)
      const tNode = nodeById.get(tId)
      link.__litColors = {
        source: sNode ? colorOfNode(sNode) : '#888888',
        target: tNode ? colorOfNode(tNode) : '#888888',
      }
      const grayHex = link.kind === 'unresolvable' ? GRAY_UNRESOLV_HEX : GRAY_HEX
      const cs = new THREE.Color(grayHex)
      const ct = new THREE.Color(grayHex)
      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,0], 3))
      geom.setAttribute('color', new THREE.Float32BufferAttribute(
        [cs.r, cs.g, cs.b, ct.r, ct.g, ct.b], 3
      ))
      const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: link.kind === 'unresolvable' ? GRAY_UNRESOLV_OP : GRAY_OP,
        depthWrite: false,
      })
      const line = new THREE.Line(geom, mat)
      line.userData.kind = 'edge'
      link.__line = line
      link.__lit = false
      return line
    }

    function resetEdgeToGray(link: GraphLink): void {
      const line = link.__line
      if (!line) return
      const grayHex = link.kind === 'unresolvable' ? GRAY_UNRESOLV_HEX : GRAY_HEX
      const c = new THREE.Color(grayHex)
      const arr = (line.geometry.attributes.color as THREE.BufferAttribute).array as Float32Array
      arr[0] = c.r; arr[1] = c.g; arr[2] = c.b
      arr[3] = c.r; arr[4] = c.g; arr[5] = c.b
      ;(line.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true
      ;(line.material as THREE.LineBasicMaterial).opacity = link.kind === 'unresolvable' ? GRAY_UNRESOLV_OP : GRAY_OP
      link.__lit = false
    }
    function resetAllEdgesToGray(): void { links.forEach(resetEdgeToGray) }

    function setEdgePreviewLit(link: GraphLink): void {
      const line = link.__line
      if (!line || link.__drawing || link.__lit || !link.__litColors) return
      const cs = new THREE.Color(link.__litColors.source)
      const ct = new THREE.Color(link.__litColors.target)
      if (link.kind === 'unresolvable') { cs.setHex(0x888888); ct.setHex(0x888888) }
      const arr = (line.geometry.attributes.color as THREE.BufferAttribute).array as Float32Array
      arr[0] = cs.r; arr[1] = cs.g; arr[2] = cs.b
      arr[3] = ct.r; arr[4] = ct.g; arr[5] = ct.b
      ;(line.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true
      ;(line.material as THREE.LineBasicMaterial).opacity = link.kind === 'unresolvable' ? HOVER_UNRESOLV_OP : HOVER_OP
    }

    function updateEdgePosition(line: THREE.Line, ends: { start: THREE.Vector3; end: THREE.Vector3 }, link?: GraphLink): boolean | undefined {
      if (link && link.__drawing) return // animation owns geometry
      const positions = (line.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
      positions[0] = ends.start.x; positions[1] = ends.start.y; positions[2] = ends.start.z
      positions[3] = ends.end.x;   positions[4] = ends.end.y;   positions[5] = ends.end.z
      ;(line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
      return undefined
    }

    function spawnEdgeParticle(link: { source: GraphNode | unknown; target: GraphNode | unknown; kind: 'resolved' | 'unresolvable' }): void {
      const s = link.source as GraphNode | undefined
      const t = link.target as GraphNode | undefined
      if (!s || !t || typeof s !== 'object' || typeof t !== 'object') return
      const sNode = nodeById.get(s.id)
      const tNode = nodeById.get(t.id)
      const sHue = sNode ? colorOfNode(sNode) : '#ffffff'
      const tHue = tNode ? colorOfNode(tNode) : '#ffffff'
      const mat = new THREE.SpriteMaterial({
        map: makeHaloTexture(sHue, haloCache),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 1.0,
      })
      const sprite = new THREE.Sprite(mat)
      const r = sNode ? sNode.radius : 6
      sprite.scale.set(r * 1.6, r * 1.6, 1)
      Graph.scene().add(sprite)

      const sR = sNode ? sNode.radius : 4
      const tR = tNode ? tNode.radius : 4
      const dx = (t.x ?? 0) - (s.x ?? 0)
      const dy = (t.y ?? 0) - (s.y ?? 0)
      const dz = (t.z ?? 0) - (s.z ?? 0)
      const dist = Math.hypot(dx, dy, dz) || 1
      const ux = dx/dist, uy = dy/dist, uz = dz/dist
      const startV = new THREE.Vector3((s.x ?? 0) + ux*sR, (s.y ?? 0) + uy*sR, (s.z ?? 0) + uz*sR)
      const endV   = new THREE.Vector3((t.x ?? 0) - ux*tR, (t.y ?? 0) - uy*tR, (t.z ?? 0) - uz*tR)

      const start = performance.now()
      const duration = 1100
      function tick(): void {
        const tt = Math.min(1, (performance.now() - start) / duration)
        const eased = tt < 0.5 ? 2*tt*tt : 1 - Math.pow(-2*tt+2, 2)/2
        sprite.position.lerpVectors(startV, endV, eased)
        if (tt > 0.5 && sprite.material.map === haloCache.get(sHue) && sHue !== tHue) {
          sprite.material.map = makeHaloTexture(tHue, haloCache)
          sprite.material.needsUpdate = true
        }
        if (tt < 1) requestAnimationFrame(tick)
        else {
          Graph.scene().remove(sprite); mat.dispose()
        }
      }
      tick()
    }

    function animateEdgeDraw(link: GraphLink, fromSource: boolean, duration: number): void {
      const lineMaybe = link.__line
      if (!lineMaybe) return
      const line: THREE.Line = lineMaybe
      const s = link.source, t = link.target
      if (!s || !t || typeof s !== 'object' || typeof t !== 'object') return
      const sn = s as GraphNode
      const tn = t as GraphNode
      const startNode = fromSource ? sn : tn
      const endNode   = fromSource ? tn : sn

      link.__drawing = true
      const positions = (line.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
      positions[0] = startNode.x ?? 0; positions[1] = startNode.y ?? 0; positions[2] = startNode.z ?? 0
      positions[3] = startNode.x ?? 0; positions[4] = startNode.y ?? 0; positions[5] = startNode.z ?? 0
      ;(line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true

      const grayHex = link.kind === 'unresolvable' ? GRAY_UNRESOLV_HEX : GRAY_HEX
      const grayCol = new THREE.Color(grayHex)
      const litStartCol = new THREE.Color(
        fromSource ? link.__litColors!.source : link.__litColors!.target
      )
      const litEndCol = new THREE.Color(
        fromSource ? link.__litColors!.target : link.__litColors!.source
      )
      if (link.kind === 'unresolvable') {
        litStartCol.setHex(0x777777); litEndCol.setHex(0x777777)
      }
      const colorArr = (line.geometry.attributes.color as THREE.BufferAttribute).array as Float32Array

      spawnEdgeParticle({ source: startNode, target: endNode, kind: link.kind })

      const baseOp = link.kind === 'unresolvable' ? GRAY_UNRESOLV_OP : GRAY_OP
      const targetOp = link.kind === 'unresolvable' ? LIT_UNRESOLV_OP : LIT_OP

      const startTime = performance.now()
      function tick(): void {
        const tt = Math.min(1, (performance.now() - startTime) / duration)
        const eased = 1 - Math.pow(1 - tt, 2.2)
        positions[0] = startNode.x ?? 0; positions[1] = startNode.y ?? 0; positions[2] = startNode.z ?? 0
        positions[3] = (startNode.x ?? 0) + ((endNode.x ?? 0) - (startNode.x ?? 0)) * eased
        positions[4] = (startNode.y ?? 0) + ((endNode.y ?? 0) - (startNode.y ?? 0)) * eased
        positions[5] = (startNode.z ?? 0) + ((endNode.z ?? 0) - (startNode.z ?? 0)) * eased
        ;(line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
        const cs = grayCol.clone().lerp(litStartCol, eased)
        const ct = grayCol.clone().lerp(litEndCol, eased)
        colorArr[0] = cs.r; colorArr[1] = cs.g; colorArr[2] = cs.b
        colorArr[3] = ct.r; colorArr[4] = ct.g; colorArr[5] = ct.b
        ;(line.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true
        ;(line.material as THREE.LineBasicMaterial).opacity = baseOp + eased * (targetOp - baseOp)
        if (tt < 1) requestAnimationFrame(tick)
        else {
          link.__drawing = false
          link.__lit = true
          colorArr[0] = litStartCol.r; colorArr[1] = litStartCol.g; colorArr[2] = litStartCol.b
          colorArr[3] = litEndCol.r;   colorArr[4] = litEndCol.g;   colorArr[5] = litEndCol.b
          ;(line.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true
          ;(line.material as THREE.LineBasicMaterial).opacity = targetOp
        }
      }
      tick()
    }

    // ── State (focus, isolate, label LOD) ────────────────────────────────
    let focusedId: string | null = null
    let hoveredNodeId: string | null = null
    let isolateMode = false
    let labelDegThreshold = 3

    function passesFilter(n: GraphNode): boolean {
      const f = filtersRef.current
      if (f.types.size > 0 && !f.types.has(n.type)) return false
      if (f.langs.size > 0) {
        // databases never match a language filter (their `lang` carries DB kind)
        if (n.kind !== 'service' || !f.langs.has(n.lang)) return false
      }
      if (f.statuses.size > 0 && !f.statuses.has(n.status)) return false
      const q = f.search.trim().toLowerCase()
      if (q && !n.name.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) return false
      return true
    }
    function isVisible(n: GraphNode): boolean {
      if (!passesFilter(n)) return false
      if (!focusedId || !isolateMode) return true
      return neighborMap.get(focusedId)!.has(n.id)
    }
    function isLinkVisible(l: GraphLink): boolean {
      const sId = typeof l.source === 'object' ? l.source.id : l.source
      const tId = typeof l.target === 'object' ? l.target.id : l.target
      const sNode = nodeById.get(sId)
      const tNode = nodeById.get(tId)
      if (sNode && !passesFilter(sNode)) return false
      if (tNode && !passesFilter(tNode)) return false
      if (!focusedId || !isolateMode) return true
      return sId === focusedId || tId === focusedId
    }

    function applyHaloState(nodeObj: THREE.Object3D, state: 'default' | 'hover' | 'active'): void {
      const parts = nodeObj.userData.parts as { halo: THREE.Sprite } | undefined
      if (!parts) return
      const baseOp = nodeObj.userData.baseHaloOpacity as number
      const baseSc = nodeObj.userData.baseHaloScale as number
      const factor = state === 'active' ? 1.6 : state === 'hover' ? 1.25 : 1.0
      const opFactor = state === 'active' ? 2.2 : state === 'hover' ? 1.5 : 1.0
      parts.halo.scale.set(baseSc * factor, baseSc * factor, 1)
      parts.halo.material.opacity = baseOp * opFactor
    }

    function findNodeObj(id: string): THREE.Object3D | null {
      let result: THREE.Object3D | null = null
      Graph.scene().traverse((obj: THREE.Object3D) => {
        if (obj.userData?.kind === 'node' && obj.userData?.nodeId === id) result = obj
      })
      return result
    }

    function applyLabelLOD(): void {
      Graph.scene().traverse((obj: THREE.Object3D) => {
        if (obj.userData?.role === 'label') {
          const nid = obj.userData.nodeId as string
          const deg = obj.userData.degree as number
          const isFocused = nid === focusedId
          const isNeighbor = !!focusedId && neighborMap.get(focusedId)!.has(nid)
          if (focusedId) obj.visible = isFocused || isNeighbor
          else obj.visible = deg >= labelDegThreshold
        }
      })
    }

    function dimNeighborhood(): void {
      Graph.scene().traverse((obj: THREE.Object3D) => {
        if (obj.userData?.kind !== 'node') return
        const id = obj.userData.nodeId as string
        const isNeighbor = !focusedId || neighborMap.get(focusedId)!.has(id)
        const isFocused = id === focusedId
        const parts = obj.userData.parts as {
          core: THREE.Mesh; shell: THREE.Mesh; halo: THREE.Sprite; sheen: THREE.Sprite
        } | undefined
        if (parts) {
          const dimFactor = isNeighbor ? 1.0 : 0.18
          ;(parts.core.material as THREE.MeshBasicMaterial).opacity = 0.95 * dimFactor
          ;(parts.shell.material as THREE.MeshPhysicalMaterial).opacity = 0.22 * dimFactor
          parts.halo.material.opacity = (obj.userData.baseHaloOpacity as number) * dimFactor * (isFocused ? 1.5 : 1)
          parts.sheen.material.opacity = 0.4 * dimFactor
        }
      })
    }

    function spawnNodeRipple(node: GraphNode, hue: string): void {
      const tex = makeRingTexture(hue, ringCache)
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false, opacity: 1,
      })
      const sprite = new THREE.Sprite(mat)
      sprite.position.set(node.x ?? 0, node.y ?? 0, node.z ?? 0)
      const baseScale = node.radius * 3.5
      sprite.scale.set(baseScale * 0.9, baseScale * 0.9, 1)
      Graph.scene().add(sprite)
      const start = performance.now()
      const duration = 700
      function tick(): void {
        const t = Math.min(1, (performance.now() - start) / duration)
        const eased = 1 - Math.pow(1 - t, 3)
        const sc = baseScale * (0.9 + eased * 1.8)
        sprite.scale.set(sc, sc, 1)
        sprite.material.opacity = 1 - eased
        sprite.position.set(node.x ?? 0, node.y ?? 0, node.z ?? 0)
        if (t < 1) requestAnimationFrame(tick)
        else { Graph.scene().remove(sprite); mat.dispose() }
      }
      tick()
    }

    // ── Build the graph ──────────────────────────────────────────────────
    // Cast to any: 3d-force-graph's d.ts has its own NodeObject shape that
    // doesn't accept our GraphNode generic. Runtime API is what we use.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Graph: any = ForceGraph3D()(elem)
      .backgroundColor('#0d0d10')
      .graphData({ nodes, links })
      .nodeRelSize(NODE_REL_SIZE)
      .nodeVal('val')
      .nodeLabel((n: GraphNode) => `${n.name} · ${n.type} · ${n.lang || '—'}`)
      .nodeVisibility((n: GraphNode) => isVisible(n))
      .nodeThreeObject(buildGlassNode)
      .nodeThreeObjectExtend(false)
      .linkVisibility((l: GraphLink) => isLinkVisible(l))
      .linkThreeObject(buildEdge)
      .linkThreeObjectExtend(false)
      .linkPositionUpdate(updateEdgePosition)
      .linkHoverPrecision(4)
      .onNodeClick(onNodeClick)
      .onNodeHover(onNodeHover)
      .onBackgroundClick(clearFocus)
      .width(elem.clientWidth)
      .height(elem.clientHeight)

    try { Graph.d3Force('charge').strength(-280) } catch (e) { /* noop */ }
    Graph.cameraPosition({ x: 0, y: 0, z: 700 })

    // Expose the graph instance so the filter-change effect can call refresh().
    graphRef.current = Graph

    // ── Bloom postprocessing ─────────────────────────────────────────────
    let bloomPass: UnrealBloomPass | null = null
    try {
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(elem.clientWidth, elem.clientHeight),
        0.55, 0.5, 0.30
      )
      Graph.postProcessingComposer().addPass(bloomPass)
    } catch (e) {
      console.warn('bloom not available:', e)
    }

    // ── Controls (orbit + screen-space pan) ──────────────────────────────
    const controls = Graph.controls()
    if (controls) {
      controls.autoRotate = false
      controls.autoRotateSpeed = 0.4
      controls.enableDamping = true
      controls.dampingFactor = 0.1
      controls.screenSpacePanning = true
      controls.panSpeed = 1.0
      if (THREE.MOUSE) {
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.PAN,
        }
      }
    }
    const onMouseDown = (e: MouseEvent) => { if (e.button === 1) e.preventDefault() }
    const onAuxClick = (e: MouseEvent) => { if (e.button === 1) e.preventDefault() }
    const onContextMenu = (e: MouseEvent) => e.preventDefault()
    elem.addEventListener('mousedown', onMouseDown)
    elem.addEventListener('auxclick', onAuxClick)
    elem.addEventListener('contextmenu', onContextMenu)

    // ── Interactions ─────────────────────────────────────────────────────
    // Custom double-click detection: 3d-force-graph fires only `onNodeClick`,
    // so we keep a per-node last-click timestamp and treat two clicks within
    // 300ms as a double-click → drill into ServiceView (services only).
    const lastClickAt = new Map<string, number>()
    const DOUBLE_CLICK_MS = 300

    function onNodeClick(node: GraphNode): void {
      const now = performance.now()
      const prev = lastClickAt.get(node.id) ?? 0
      lastClickAt.set(node.id, now)
      if (now - prev < DOUBLE_CLICK_MS && node.kind === 'service') {
        navigateToService(node.id)
        return
      }
      resetAllEdgesToGray()
      focusedId = node.id
      isolateMode = true
      selectNode(node.id)
      setFocusedInfo(node)

      const distance = Math.max(90, node.radius * 9)
      const dist = Math.hypot(node.x ?? 0, node.y ?? 0, node.z ?? 0) || 1
      const ratio = 1 + distance / dist
      Graph.cameraPosition(
        { x: (node.x ?? 0) * ratio, y: (node.y ?? 0) * ratio, z: (node.z ?? 0) * ratio },
        node, 2200
      )
      const ctrl = Graph.controls()
      if (ctrl) ctrl.autoRotate = false

      spawnNodeRipple(node, colorOfNode(node))
      const obj = findNodeObj(node.id)
      if (obj) applyHaloState(obj, 'active')

      Graph.refresh()
      applyLabelLOD()
      dimNeighborhood()

      const connectedLinks = links.filter(l => {
        const sId = typeof l.source === 'object' ? l.source.id : l.source
        const tId = typeof l.target === 'object' ? l.target.id : l.target
        return sId === node.id || tId === node.id
      })
      connectedLinks.forEach((l, i) => {
        const sId = typeof l.source === 'object' ? l.source.id : l.source
        const fromSource = sId === node.id
        const stagger = 700 + Math.min(i * 60, 500)
        setTimeout(() => animateEdgeDraw(l, fromSource, 1100), stagger)
      })
    }

    function onNodeHover(node: GraphNode | null): void {
      elem.style.cursor = node ? 'pointer' : ''
      const newId = node ? node.id : null
      if (hoveredNodeId && hoveredNodeId !== newId) {
        const prev = findNodeObj(hoveredNodeId)
        if (prev && hoveredNodeId !== focusedId) applyHaloState(prev, 'default')
        links.forEach(l => {
          const sId = typeof l.source === 'object' ? l.source.id : l.source
          const tId = typeof l.target === 'object' ? l.target.id : l.target
          if ((sId === hoveredNodeId || tId === hoveredNodeId) && !l.__lit && !l.__drawing) {
            resetEdgeToGray(l)
          }
        })
      }
      hoveredNodeId = newId
      if (node && node.id !== focusedId) {
        const obj = findNodeObj(node.id)
        if (obj) applyHaloState(obj, 'hover')
        links.forEach(l => {
          const sId = typeof l.source === 'object' ? l.source.id : l.source
          const tId = typeof l.target === 'object' ? l.target.id : l.target
          if (sId === node.id || tId === node.id) setEdgePreviewLit(l)
        })
      }
      setHoveredInfo(node ?? null)
    }

    function clearFocus(): void {
      focusedId = null
      resetAllEdgesToGray()
      Graph.scene().traverse((obj: THREE.Object3D) => {
        if (obj.userData?.kind === 'node') applyHaloState(obj, 'default')
      })
      isolateMode = false
      selectNode(null)
      setFocusedInfo(null)
      Graph.refresh()
      applyLabelLOD()
      dimNeighborhood()
    }

    // ── Keyboard ─────────────────────────────────────────────────────────
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearFocus()
    }
    window.addEventListener('keydown', onKey)

    // ── Resize ───────────────────────────────────────────────────────────
    const onResize = () => {
      Graph.width(elem.clientWidth).height(elem.clientHeight)
      if (bloomPass) bloomPass.resolution.set(elem.clientWidth, elem.clientHeight)
    }
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(onResize)
    ro.observe(elem)

    // initial label LOD pass after layout settles
    const t1 = setTimeout(() => applyLabelLOD(), 500)
    const t2 = setTimeout(() => applyLabelLOD(), 1500)

    // ── Cleanup ──────────────────────────────────────────────────────────
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      ro.disconnect()
      clearTimeout(t1); clearTimeout(t2)
      elem.removeEventListener('mousedown', onMouseDown)
      elem.removeEventListener('auxclick', onAuxClick)
      elem.removeEventListener('contextmenu', onContextMenu)
      try { Graph._destructor?.() } catch (e) { /* noop */ }
      // wipe canvas
      while (elem.firstChild) elem.removeChild(elem.firstChild)
      // dispose textures
      haloCache.forEach(t => t.dispose())
      ringCache.forEach(t => t.dispose())
      sheenTex.dispose()
    }
  }, [ecosystem]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────

  const counts: Record<VisualType, number> = {
    gateway: 0, bff: 0, service: 0, 'data-store': 0, worker: 0, external: 0,
  }
  if (ecosystem) {
    for (const s of ecosystem.services) counts[typeOfService(s)]++
    counts['data-store'] += ecosystem.databases.length
  }

  const infoNode = focusedInfo ?? hoveredInfo

  return (
    <div className={styles.container}>
      <div ref={containerRef} className={styles.graph} />

      {!ecosystem && ecosystemStatus !== 'loading' && (
        <div className={styles.emptyState}>
          <div style={{ fontSize: 36, color: 'var(--accent-green)' }}>◎</div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Nenhum serviço extraído ainda</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Use Extract na Home para adicionar serviços ao ecossistema</div>
        </div>
      )}

      {ecosystemStatus === 'loading' && (
        <div className={styles.loadingOverlay}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, color: 'var(--accent-green)', marginBottom: 12 }}>◌</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>carregando ecossistema…</div>
          </div>
        </div>
      )}

      {ecosystemStatus === 'error' && (
        <div className={styles.errorBanner}>
          <span>⚠</span> {ecosystemError ?? 'Falha ao carregar ecossistema'}
        </div>
      )}

      {/* Legend — rows are clickable type filters */}
      {ecosystem && (
        <div className={styles.legend}>
          {Object.entries(TYPES).map(([k, v]) => {
            const t = k as VisualType
            const noneSelected = filters.types.size === 0
            const active = noneSelected || filters.types.has(t)
            return (
              <button
                type="button"
                key={k}
                className={`${styles.legendRow} ${active ? '' : styles.legendRowMuted}`}
                onClick={() => setFilters(f => ({ ...f, types: toggleSetItem(f.types, t) }))}
                title={`Filtrar por ${v.label}`}
              >
                <span className={styles.swatch} style={{ background: v.hue, color: v.hue }} />
                <span className={styles.legendName}>{v.label}</span>
                <span className={styles.legendCount}>{counts[t]}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Filter toolbar — search + lang + status + reset */}
      {ecosystem && (
        <div className={styles.toolbar}>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="buscar serviço…"
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          />

          {availableLangs.length > 0 && (
            <div className={styles.chipGroup}>
              <div className={styles.chipGroupLabel}>lang</div>
              {availableLangs.map(lang => {
                const active = filters.langs.has(lang)
                return (
                  <button
                    type="button"
                    key={lang}
                    className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                    onClick={() => setFilters(f => ({ ...f, langs: toggleSetItem(f.langs, lang) }))}
                  >
                    {lang}
                  </button>
                )
              })}
            </div>
          )}

          <div className={styles.chipGroup}>
            <div className={styles.chipGroupLabel}>status</div>
            {(['active', 'provisional'] as const).map(s => {
              const active = filters.statuses.has(s)
              return (
                <button
                  type="button"
                  key={s}
                  className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                  onClick={() => setFilters(f => ({ ...f, statuses: toggleSetItem(f.statuses, s) }))}
                >
                  {s}
                </button>
              )
            })}
          </div>

          {hasAnyFilter && (
            <button
              type="button"
              className={styles.resetBtn}
              onClick={() => setFilters({
                types: new Set(), langs: new Set(), statuses: new Set(), search: '',
              })}
            >
              limpar filtros
            </button>
          )}
        </div>
      )}

      {/* Info panel */}
      {infoNode && (
        <div className={styles.info}>
          <div className={styles.infoHeader}>
            <span
              className={styles.infoDot}
              style={{ background: TYPES[infoNode.type].hue, boxShadow: `0 0 8px ${TYPES[infoNode.type].hue}` }}
            />
            <div className={styles.infoName}>{infoNode.name}</div>
          </div>
          <div className={styles.badges}>
            <span className={styles.badge} style={{ color: TYPES[infoNode.type].hue, borderColor: TYPES[infoNode.type].hue }}>
              {TYPES[infoNode.type].label}
            </span>
            {infoNode.lang && (
              <span className={styles.badge} style={{ color: '#aaa', borderColor: 'rgba(255,255,255,0.15)' }}>
                {infoNode.lang}
              </span>
            )}
            <span
              className={styles.badge}
              style={{
                color: infoNode.status === 'active' ? '#4ade80' : '#facc15',
                borderColor: infoNode.status === 'active' ? '#4ade80' : '#facc15',
              }}
            >
              {infoNode.status}
            </span>
          </div>
          <dl className={styles.infoDl}>
            {infoNode.kind === 'service' && <><dt>endpoints</dt><dd>{infoNode.endpoints}</dd></>}
            <dt>chamadas in</dt><dd>{infoNode.inDeg}</dd>
            <dt>chamadas out</dt><dd>{infoNode.outDeg}</dd>
            <dt>degree</dt><dd>{infoNode.degree}</dd>
          </dl>
          {focusedInfo && focusedInfo.kind === 'service' && (
            <button
              className={styles.exploreBtn}
              onClick={() => navigateToService(focusedInfo.id)}
            >
              Explorar →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
