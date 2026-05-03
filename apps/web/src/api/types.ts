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
  /** Set when extraction captured a git SHA (Fase 6) */
  commitSha?: string
  /** When the extraction itself ran — may differ from updatedAt for re-analyses */
  analyzedAt?: string
}

// ── Snapshots & diff (Fase 6) ─────────────────────────────────────────────

export interface SnapshotMeta {
  sha: string
  analyzedAt: string
  archivedAt?: string
}

export interface SnapshotsResponse {
  current: SnapshotMeta | null
  history: SnapshotMeta[]
}

export interface DiffRef {
  id: string
  name: string
}

export interface EndpointDiffRef {
  id: string
  method: string
  path: string
}

export interface EndpointModification {
  id: string
  method: string
  path: string
  changes: string[]
}

export interface ServiceModification {
  id: string
  name: string
  endpoints: {
    added: EndpointDiffRef[]
    removed: EndpointDiffRef[]
    modified: EndpointModification[]
  }
  databases: { added: string[]; removed: string[] }
  changes: string[]
}

export interface EdgeDiffRef {
  source: string
  target: string
  kind: string
}

export interface TopologyDiff {
  from: { sha: string; analyzedAt?: string }
  to:   { sha: string; analyzedAt?: string }
  services: {
    added: DiffRef[]
    removed: DiffRef[]
    modified: ServiceModification[]
  }
  databases: { added: DiffRef[]; removed: DiffRef[] }
  edges: { added: EdgeDiffRef[]; removed: EdgeDiffRef[] }
  summary: {
    totalChanges: number
    servicesAdded: number
    servicesRemoved: number
    servicesModified: number
    endpointsAdded: number
    endpointsRemoved: number
    endpointsModified: number
  }
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

// ── Chat (Fase 5b) ────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  messages: ChatMessage[]
  topologyId?: string
}

export interface ChatToolCallTrace {
  tool: string
  input: unknown
  output?: unknown
  error?: string
  durationMs: number
}

export interface ChatResponse {
  reply: string
  trace: ChatToolCallTrace[]
  stopReason?: string
}

// ── Runtime metrics (Fase 4) ──────────────────────────────────────────────

export interface RuntimeWindow {
  fromIso: string
  toIso: string
  durationMs: number
}

export interface ServiceMetrics {
  serviceId: string
  rps: number
  errorRate: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs?: number
  cpuPct?: number
  memMb?: number
  saturated?: boolean
}

export interface EndpointMetrics {
  endpointId: string
  serviceId: string
  rps: number
  errorRate: number
  p50LatencyMs: number
  p95LatencyMs: number
  topStatuses?: Array<{ code: number; rate: number }>
}

export interface EdgeMetrics {
  source: string
  target: string
  kind: string
  rps: number
  errorRate: number
  p95LatencyMs: number
}

export type RuntimeAlertKind = 'error_rate' | 'latency' | 'saturation' | 'no_traffic'
export type RuntimeAlertSeverity = 'info' | 'warn' | 'crit'

export interface RuntimeAlert {
  kind: RuntimeAlertKind
  severity: RuntimeAlertSeverity
  targetKind: 'service' | 'endpoint' | 'edge'
  targetId: string
  message: string
  value: number
  threshold: number
}

export interface RuntimeMetrics {
  topologyId: string
  window: RuntimeWindow
  source: 'mock' | 'prometheus' | 'datadog' | 'otel'
  generatedAt: string
  services: ServiceMetrics[]
  endpoints: EndpointMetrics[]
  edges: EdgeMetrics[]
  alerts: RuntimeAlert[]
}

// ── Endpoint simulator (Fase 8) ───────────────────────────────────────────

export interface SimulationToggles {
  failingExternalIds?: string[]
  failingDbIds?: string[]
  failingMiddleware?: string[]
}

export interface SimulationOptions {
  toggles?: SimulationToggles
  maxFunctionDepth?: number
}

export interface VisitedThrow {
  nodeId: string
  errorClass: string
  httpStatus?: number
  serviceId: string
  caught: boolean
  triggeredBy?: 'middleware' | 'external' | 'db'
  triggeredByNodeId?: string
}

export interface VisitedExternalCall {
  nodeId: string
  serviceId: string
  method?: string
  path?: string
  baseUrl?: string
  conditional: boolean
  forcedFailure: boolean
}

export interface VisitedDbOp {
  nodeId: string
  serviceId: string
  operation: string
  databaseId?: string
  tableId?: string
  conditional: boolean
  forcedFailure: boolean
}

export interface VisitedMiddleware {
  nodeId: string
  name: string
  kind: string
  order: number
  forcedFailure: boolean
}

export interface VisitedReturn {
  nodeId: string
  httpStatus?: number
  conditional: boolean
}

export interface BranchPoint {
  nodeId: string
  kind: string
  condition?: string
  branchCount: number
}

export type LikelyResponse =
  | { kind: 'throw'; httpStatus?: number; errorClass: string; reason: string }
  | { kind: 'return'; httpStatus?: number }

export interface SimulationResult {
  endpointId: string
  serviceId: string
  middlewares: VisitedMiddleware[]
  externals: VisitedExternalCall[]
  dbOps: VisitedDbOp[]
  throws: VisitedThrow[]
  returns: VisitedReturn[]
  branches: BranchPoint[]
  likelyResponses: LikelyResponse[]
}
