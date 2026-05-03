import type {
  StoredTopology,
  StoredTopologyMeta,
  PagedResult,
  AnalyzeRequest,
  AnalyzeResponse,
  MergeDecisionRequest,
  ListQuery,
  SnapshotsResponse,
  TopologyDiff,
  ChatRequest,
  ChatResponse,
  RuntimeMetrics,
  SimulationResult,
  SimulationOptions,
} from './types'
import type { EcosystemIndex, EndpointNode, FunctionNode, ProvisionalFile } from '@/types/topology'

export interface EndpointFlowResult {
  serviceId: string
  service: { id: string; name: string; language?: string; framework?: string }
  endpoint: EndpointNode
  functions: FunctionNode[]
}

export interface SourceSnippet {
  file: string
  language: string
  startLine: number
  endLine: number
  focusLine: number
  lines: string[]
}

const BASE = '/nest'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const msg = body?.error?.message
    const text = typeof msg === 'string' ? msg
      : Array.isArray(msg) ? msg.join('; ')
      : typeof msg === 'object' && msg !== null ? (msg.message ?? JSON.stringify(msg))
      : `HTTP ${res.status}`
    throw new Error(text)
  }
  if (res.status === 204) return undefined as T
  const json = await res.json()
  // Desempacota o envelope { data: ... } do ResponseEnvelopeInterceptor
  return 'data' in json ? json.data : json
}

export const topologyApi = {
  // ── Topologies ──────────────────────────────────────────────────────────

  list(query?: ListQuery): Promise<PagedResult<StoredTopologyMeta>> {
    const params = new URLSearchParams()
    if (query?.name)   params.set('name', query.name)
    if (query?.limit)  params.set('limit', String(query.limit))
    if (query?.offset) params.set('offset', String(query.offset))
    query?.tags?.forEach((t) => params.append('tags', t))
    const qs = params.toString()
    // Para listagens paginadas o envelope tem { data: [], meta: {} }
    return fetch(`${BASE}/topologies${qs ? `?${qs}` : ''}`, {
      headers: { 'Content-Type': 'application/json' },
    }).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() // retorna { data: [], meta: {} } direto
    })
  },

  get(id: string): Promise<StoredTopology> {
    return request(`/topologies/${id}`)
  },

  getEndpointFlow(topologyId: string, endpointId: string): Promise<EndpointFlowResult> {
    return request(`/topologies/${topologyId}/endpoints/${endpointId}/flow`)
  },

  getSourceSnippet(
    topologyId: string,
    file: string,
    line: number,
    context = 12,
  ): Promise<SourceSnippet> {
    const qs = new URLSearchParams({
      file,
      line: String(line),
      context: String(context),
    })
    return request(`/topologies/${topologyId}/source?${qs}`)
  },

  getServiceDoc(topologyId: string, serviceId: string): Promise<{ markdown: string }> {
    return request(`/topologies/${topologyId}/docs/services/${encodeURIComponent(serviceId)}`)
  },

  getEndpointDoc(topologyId: string, endpointId: string): Promise<{ markdown: string }> {
    return request(`/topologies/${topologyId}/docs/endpoints/${encodeURIComponent(endpointId)}`)
  },

  // ── Snapshots & diff (Fase 6) ──────────────────────────────────────────

  getSnapshots(topologyId: string): Promise<SnapshotsResponse> {
    return request(`/topologies/${topologyId}/snapshots`)
  },

  reanalyze(topologyId: string): Promise<AnalyzeResponse> {
    return request(`/topologies/${topologyId}/reanalyze`, { method: 'POST' })
  },

  getDiff(topologyId: string, fromSha: string, toSha: string): Promise<TopologyDiff> {
    const qs = new URLSearchParams({ from: fromSha, to: toSha })
    return request(`/topologies/${topologyId}/diff?${qs}`)
  },

  analyze(body: AnalyzeRequest): Promise<AnalyzeResponse> {
    return request('/topologies/analyze', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  submitMergeDecisions(body: MergeDecisionRequest): Promise<AnalyzeResponse> {
    return request('/topologies/analyze/merge-decision', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  update(id: string, body: { name?: string; tags?: string[] }): Promise<StoredTopology> {
    return request(`/topologies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  },

  delete(id: string): Promise<void> {
    return request(`/topologies/${id}`, { method: 'DELETE' })
  },

  // ── Chat (Fase 5b) ──────────────────────────────────────────────────────

  chat(body: ChatRequest): Promise<ChatResponse> {
    return request('/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  // ── Runtime metrics (Fase 4) ───────────────────────────────────────────

  getRuntime(
    topologyId: string,
    opts: { windowMs?: number; seed?: number; chaos?: number } = {},
  ): Promise<RuntimeMetrics> {
    const params = new URLSearchParams()
    if (opts.windowMs !== undefined) params.set('window', String(opts.windowMs))
    if (opts.seed !== undefined) params.set('seed', String(opts.seed))
    if (opts.chaos !== undefined) params.set('chaos', String(opts.chaos))
    const qs = params.toString()
    return request(`/topologies/${topologyId}/runtime${qs ? `?${qs}` : ''}`)
  },

  // ── Endpoint simulator (Fase 8) ────────────────────────────────────────

  simulateEndpoint(
    topologyId: string,
    endpointId: string,
    options: SimulationOptions = {},
  ): Promise<SimulationResult> {
    return request(
      `/topologies/${topologyId}/endpoints/${endpointId}/simulate`,
      {
        method: 'POST',
        body: JSON.stringify({
          toggles: options.toggles,
          maxFunctionDepth: options.maxFunctionDepth,
        }),
      },
    )
  },

  // ── Ecosystem ───────────────────────────────────────────────────────────

  getEcosystem(): Promise<EcosystemIndex> {
    return request('/ecosystem')
  },

  getProvisional(): Promise<ProvisionalFile> {
    return request('/ecosystem/provisional')
  },
}
