import type {
  StoredTopology,
  StoredTopologyMeta,
  PagedResult,
  AnalyzeRequest,
  ListQuery,
} from './types'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  const json = await res.json()
  // Desempacota o envelope { data: ... } do ResponseEnvelopeInterceptor
  return 'data' in json ? json.data : json
}

export const topologyApi = {
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

  analyze(body: AnalyzeRequest): Promise<StoredTopology> {
    return request('/topologies/analyze', {
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
}
