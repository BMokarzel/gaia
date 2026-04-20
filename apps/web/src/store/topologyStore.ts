import { create } from 'zustand'
import type { SystemTopology, ServiceNode, EndpointNode } from '@/types/topology'
import { topologyApi } from '@/api/topology.api'
import type { StoredTopologyMeta } from '@/api/types'

export type AppStatus = 'empty' | 'loading' | 'loaded' | 'error'
export type ViewLevel = 'ecosystem' | 'service' | 'endpoint'
export type AppScreen = 'home' | 'app'
export type ListStatus = 'idle' | 'loading' | 'error'

interface TopologyState {
  // ── Topologia ativa (visualizador) ────────────────────
  topology: SystemTopology | null
  status: AppStatus
  error: string | null

  // ── Lista de topologias da API ─────────────────────────
  topologies: StoredTopologyMeta[]
  topologiesTotal: number
  listStatus: ListStatus
  listError: string | null

  // ── Tela ──────────────────────────────────────────────
  appScreen: AppScreen

  // ── Navegação ─────────────────────────────────────────
  viewLevel: ViewLevel
  selectedServiceId: string | null
  selectedEndpointId: string | null

  // ── UI ────────────────────────────────────────────────
  theme: 'dark' | 'light'
  selectedNodeId: string | null

  // ── Actions: lista ────────────────────────────────────
  loadTopologies: (query?: { name?: string; limit?: number; offset?: number }) => Promise<void>
  deleteTopology: (id: string) => Promise<void>

  // ── Actions: visualizador ─────────────────────────────
  loadTopologyById: (id: string) => Promise<void>
  setTopology: (t: SystemTopology) => void
  setStatus: (s: AppStatus, err?: string | null) => void

  // ── Actions: navegação ────────────────────────────────
  navigateTo: (level: ViewLevel, serviceId?: string | null, endpointId?: string | null) => void
  selectNode: (id: string | null) => void

  // ── Actions: UI ───────────────────────────────────────
  toggleTheme: () => void
  reset: () => void
  goHome: () => void
  goApp: () => void
}

export const useTopologyStore = create<TopologyState>((set, get) => ({
  topology: null,
  status: 'empty',
  error: null,

  topologies: [],
  topologiesTotal: 0,
  listStatus: 'idle',
  listError: null,

  appScreen: 'home',

  viewLevel: 'ecosystem',
  selectedServiceId: null,
  selectedEndpointId: null,

  theme: ((): 'dark' | 'light' => {
    try { return (localStorage.getItem('gaia-theme') as 'dark' | 'light') || 'dark' } catch { return 'dark' }
  })(),
  selectedNodeId: null,

  // ── Lista ────────────────────────────────────────────────────────────────

  loadTopologies: async (query) => {
    set({ listStatus: 'loading', listError: null })
    try {
      const result = await topologyApi.list(query)
      set({
        topologies: result.data,
        topologiesTotal: result.meta.total,
        listStatus: 'idle',
      })
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

  // ── Visualizador ─────────────────────────────────────────────────────────

  loadTopologyById: async (id) => {
    set({ status: 'loading', error: null })
    try {
      const stored = await topologyApi.get(id)
      set({
        topology: stored.topology,
        status: 'loaded',
        error: null,
        viewLevel: 'ecosystem',
        selectedServiceId: null,
        selectedEndpointId: null,
      })
    } catch (err) {
      set({ status: 'error', error: (err as Error).message })
    }
  },

  setTopology: (topology) =>
    set({ topology, status: 'loaded', error: null, viewLevel: 'ecosystem', selectedServiceId: null, selectedEndpointId: null }),

  setStatus: (status, error = null) => set({ status, error }),

  // ── Navegação ────────────────────────────────────────────────────────────

  navigateTo: (viewLevel, selectedServiceId = null, selectedEndpointId = null) =>
    set({ viewLevel, selectedServiceId, selectedEndpointId, selectedNodeId: null }),

  selectNode: (selectedNodeId) => set({ selectedNodeId }),

  // ── UI ───────────────────────────────────────────────────────────────────

  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem('gaia-theme', next) } catch {}
      document.documentElement.setAttribute('data-theme', next)
      return { theme: next }
    }),

  reset: () =>
    set({ topology: null, status: 'empty', error: null, viewLevel: 'ecosystem', selectedServiceId: null, selectedEndpointId: null, selectedNodeId: null }),

  goHome: () => set({ appScreen: 'home' }),
  goApp:  () => set({ appScreen: 'app' }),
}))

// ── Derived selectors ─────────────────────────────────────────────────────

export function useCurrentService(): ServiceNode | null {
  const { topology, selectedServiceId } = useTopologyStore()
  if (!topology || !selectedServiceId) return null
  return topology.services.find((s) => s.id === selectedServiceId) ?? null
}

export function useCurrentEndpoint(): EndpointNode | null {
  const { topology, selectedServiceId, selectedEndpointId } = useTopologyStore()
  if (!topology || !selectedServiceId || !selectedEndpointId) return null
  const service = topology.services.find((s) => s.id === selectedServiceId)
  return service?.endpoints.find((e) => e.id === selectedEndpointId) ?? null
}
