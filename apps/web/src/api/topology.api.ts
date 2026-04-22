import type {
  StoredTopology,
  StoredTopologyMeta,
  PagedResult,
  AnalyzeRequest,
  AnalyzeResponse,
  MergeDecisionRequest,
  ListQuery,
} from './types'
import type { EcosystemIndex, ProvisionalFile } from '@/types/topology'

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

  // ── Ecosystem ───────────────────────────────────────────────────────────

  getEcosystem(): Promise<EcosystemIndex> {
    return request('/ecosystem')
  },

  getProvisional(): Promise<ProvisionalFile> {
    return request('/ecosystem/provisional')
  },
}
