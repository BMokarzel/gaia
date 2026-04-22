const BASE = '/nest'

export interface ExportParam {
  name: string; in: string; type: string; optional: boolean
}
export interface ExportResponse { status: number; description?: string; kind?: 'return' | 'throw' | 'documented' }
export interface ExportDependency { kind: string; name: string; operations?: string[] }

export interface EndpointContext {
  serviceName: string; serviceDescription?: string
  method: string; path: string; controller?: string
  humanName?: string; existingDescription?: string
  params: ExportParam[]
  responses: ExportResponse[]
  throwStatuses: number[]
  dependencies: ExportDependency[]
  flowSummary: string[]
}

export interface ServiceContext {
  name: string; language: string; framework: string
  humanName?: string; existingDescription?: string
  endpoints: Array<{ method: string; path: string; humanName?: string; description?: string }>
  databases: string[]
  brokers: string[]
}

export interface ExportSections {
  overview?: string; flowDescription?: string; errorHandling?: string
  outputs?: string; dependencies?: string; serviceDescription?: string; architectureNotes?: string
}

export async function fetchDescribe(
  type: 'endpoint' | 'service',
  context: EndpointContext | ServiceContext,
): Promise<ExportSections> {
  const res = await fetch(`${BASE}/topologies/export/describe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, context }),
  })
  if (!res.ok) throw new Error(`Export describe failed: HTTP ${res.status}`)
  const json = await res.json()
  const data = 'data' in json ? json.data : json
  return data.sections ?? data
}
