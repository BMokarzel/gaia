import type { SystemTopology } from '@/types/topology'

// Espelha os contratos de resposta de apps/api

export type SourceDescriptor =
  | { kind: 'local'; path: string }
  | { kind: 'git'; url: string; branch?: string; ref?: string }
  | { kind: 'github'; owner: string; repo: string; ref?: string }

export interface StoredTopologyMeta {
  id: string
  name: string
  source: SourceDescriptor
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface StoredTopology extends StoredTopologyMeta {
  topology: SystemTopology
}

export interface PagedResult<T> {
  data: T[]
  meta: { total: number; limit: number; offset: number }
}

export interface AnalyzeRequest {
  source: SourceDescriptor
  name?: string
  tags?: string[]
  options?: { skipTests?: boolean; includeFrontend?: boolean }
  clonePolicy?: 'persist' | 'delete'
}

export interface ListQuery {
  name?: string
  tags?: string[]
  limit?: number
  offset?: number
}
