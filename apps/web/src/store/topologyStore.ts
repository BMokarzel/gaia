import { create } from 'zustand'
import type { SystemTopology, EndpointNode, EcosystemIndex } from '@/types/topology'
import { topologyApi } from '@/api/topology.api'
import type { StoredTopology, StoredTopologyMeta } from '@/api/types'

/** Derive a minimal EcosystemIndex from a stored topology (for legacy / offline scenarios). */
function deriveEcosystem(stored: StoredTopology): EcosystemIndex {
  const now = new Date().toISOString()
  const t = stored.topology
  return {
    version: '1.0',
    updatedAt: now,
    services: (t.services ?? []).map((s, i) => ({
      // Use the file ID for the first service so navigateToService resolves back to this file
      id: i === 0 ? stored.id : s.id,
      name: s.name,
      language: s.metadata?.language ?? '',
      framework: s.metadata?.framework ?? '',
      topologyFile: `topologies/${stored.id}.json`,
      endpointCount: s.endpoints?.length ?? 0,
      status: 'active' as const,
    })),
    databases: (t.databases ?? []).map(db => ({
      id: db.id,
      name: db.name,
      kind: db.metadata?.engine ?? 'unknown',
      topologyFile: `topologies/${stored.id}.json`,
      connectionCount: 0,
      status: 'active' as const,
    })),
    edges: (t.services ?? []).flatMap((s, i) => {
      const ecoSvcId = i === 0 ? stored.id : s.id
      const deps = s.dependencies ?? []
      if (deps.length > 0) {
        return deps.map(dep => ({ from: ecoSvcId, to: dep.id }))
      }
      // Fallback: when extractor didn't populate dependencies, connect to all topology-level databases/brokers
      return [
        ...(t.databases ?? []).map(db => ({ from: ecoSvcId, to: db.id })),
        ...(t.brokers ?? []).map(b => ({ from: ecoSvcId, to: b.id })),
      ]
    }),
  }
}

// ── Navigation model ───────────────────────────────────────────────────────

export type Screen = 'home' | 'ecosystem' | 'service' | 'endpoint'

export interface NavigationState {
  screen: Screen
  /** = repoName when in 'service' or 'endpoint' */
  serviceId: string | null
  endpointId: string | null
}

// ── Status types ───────────────────────────────────────────────────────────

export type EcosystemStatus = 'idle' | 'loading' | 'error'
export type ServiceStatus   = 'idle' | 'loading' | 'error'
export type ListStatus      = 'idle' | 'loading' | 'error'

// ── Store interface ────────────────────────────────────────────────────────

interface TopologyState {
  // ── Navigation ────────────────────────────────────────────────────────
  navigation: NavigationState

  // ── Ecosystem ─────────────────────────────────────────────────────────
  ecosystem: EcosystemIndex | null
  ecosystemStatus: EcosystemStatus
  ecosystemError: string | null

  // ── ServiceView ───────────────────────────────────────────────────────
  activeTopology: SystemTopology | null
  activeTopologyId: string | null
  serviceStatus: ServiceStatus
  serviceError: string | null

  // ── EndpointView ──────────────────────────────────────────────────────
  expandedExternalEndpointIds: Set<string>
  externalTopologies: Map<string, SystemTopology>

  // ── Topology list (for legacy HomeView / extract modal) ───────────────
  topologies: StoredTopologyMeta[]
  topologiesTotal: number
  listStatus: ListStatus
  listError: string | null

  // ── Shared UI ─────────────────────────────────────────────────────────
  highlightedNodeId: string | null
  infoPanelNode: unknown | null
  theme: 'dark' | 'light'

  // ── Actions: navigation ───────────────────────────────────────────────
  goHome: () => void
  navigateToEcosystem: () => void
  navigateToService: (serviceId: string) => void
  navigateToEndpoint: (serviceId: string, endpointId: string) => void

