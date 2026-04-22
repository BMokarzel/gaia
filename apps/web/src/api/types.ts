import type { SystemTopology, EcosystemIndex, PendingMergeEntry } from '@/types/topology'

// ── Source descriptors ─────────────────────────────────────────────────────

export type SourceDescriptor =
  | { kind: 'local'; path: string }
  | { kind: 'git'; url: string; branch?: string; ref?: string }
  | { kind: 'github'; owner: string; repo: string; ref?: string }

// ── Stored topology ────────────────────────────────────────────────────────

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

// ── Analyze request / response ────────────────────────────────────────────

export interface AnalyzeRequest {
  source: SourceDescriptor
  name?: string
  tags?: string[]
  options?: { skipTests?: boolean; includeFrontend?: boolean }
  clonePolicy?: 'persist' | 'delete'
}

export interface ExtractionProgressSummary {
  servicesDetected: number
  endpointsExtracted: number
  databasesFound: number
  externalCallsTotal: number
  externalCallsResolved: number
  externalCallsPending: number
}

export interface AnalyzeInterimResponse {
  status: 'pending_merge_decisions'
  sessionId: string
  pendingMerges: PendingMergeEntry[]
  progress: ExtractionProgressSummary
}

export interface AnalyzeCompleteResponse {
  status: 'complete'
  topologyId: string
  summary: ExtractionProgressSummary
}

export type AnalyzeResponse = AnalyzeInterimResponse | AnalyzeCompleteResponse

// ── Merge decision ────────────────────────────────────────────────────────

export interface MergeDecisionItem {
  externalCallId: string
  decision: string | null
}

export interface MergeDecisionRequest {
  sessionId: string
  decisions: MergeDecisionItem[]
}

// ── Ecosystem ─────────────────────────────────────────────────────────────

export type { EcosystemIndex } from '@/types/topology'

// ── List query ────────────────────────────────────────────────────────────

export interface ListQuery {
  name?: string
  tags?: string[]
  limit?: number
  offset?: number
}