  // ── Compatibility shims (removed in Task #6 view rewrite) ─────────────
  /** @deprecated use navigation.screen */
  viewLevel: Screen
  /** @deprecated use navigation.serviceId */
  selectedServiceId: string | null
  /** @deprecated use navigation.endpointId */
  selectedEndpointId: string | null
  /** @deprecated use activeTopology */
  topology: SystemTopology | null
  /** @deprecated use ecosystemStatus / serviceStatus */
  status: 'empty' | 'loading' | 'loaded' | 'error'
  /** @deprecated */
  error: string | null
  /** @deprecated use selectNode */
  selectedNodeId: string | null
  /** @deprecated use navigateToEcosystem */
  goApp: () => void
  /** @deprecated use navigateToEcosystem/Service/Endpoint */
  navigateTo: (level: Screen, serviceId?: string | null, endpointId?: string | null) => void
  /** @deprecated use loadService + navigateToService */
  setTopology: (t: SystemTopology) => void
  /** @deprecated use loadTopologyById (alias for loadService) */
  loadTopologyById: (id: string) => Promise<void>

  // ── Actions: ecosystem ────────────────────────────────────────────────
  loadEcosystem: () => Promise<void>

  // ── Actions: service ──────────────────────────────────────────────────
  loadService: (repoName: string) => Promise<void>

  // ── Actions: endpoint ─────────────────────────────────────────────────
  expandExternalEndpoint: (endpointId: string) => void
  collapseExternalEndpoint: (endpointId: string) => void
  loadExternalTopology: (repoName: string) => Promise<void>

  // ── Actions: list ─────────────────────────────────────────────────────
  loadTopologies: (query?: { name?: string; limit?: number; offset?: number }) => Promise<void>
  deleteTopology: (id: string) => Promise<void>

  // ── Actions: shared UI ────────────────────────────────────────────────
  selectNode: (id: string | null) => void
  setInfoPanel: (node: unknown | null) => void
  toggleTheme: () => void

  // ── Export ────────────────────────────────────────────────────────────────
  exportReady: (() => ExportGraph) | null
  setExportReady: (fn: (() => ExportGraph) | null) => void
}

// ── Export graph types ─────────────────────────────────────────────────────
export interface ExportNode {
  id: string; type: string; label: string; subLabel?: string
  x: number; y: number; w: number; h: number
  shape: 'rect' | 'circle' | 'diamond'
  status?: 'ok' | 'err'
}
export interface ExportEdge { fromId: string; toId: string; label?: string }
export interface ExportGraph { title: string; nodes: ExportNode[]; edges: ExportEdge[] }

// ── Store implementation ───────────────────────────────────────────────────

export const useTopologyStore = create<TopologyState>((set, get) => ({
  navigation: { screen: 'home', serviceId: null, endpointId: null },

  // Shims — kept in sync with navigation
  viewLevel: 'ecosystem' as Screen,
  selectedServiceId: null,
  selectedEndpointId: null,
  topology: null,
  status: 'empty' as 'empty' | 'loading' | 'loaded' | 'error',
  error: null,
  selectedNodeId: null,

  ecosystem: null,
  ecosystemStatus: 'idle',
  ecosystemError: null,

  activeTopology: null,
  activeTopologyId: null,
  serviceStatus: 'idle',
  serviceError: null,

  expandedExternalEndpointIds: new Set(),
  externalTopologies: new Map(),

  topologies: [],
  topologiesTotal: 0,
  listStatus: 'idle',
  listError: null,

  highlightedNodeId: null,
  infoPanelNode: null,

  theme: ((): 'dark' | 'light' => {
    try { return (localStorage.getItem('gaia-theme') as 'dark' | 'light') || 'dark' } catch { return 'dark' }
  })(),

  // ── Navigation ────────────────────────────────────────────────────────────

  goHome: () => set({
    navigation: { screen: 'home', serviceId: null, endpointId: null },
    viewLevel: 'ecosystem', selectedServiceId: null, selectedEndpointId: null,
    highlightedNodeId: null, selectedNodeId: null,
    infoPanelNode: null,
  }),

  navigateToEcosystem: () => set({
    navigation: { screen: 'ecosystem', serviceId: null, endpointId: null },
    viewLevel: 'ecosystem', selectedServiceId: null, selectedEndpointId: null,
    highlightedNodeId: null, selectedNodeId: null,
    infoPanelNode: null,
  }),

  navigateToService: (serviceId) => set({
    navigation: { screen: 'service', serviceId, endpointId: null },
    viewLevel: 'service', selectedServiceId: serviceId, selectedEndpointId: null,
    highlightedNodeId: null, selectedNodeId: null,
    infoPanelNode: null,
  }),

  navigateToEndpoint: (serviceId, endpointId) => set({
    navigation: { screen: 'endpoint', serviceId, endpointId },
    viewLevel: 'endpoint', selectedServiceId: serviceId, selectedEndpointId: endpointId,
    highlightedNodeId: null, selectedNodeId: null,
    infoPanelNode: null,
  }),

  // ── Shims ─────────────────────────────────────────────────────────────────

  goApp: () => {
    set({
      navigation: { screen: 'ecosystem', serviceId: null, endpointId: null },
      viewLevel: 'ecosystem', selectedServiceId: null, selectedEndpointId: null,
    })
  },

  navigateTo: (level, serviceId = null, endpointId = null) => {
    set({
      navigation: { screen: level, serviceId, endpointId },
      viewLevel: level, selectedServiceId: serviceId, selectedEndpointId: endpointId,
      highlightedNodeId: null, selectedNodeId: null,
    })
  },

  setTopology: (t) => set({
    activeTopology: t, activeTopologyId: null, topology: t,
    serviceStatus: 'idle', status: 'loaded',
    navigation: { screen: 'ecosystem', serviceId: null, endpointId: null },
    viewLevel: 'ecosystem', selectedServiceId: null, selectedEndpointId: null,
    expandedExternalEndpointIds: new Set(),
  }),

  loadTopologyById: async (id) => {
    set({ serviceStatus: 'loading', serviceError: null, status: 'loading', error: null })
    try {
      const stored = await topologyApi.get(id)
      // Derive ecosystem so EcosystemView has something to render even without ecosystem.json
      const derivedEcosystem = deriveEcosystem(stored)
      set((s) => ({
        activeTopology: stored.topology, activeTopologyId: id,
        topology: stored.topology,
        serviceStatus: 'idle', status: 'loaded', error: null,
        navigation: { screen: 'ecosystem', serviceId: null, endpointId: null },
        viewLevel: 'ecosystem', selectedServiceId: null, selectedEndpointId: null,
        expandedExternalEndpointIds: new Set(),
        // Only override ecosystem if it's currently empty
        ecosystem: (s.ecosystem?.services.length ?? 0) > 0 ? s.ecosystem : derivedEcosystem,
      }))
    } catch (err) {
      set({ serviceStatus: 'error', serviceError: (err as Error).message, status: 'error', error: (err as Error).message })
    }
  },

  // ── Ecosystem ─────────────────────────────────────────────────────────────

  loadEcosystem: async () => {
    set({ ecosystemStatus: 'loading', ecosystemError: null })
    try {
      const eco = await topologyApi.getEcosystem()
      // If ecosystem.json exists and has services, use it directly
      if (eco.services.length > 0) {
        set({ ecosystem: eco, ecosystemStatus: 'idle' })
        return
      }
      // Otherwise derive ecosystem from all stored topologies
      const result = await topologyApi.list({ limit: 100 })
      if (result.data.length === 0) {
        set({ ecosystem: eco, ecosystemStatus: 'idle' })
        return
      }
      // list endpoint already returns full topology data — cast and use directly
      const stored = result.data as unknown as StoredTopology[]
      const merged: EcosystemIndex = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        services: [],
        databases: [],
        edges: [],
      }
      for (const s of stored) {
        const derived = deriveEcosystem(s)
        merged.services.push(...derived.services)
        merged.databases.push(...derived.databases)
        merged.edges.push(...derived.edges)
      }
      set({ ecosystem: merged, ecosystemStatus: 'idle' })
    } catch (err) {
      set({ ecosystemStatus: 'error', ecosystemError: (err as Error).message })
    }
  },

  // ── Service ───────────────────────────────────────────────────────────────

  loadService: async (repoName) => {
    if (get().activeTopologyId === repoName) return
    set({ serviceStatus: 'loading', serviceError: null, status: 'loading', error: null })
    try {
      const stored = await topologyApi.get(repoName)
      set({
        activeTopology: stored.topology, activeTopologyId: repoName,
        topology: stored.topology,
        serviceStatus: 'idle', status: 'loaded', error: null,
        expandedExternalEndpointIds: new Set(),
      })
    } catch (err) {
      set({ serviceStatus: 'error', serviceError: (err as Error).message, status: 'error', error: (err as Error).message })
    }
  },

  // ── Endpoint ──────────────────────────────────────────────────────────────

  expandExternalEndpoint: (endpointId) =>
    set((s) => {
      const next = new Set(s.expandedExternalEndpointIds)
      next.add(endpointId)
      return { expandedExternalEndpointIds: next }
    }),

  collapseExternalEndpoint: (endpointId) =>
    set((s) => {
      const next = new Set(s.expandedExternalEndpointIds)
      next.delete(endpointId)
      return { expandedExternalEndpointIds: next }
    }),

  loadExternalTopology: async (repoName) => {
    if (get().externalTopologies.has(repoName)) return
    try {
      const stored = await topologyApi.get(repoName)
      set((s) => {
        const next = new Map(s.externalTopologies)
        next.set(repoName, stored.topology)
        return { externalTopologies: next }
      })
    } catch { /* best-effort — external topology may not be extracted yet */ }
  },

  // ── List ──────────────────────────────────────────────────────────────────

  loadTopologies: async (query) => {
    set({ listStatus: 'loading', listError: null })
    try {
      const result = await topologyApi.list(query)
      set({ topologies: result.data, topologiesTotal: result.meta.total, listStatus: 'idle' })
    } catch (err) {
      set({ listStatus: 'error', listError: (err as Error).message })
    }
  },

  deleteTopology: async (id) => {
    await topologyApi.delete(id)
    set((s) => ({
      topologies: s.topologies.filter((t) => t.id !== id),
      topologiesTotal: s.topologiesTotal - 1,
    }))
  },

  // ── Shared UI ─────────────────────────────────────────────────────────────

  selectNode: (id) => set({ highlightedNodeId: id, selectedNodeId: id }),

  setInfoPanel: (infoPanelNode) => set({ infoPanelNode }),

  exportReady: null,
  setExportReady: (fn) => set({ exportReady: fn }),

  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem('gaia-theme', next) } catch {}
      document.documentElement.setAttribute('data-theme', next)
      return { theme: next }
    }),
}))

// ── Derived selectors ──────────────────────────────────────────────────────

/** @deprecated use navigation.serviceId with activeTopology */
export function useCurrentService() {
  const { activeTopology, navigation } = useTopologyStore()
  if (!activeTopology || !navigation.serviceId) return null
  return activeTopology.services.find((s) => s.id === navigation.serviceId) ?? null
}

export function useHasEcosystem(): boolean {
  const ecosystem = useTopologyStore((s) => s.ecosystem)
  return (ecosystem?.services.length ?? 0) > 0
}

export function useCurrentEndpoint(): EndpointNode | null {
  const { activeTopology, navigation } = useTopologyStore()
  if (!activeTopology || !navigation.endpointId) return null
  for (const svc of activeTopology.services) {
    const ep = svc.endpoints.find((e) => e.id === navigation.endpointId)
    if (ep) return ep
  }
  return null
}
